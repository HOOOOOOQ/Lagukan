const crypto = require("node:crypto");

const ALLOWED_MODELS = new Set([
    "guild",
    "user",
    "playlist",
    "UserMusicProfiles",
    "ListeningHistory",
    "FavoriteTracks",
    "UserPlaylists",
    "MusicStatistics",
    "MusicWrapped",
    "MusicLeaderboard",
    "MusicRequestConfig",
    "DJConfig",
    "MusicParty",
    "GuessTheSong",
    "MusicBattle",
    "PremiumConfig",
    "Profile666Stats",
    "UserGuildAchievements",
    "MusicSession666",
    "ProfileNotificationConfig",
    "Auto247Config",
]);

const ALLOWED_DB_OPERATIONS = new Set([
    "find",
    "findOne",
    "findOneAndUpdate",
    "findOneAndDelete",
    "updateOne",
    "updateMany",
    "deleteOne",
    "deleteMany",
    "countDocuments",
    "create",
]);

const FORBIDDEN_MONGO_OPERATORS = new Set([
    "$where",
    "$function",
    "$accumulator",
    "$expr",
    "$jsonSchema",
    "$lookup",
    "$unionWith",
    "$out",
    "$merge",
]);

const ALLOWED_FILTER_OPERATORS = new Set([
    "$and",
    "$or",
    "$nor",
    "$not",
    "$eq",
    "$ne",
    "$gt",
    "$gte",
    "$lt",
    "$lte",
    "$in",
    "$nin",
    "$exists",
    "$regex",
    "$options",
    "$elemMatch",
    "$size",
    "$all",
]);

const ALLOWED_UPDATE_OPERATORS = new Set([
    "$set",
    "$setOnInsert",
    "$unset",
    "$inc",
    "$min",
    "$max",
    "$mul",
    "$push",
    "$pull",
    "$addToSet",
    "$pop",
    "$each",
    "$slice",
    "$position",
    "$sort",
]);

const FORBIDDEN_QUERY_SECRETS = [
    "token",
    "discord_token",
    "discordtoken",
    "apikey",
    "api_key",
    "mongouri",
    "mongo_uri",
    "password",
    "secret",
];

let ephemeralFallbackSecret = null;

function getSessionSecret() {
    const envSecret = String(process.env.SESSION_SECRET || "").trim();
    if (envSecret && envSecret !== "ganti_dengan_secret_acak_minimal_32_karakter_aman" && envSecret.length >= 24) {
        return envSecret;
    }
    if (!ephemeralFallbackSecret) {
        ephemeralFallbackSecret = crypto.randomBytes(32).toString("hex");
    }
    return ephemeralFallbackSecret;
}

function generateInstallationCredentials() {
    const installationId = `lgk_inst_${crypto.randomBytes(12).toString("hex")}`;
    const apiKey = `lgk_sk_${crypto.randomBytes(24).toString("hex")}`;
    const salt = crypto.randomBytes(16).toString("hex");
    const keyHash = hashApiKey(apiKey, salt);

    return {
        installationId,
        apiKey,
        salt,
        keyHash,
    };
}

function hashApiKey(apiKey, salt) {
    return crypto.scryptSync(String(apiKey), String(salt), 32).toString("hex");
}

function verifyApiKeyHash(apiKey, salt, expectedHexHash) {
    if (!apiKey || !salt || !expectedHexHash) return false;
    try {
        const computed = Buffer.from(hashApiKey(apiKey, salt), "hex");
        const expected = Buffer.from(String(expectedHexHash), "hex");
        if (computed.length !== expected.length) return false;
        return crypto.timingSafeEqual(computed, expected);
    } catch {
        return false;
    }
}

function createDashboardSessionToken(installationId, ttlMs = 12 * 60 * 60 * 1000) {
    const payload = {
        sub: String(installationId),
        iat: Date.now(),
        exp: Date.now() + ttlMs,
        nonce: crypto.randomBytes(8).toString("hex"),
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const sig = crypto.createHmac("sha256", getSessionSecret()).update(encoded).digest("base64url");
    return `${encoded}.${sig}`;
}

function verifyDashboardSessionToken(rawToken) {
    if (!rawToken || typeof rawToken !== "string" || !rawToken.includes(".")) return null;
    const parts = rawToken.split(".");
    if (parts.length !== 2) return null;

    const [encoded, providedSig] = parts;
    const expectedSig = crypto.createHmac("sha256", getSessionSecret()).update(encoded).digest("base64url");

    try {
        const a = Buffer.from(providedSig, "utf8");
        const b = Buffer.from(expectedSig, "utf8");
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

        const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
        if (!payload?.sub || typeof payload.exp !== "number" || Date.now() > payload.exp) {
            return null;
        }
        return payload;
    } catch {
        return null;
    }
}

function parseCookies(cookieHeader) {
    const out = {};
    if (!cookieHeader || typeof cookieHeader !== "string") return out;
    for (const part of cookieHeader.split(";")) {
        const idx = part.indexOf("=");
        if (idx <= 0) continue;
        const k = part.slice(0, idx).trim();
        const v = part.slice(idx + 1).trim();
        try {
            out[k] = decodeURIComponent(v);
        } catch {
            out[k] = v;
        }
    }
    return out;
}

function redactSecretsFromText(input) {
    if (input === null || input === undefined) return "";
    let text = String(input);
    // Redact MongoDB connection strings
    text = text.replace(/mongodb(?:\+srv)?:\/\/[^\s"'`]+/gi, "[REDACTED_MONGO_URI]");
    // Redact Lagukan secret API keys
    text = text.replace(/lgk_sk_[a-f0-9]{16,}/gi, "[REDACTED_API_KEY]");
    // Redact Discord Bot Token patterns (3 dot-separated base64url segments)
    text = text.replace(/[A-Za-z0-9_-]{20,36}\.[A-Za-z0-9_-]{6,10}\.[A-Za-z0-9_-]{25,64}/g, "[REDACTED_DISCORD_TOKEN]");
    return text;
}

function validateInstallationIdFormat(id) {
    return typeof id === "string" && /^lgk_inst_[a-f0-9]{16,40}$/.test(id.trim());
}

function sanitizeObjectDeep(value, mode = "filter", depth = 0) {
    if (depth > 8) {
        throw new Error("Kedalaman objek melampaui batas keamanan maksimum.");
    }

    if (value === null || value === undefined) return value;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (value instanceof Date) return value;

    if (Array.isArray(value)) {
        if (value.length > 600) {
            throw new Error("Ukuran array melampaui batas maksimum yang diizinkan.");
        }
        return value.map((item) => sanitizeObjectDeep(item, mode, depth + 1));
    }

    if (typeof value === "object") {
        const clean = {};
        for (const [key, val] of Object.entries(value)) {
            if (key === "__proto__" || key === "constructor" || key === "prototype") {
                throw new Error("Properti objek tidak diizinkan.");
            }
            if (key === "installationId") {
                // Strip any user-supplied installationId; server injects verified tenant ID
                continue;
            }
            if (key.startsWith("$")) {
                if (FORBIDDEN_MONGO_OPERATORS.has(key)) {
                    throw new Error(`Operator query "${key}" diblokir demi keamanan database pusat.`);
                }
                if (mode === "filter" && !ALLOWED_FILTER_OPERATORS.has(key)) {
                    throw new Error(`Operator filter "${key}" tidak diizinkan.`);
                }
                if (mode === "update" && !ALLOWED_UPDATE_OPERATORS.has(key) && !ALLOWED_FILTER_OPERATORS.has(key)) {
                    throw new Error(`Operator update "${key}" tidak diizinkan.`);
                }
                if (mode === "doc") {
                    throw new Error(`Operator "${key}" tidak diizinkan di dalam dokumen.`);
                }
            }
            clean[key] = sanitizeObjectDeep(val, mode, depth + 1);
        }
        return clean;
    }

    throw new Error("Tipe data payload tidak valid.");
}

function buildTenantIsolatedFilter(rawFilter, installationId) {
    const cleanFilter = sanitizeObjectDeep(rawFilter && typeof rawFilter === "object" ? rawFilter : {}, "filter");
    return {
        ...cleanFilter,
        installationId: String(installationId),
    };
}

function buildTenantIsolatedUpdate(rawUpdate, installationId) {
    const cleanUpdate = sanitizeObjectDeep(rawUpdate && typeof rawUpdate === "object" ? rawUpdate : {}, "update");
    const hasDollarOp = Object.keys(cleanUpdate).some((k) => k.startsWith("$"));

    if (!hasDollarOp) {
        return {
            $set: {
                ...cleanUpdate,
                installationId: String(installationId),
            },
        };
    }

    const result = { ...cleanUpdate };
    result.$set = {
        ...(result.$set && typeof result.$set === "object" ? result.$set : {}),
        installationId: String(installationId),
    };
    if (result.$setOnInsert && typeof result.$setOnInsert === "object") {
        delete result.$setOnInsert.installationId;
    }
    if (result.$unset && typeof result.$unset === "object") {
        delete result.$unset.installationId;
    }
    return result;
}

function buildTenantIsolatedDoc(rawDoc, installationId) {
    if (Array.isArray(rawDoc)) {
        if (rawDoc.length > 200) {
            throw new Error("Maksimal 200 dokumen per operasi create.");
        }
        return rawDoc.map((item) => ({
            ...sanitizeObjectDeep(item && typeof item === "object" ? item : {}, "doc"),
            installationId: String(installationId),
        }));
    }

    const cleanDoc = sanitizeObjectDeep(rawDoc && typeof rawDoc === "object" ? rawDoc : {}, "doc");
    return {
        ...cleanDoc,
        installationId: String(installationId),
    };
}

function createRateLimiter({
    windowMs = 60_000,
    max = 60,
    keyResolver = null,
    message = "Terlalu banyak permintaan. Coba lagi sebentar.",
}) {
    const buckets = new Map();

    const cleanupTimer = setInterval(
        () => {
            const now = Date.now();
            for (const [k, entry] of buckets.entries()) {
                if (now > entry.resetAt) buckets.delete(k);
            }
        },
        Math.max(30_000, windowMs),
    );

    if (typeof cleanupTimer.unref === "function") cleanupTimer.unref();

    return (req, res, next) => {
        const now = Date.now();
        const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
            .split(",")[0]
            .trim();
        const key = keyResolver ? `${keyResolver(req, ip)}` : ip;

        let entry = buckets.get(key);
        if (!entry || now > entry.resetAt) {
            entry = { count: 0, resetAt: now + windowMs };
            buckets.set(key, entry);
        }

        entry.count += 1;
        const remaining = Math.max(0, max - entry.count);
        res.setHeader("X-RateLimit-Limit", String(max));
        res.setHeader("X-RateLimit-Remaining", String(remaining));
        res.setHeader("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

        if (entry.count > max) {
            const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
            res.setHeader("Retry-After", String(retryAfterSec));
            return res.status(429).json({
                ok: false,
                error: message,
                retryAfterSeconds: retryAfterSec,
            });
        }

        return next();
    };
}

function rejectSecretsInQueryMiddleware(req, res, next) {
    const queryKeys = Object.keys(req.query || {});
    for (const qk of queryKeys) {
        if (FORBIDDEN_QUERY_SECRETS.includes(qk.toLowerCase())) {
            return res.status(400).json({
                ok: false,
                error: "Demi keamanan, dilarang mengirimkan token, API key, atau kredensial melalui parameter URL. Gunakan HTTPS POST body atau header Authorization.",
            });
        }
    }
    // Also detect raw Discord token pattern accidentally placed in URL path/query
    const rawUrl = String(req.originalUrl || req.url || "");
    if (/[A-Za-z0-9_-]{22,36}\.[A-Za-z0-9_-]{6,10}\.[A-Za-z0-9_-]{25,64}/.test(rawUrl)) {
        return res.status(400).json({
            ok: false,
            error: "Token terdeteksi di dalam URL dan otomatis ditolak. Jangan pernah menaruh Discord Token pada URL.",
        });
    }
    return next();
}

module.exports = {
    ALLOWED_MODELS,
    ALLOWED_DB_OPERATIONS,
    generateInstallationCredentials,
    hashApiKey,
    verifyApiKeyHash,
    createDashboardSessionToken,
    verifyDashboardSessionToken,
    parseCookies,
    redactSecretsFromText,
    validateInstallationIdFormat,
    buildTenantIsolatedFilter,
    buildTenantIsolatedUpdate,
    buildTenantIsolatedDoc,
    createRateLimiter,
    rejectSecretsInQueryMiddleware,
};
