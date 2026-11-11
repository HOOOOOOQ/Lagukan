const path = require("node:path");
const fs = require("node:fs");
const express = require("express");
require("dotenv").config({ path: path.join(__dirname, "../.env"), quiet: true });

const {
    createDashboardSessionToken,
    verifyDashboardSessionToken,
    parseCookies,
    redactSecretsFromText,
    validateInstallationIdFormat,
    createRateLimiter,
    rejectSecretsInQueryMiddleware,
} = require("./security");
const {
    INSTALL_STAGES_ORDER,
    getCentralDbHealth,
    createInstallation,
    findRawInstallationById,
    serializeInstallationForClient,
    verifyInstallationCredentials,
    updateInstallationMetadata,
    rotateInstallationApiKey,
    executeTenantDatabaseOperation,
} = require("./centralDb");
const { verifyDiscordBotToken } = require("./discordVerifier");
const { generateTermuxInstallScript } = require("./installScriptGen");

const SESSION_COOKIE_NAME = "lgk_dash_session";

function resolvePublicBaseUrl(req) {
    const envBase = String(process.env.PUBLIC_BASE_URL || "")
        .trim()
        .replace(/\/+$/, "");
    if (envBase) return envBase;

    const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
        .split(",")[0]
        .trim();
    const proto = forwardedProto || (req.secure ? "https" : "http");
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000")
        .split(",")[0]
        .trim();
    return `${proto}://${host}`;
}

function setSessionCookie(req, res, sessionToken) {
    const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
        .split(",")[0]
        .trim();
    const isHttps = req.secure || forwardedProto === "https";
    const parts = [
        `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`,
        "Path=/",
        "HttpOnly",
        `Max-Age=${12 * 60 * 60}`,
        isHttps ? "SameSite=None" : "SameSite=Lax",
    ];
    if (isHttps) parts.push("Secure");
    res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(req, res) {
    const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
        .split(",")[0]
        .trim();
    const isHttps = req.secure || forwardedProto === "https";
    const parts = [`${SESSION_COOKIE_NAME}=`, "Path=/", "HttpOnly", "Max-Age=0", isHttps ? "SameSite=None" : "SameSite=Lax"];
    if (isHttps) parts.push("Secure");
    res.setHeader("Set-Cookie", parts.join("; "));
}

async function authenticateInstallationRequest(req, res, next) {
    try {
        // Method 1: Bearer API Key + X-Lagukan-Installation-Id header (Termux Bot & CLI)
        const authHeader = String(req.headers.authorization || "");
        const headerInstallId = String(req.headers["x-lagukan-installation-id"] || "").trim();

        if (authHeader.toLowerCase().startsWith("bearer ")) {
            const rawKey = authHeader.slice(7).trim();
            if (!validateInstallationIdFormat(headerInstallId)) {
                return res.status(401).json({
                    ok: false,
                    error: "Header X-Lagukan-Installation-Id tidak valid atau tidak disertakan.",
                });
            }

            const verified = await verifyInstallationCredentials(headerInstallId, rawKey);
            if (!verified) {
                return res.status(401).json({
                    ok: false,
                    error: "Kredensial instalasi tidak valid atau telah dicabut.",
                });
            }

            req.authenticatedInstallationId = verified.installationId;
            req.authenticatedInstallation = verified;
            return next();
        }

        // Method 2: HttpOnly Dashboard Session Cookie (or X-Dashboard-Session header)
        const cookies = parseCookies(req.headers.cookie);
        const rawSession = cookies[SESSION_COOKIE_NAME] || String(req.headers["x-dashboard-session"] || "").trim();
        const sessionPayload = verifyDashboardSessionToken(rawSession);

        if (!sessionPayload?.sub || !validateInstallationIdFormat(sessionPayload.sub)) {
            return res.status(401).json({
                ok: false,
                error: "Sesi Dashboard belum terautentikasi atau sudah kedaluwarsa. Silakan login terlebih dahulu.",
            });
        }

        // Enforce strict cross-installation isolation if X-Lagukan-Installation-Id was also passed
        if (headerInstallId && headerInstallId !== sessionPayload.sub) {
            return res.status(403).json({
                ok: false,
                error: "Akses ditolak: dilarang mengakses data instalasi milik pengguna lain.",
            });
        }

        const record = await findRawInstallationById(sessionPayload.sub);
        if (!record || record.status === "revoked") {
            return res.status(401).json({
                ok: false,
                error: "Instalasi tidak ditemukan atau sesi tidak lagi aktif.",
            });
        }

        req.authenticatedInstallationId = record.installationId;
        req.authenticatedInstallation = record;
        return next();
    } catch (err) {
        return res.status(500).json({
            ok: false,
            error: redactSecretsFromText(err?.message || "Gagal memverifikasi autentikasi."),
        });
    }
}

function createInstallerApp() {
    const app = express();
    app.disable("x-powered-by");
    app.set("trust proxy", 1);

    // Security headers (iframe-preview compatible for Arena & mobile browsers while strict against XSS/sniffing)
    app.use((req, res, next) => {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("X-DNS-Prefetch-Control", "off");
        res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
        res.setHeader(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self';",
        );
        if (req.path.startsWith("/api/")) {
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
        }
        next();
    });

    app.use(express.json({ limit: "256kb" }));
    app.use(rejectSecretsInQueryMiddleware);

    // Rate limiters
    const generalApiLimiter = createRateLimiter({
        windowMs: 60_000,
        max: 180,
        message: "Terlalu banyak permintaan API. Tunggu sebentar sebelum mencoba lagi.",
    });
    const provisionLimiter = createRateLimiter({
        windowMs: 15 * 60_000,
        max: 15,
        keyResolver: (_req, ip) => `prov:${ip}`,
        message: "Batas pembuatan sesi instalasi baru tercapai. Gunakan Installation ID yang sudah Anda buat atau tunggu beberapa menit.",
    });
    const authAndTokenLimiter = createRateLimiter({
        windowMs: 10 * 60_000,
        max: 25,
        keyResolver: (_req, ip) => `auth:${ip}`,
        message: "Terlalu banyak percobaan autentikasi/validasi token. Tunggu beberapa menit.",
    });
    const tenantDbLimiter = createRateLimiter({
        windowMs: 60_000,
        max: 600,
        keyResolver: (req, ip) => `db:${req.authenticatedInstallationId || ip}`,
        message: "Batas laju akses Cloud Database untuk instalasi ini tercapai.",
    });

    // =========================================================================
    // 1. Dynamic Termux One-Line Installer Script (`/install.sh`)
    // =========================================================================
    app.get("/install.sh", generalApiLimiter, (req, res) => {
        const baseUrl = resolvePublicBaseUrl(req);
        const script = generateTermuxInstallScript({
            baseUrl,
            repoUrl: process.env.LAGUKAN_REPO_URL || "https://github.com/HOOOOOOQ/Lagukan.git",
            botVersion: process.env.LAGUKAN_BOT_VERSION || "3.1.0",
        });

        res.setHeader("Content-Type", "text/x-shellscript; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).send(script);
    });

    // =========================================================================
    // 2. Public Service Health & Metadata (Zero Secrets Exposed)
    // =========================================================================
    app.get("/api/v1/health", generalApiLimiter, async (req, res) => {
        try {
            const dbHealth = await getCentralDbHealth();
            const baseUrl = resolvePublicBaseUrl(req);

            return res.json({
                ok: true,
                brand: "LAGUKAN INSTALLER",
                tagline: "Your Music Bot, One Step Away.",
                installerService: "operational",
                lagukanVersion: process.env.LAGUKAN_BOT_VERSION || "3.1.0",
                repositoryUrl: "https://github.com/HOOOOOOQ/Lagukan",
                supportUrl: process.env.LAGUKAN_SUPPORT_URL || "https://discord.gg/kNdSkHchzH",
                publicBaseUrl: baseUrl,
                installCommand: `curl -fsSL ${baseUrl}/install.sh | bash`,
                mongodbService: {
                    connected: dbHealth.ok,
                    statusText: dbHealth.statusText,
                    tenantIsolation: dbHealth.tenantIsolation,
                    latencyMs: dbHealth.latencyMs,
                    atlasConfigured: dbHealth.atlasConfigured,
                },
                stats: {
                    totalInstallations: dbHealth.totalInstallations,
                },
                serverTime: new Date().toISOString(),
            });
        } catch (err) {
            return res.status(500).json({
                ok: false,
                error: redactSecretsFromText(err?.message || "Gagal memeriksa status layanan."),
            });
        }
    });

    // =========================================================================
    // 3. Provision a New Isolated Installation Session
    // =========================================================================
    app.post("/api/v1/installations/register", provisionLimiter, async (req, res) => {
        try {
            const { label, platform, nodeVersion } = req.body || {};
            const created = await createInstallation({ label, platform });

            if (nodeVersion && typeof nodeVersion === "string") {
                await updateInstallationMetadata(created.installation.installationId, {
                    nodeVersion: nodeVersion.slice(0, 24),
                });
            }

            // Issue HttpOnly Dashboard Session Cookie so browser wizard & dashboard stay synced safely
            const sessionToken = createDashboardSessionToken(created.installation.installationId);
            setSessionCookie(req, res, sessionToken);

            const baseUrl = resolvePublicBaseUrl(req);

            return res.status(201).json({
                ok: true,
                installation: created.installation,
                apiKey: created.apiKey, // Shown ONCE over HTTPS; hashed in DB
                installCommand: `curl -fsSL ${baseUrl}/install.sh | bash`,
                notice: "Simpan Installation ID dan Access Key Anda. Access Key dienkripsi satu arah (scrypt) dan hanya ditampilkan satu kali.",
            });
        } catch (err) {
            return res.status(500).json({
                ok: false,
                error: redactSecretsFromText(err?.message || "Gagal membuat sesi instalasi baru."),
            });
        }
    });

    // =========================================================================
    // 4. Secure Discord Bot Token Validation (POST Body Only, Zero Logging/Storage)
    // =========================================================================
    app.post("/api/v1/verify-token", authAndTokenLimiter, async (req, res) => {
        try {
            const rawToken = req.body?.token;
            const result = await verifyDiscordBotToken(rawToken);

            // Optionally update verified public bot identity on authenticated session (never saving the token!)
            const cookies = parseCookies(req.headers.cookie);
            const sessionPayload = verifyDashboardSessionToken(cookies[SESSION_COOKIE_NAME]);
            const authHeader = String(req.headers.authorization || "");
            const headerInstId = String(req.headers["x-lagukan-installation-id"] || "").trim();

            let verifiedInstId = null;
            if (authHeader.toLowerCase().startsWith("bearer ") && validateInstallationIdFormat(headerInstId)) {
                const inst = await verifyInstallationCredentials(headerInstId, authHeader.slice(7).trim());
                if (inst) verifiedInstId = inst.installationId;
            } else if (sessionPayload?.sub && validateInstallationIdFormat(sessionPayload.sub)) {
                verifiedInstId = sessionPayload.sub;
            }

            if (result.valid && verifiedInstId) {
                await updateInstallationMetadata(verifiedInstId, {
                    botApplicationId: result.bot?.id || null,
                    botUsername: result.bot?.username || null,
                    addStage: "token_verify",
                });
            }

            return res.status(result.valid ? 200 : 400).json({
                ok: result.valid,
                ...result,
            });
        } catch {
            return res.status(500).json({
                ok: false,
                valid: false,
                error: "Terjadi kesalahan internal saat memvalidasi format token.",
            });
        }
    });

    // =========================================================================
    // 5. Dashboard Authentication & Cross-Installation Isolated Endpoints
    // =========================================================================
    app.post("/api/v1/auth/login", authAndTokenLimiter, async (req, res) => {
        try {
            const installationId = String(req.body?.installationId || "").trim();
            const accessKey = String(req.body?.accessKey || req.body?.apiKey || "").trim();

            if (!validateInstallationIdFormat(installationId) || !accessKey) {
                return res.status(400).json({
                    ok: false,
                    error: "Format Installation ID atau Access Key tidak valid.",
                });
            }

            const verified = await verifyInstallationCredentials(installationId, accessKey);
            if (!verified) {
                return res.status(401).json({
                    ok: false,
                    error: "Installation ID atau Access Key salah.",
                });
            }

            const sessionToken = createDashboardSessionToken(verified.installationId);
            setSessionCookie(req, res, sessionToken);
            const dbHealth = await getCentralDbHealth();

            return res.json({
                ok: true,
                installation: serializeInstallationForClient(verified),
                mongodbService: {
                    connected: dbHealth.ok,
                    statusText: dbHealth.statusText,
                    tenantIsolation: dbHealth.tenantIsolation,
                    latencyMs: dbHealth.latencyMs,
                },
            });
        } catch (err) {
            return res.status(500).json({
                ok: false,
                error: redactSecretsFromText(err?.message || "Gagal memproses login dashboard."),
            });
        }
    });

    app.post("/api/v1/auth/logout", generalApiLimiter, (req, res) => {
        clearSessionCookie(req, res);
        return res.json({ ok: true });
    });

    app.get("/api/v1/auth/me", generalApiLimiter, authenticateInstallationRequest, async (req, res) => {
        const dbHealth = await getCentralDbHealth();
        return res.json({
            ok: true,
            installation: serializeInstallationForClient(req.authenticatedInstallation),
            mongodbService: {
                connected: dbHealth.ok,
                statusText: dbHealth.statusText,
                tenantIsolation: dbHealth.tenantIsolation,
                latencyMs: dbHealth.latencyMs,
            },
        });
    });

    app.get("/api/v1/installations/:installationId", generalApiLimiter, authenticateInstallationRequest, async (req, res) => {
        const requestedId = String(req.params.installationId || "").trim();
        if (requestedId !== req.authenticatedInstallationId) {
            return res.status(403).json({
                ok: false,
                error: "Akses ditolak: Anda hanya diizinkan melihat status instalasi milik Anda sendiri.",
            });
        }

        const dbHealth = await getCentralDbHealth();
        return res.json({
            ok: true,
            installation: serializeInstallationForClient(req.authenticatedInstallation),
            mongodbService: {
                connected: dbHealth.ok,
                statusText: dbHealth.statusText,
                tenantIsolation: dbHealth.tenantIsolation,
                latencyMs: dbHealth.latencyMs,
            },
        });
    });

    app.post("/api/v1/installations/stage", generalApiLimiter, authenticateInstallationRequest, async (req, res) => {
        const stage = String(req.body?.stage || "").trim();
        if (!INSTALL_STAGES_ORDER.includes(stage)) {
            return res.status(400).json({
                ok: false,
                error: `Tahapan "${stage}" tidak dikenali.`,
            });
        }

        const nextStatus = stage === "bot_ready" ? "configured" : req.authenticatedInstallation.status || "pending";
        const updated = await updateInstallationMetadata(req.authenticatedInstallationId, {
            addStage: stage,
            status: nextStatus,
        });

        return res.json({
            ok: true,
            installation: updated,
        });
    });

    app.post("/api/v1/installations/rotate-key", authAndTokenLimiter, authenticateInstallationRequest, async (req, res) => {
        try {
            const rotated = await rotateInstallationApiKey(req.authenticatedInstallationId);
            return res.json({
                ok: true,
                apiKey: rotated.apiKey,
                installation: rotated.installation,
                notice: "Access Key berhasil diperbarui. Salin key baru ini ke variabel LAGUKAN_API_KEY pada file ~/Lagukan/.env di Termux Anda.",
            });
        } catch (err) {
            return res.status(500).json({
                ok: false,
                error: redactSecretsFromText(err?.message || "Gagal memperbarui Access Key."),
            });
        }
    });

    app.post("/api/v1/installations/heartbeat", generalApiLimiter, authenticateInstallationRequest, async (req, res) => {
        const { version, guildCount, ping, botUsername, botApplicationId, nodeVersion, platform } = req.body || {};
        const updated = await updateInstallationMetadata(req.authenticatedInstallationId, {
            status: "active",
            lagukanVersion: typeof version === "string" ? version.slice(0, 20) : undefined,
            guildCount: Number.isFinite(Number(guildCount)) ? Math.max(0, Number(guildCount)) : undefined,
            ping: Number.isFinite(Number(ping)) ? Number(ping) : null,
            botUsername: typeof botUsername === "string" ? botUsername.slice(0, 48) : undefined,
            botApplicationId: typeof botApplicationId === "string" ? botApplicationId.slice(0, 24) : undefined,
            nodeVersion: typeof nodeVersion === "string" ? nodeVersion.slice(0, 24) : undefined,
            platform: typeof platform === "string" ? platform.slice(0, 40) : undefined,
            lastHeartbeatAt: new Date().toISOString(),
            addStage: "bot_ready",
        });

        return res.json({ ok: true, installation: updated });
    });

    // =========================================================================
    // 6. Central Cloud Database Gateway Endpoints (Authenticated & Tenant-Scoped)
    // =========================================================================
    app.post("/api/v1/db/ping", authenticateInstallationRequest, tenantDbLimiter, async (req, res) => {
        const start = Date.now();
        const dbHealth = await getCentralDbHealth();
        const { version, nodeVersion } = req.body || {};

        const updated = await updateInstallationMetadata(req.authenticatedInstallationId, {
            status: "configured",
            lagukanVersion: typeof version === "string" ? version.slice(0, 20) : undefined,
            nodeVersion: typeof nodeVersion === "string" ? nodeVersion.slice(0, 24) : undefined,
            lastDbActivityAt: new Date().toISOString(),
            addStage: "api_test",
        });

        return res.json({
            ok: dbHealth.ok,
            installationId: req.authenticatedInstallationId,
            latencyMs: Date.now() - start,
            mongodbService: dbHealth.statusText,
            installation: updated,
            serverTime: new Date().toISOString(),
        });
    });

    app.post("/api/v1/db/:model/:operation", authenticateInstallationRequest, tenantDbLimiter, async (req, res) => {
        try {
            const modelName = String(req.params.model || "").trim();
            const operation = String(req.params.operation || "").trim();

            const result = await executeTenantDatabaseOperation(req.authenticatedInstallationId, modelName, operation, req.body || {});

            return res.json({
                ok: true,
                result,
            });
        } catch (err) {
            return res.status(400).json({
                ok: false,
                error: redactSecretsFromText(err?.message || "Permintaan database ditolak."),
            });
        }
    });

    // Catch-all for unknown `/api/*` routes (never fall through to HTML)
    app.use("/api", (_req, res) => {
        return res.status(404).json({
            ok: false,
            error: "Endpoint API tidak ditemukan.",
        });
    });

    // =========================================================================
    // 7. Production Frontend Static Assets & SPA Fallback (`public-build/`)
    // =========================================================================
    const buildDir = path.join(__dirname, "../public-build");
    if (fs.existsSync(buildDir)) {
        app.use(express.static(buildDir, { index: false }));
        app.get("*", (req, res, next) => {
            if (req.path.startsWith("/api/") || req.path === "/install.sh") return next();
            return res.sendFile(path.join(buildDir, "index.html"));
        });
    }

    // Global Redacted Error Handler
    app.use((err, _req, res, _next) => {
        const safeErr = redactSecretsFromText(err?.message || "Internal server error");
        return res.status(err?.status || 500).json({
            ok: false,
            error: safeErr,
        });
    });

    return app;
}

module.exports = {
    createInstallerApp,
};
