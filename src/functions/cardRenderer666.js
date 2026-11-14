const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Logger = require("../utils/logger");
const { brandMark666, ambientDetails666, waveform666, artworkBadge666 } = require("./visualTheme666.js");

let resvgModule = null;
let wasmInitPromise = null;
let cachedFontBuffers = null;

const MAX_CARD_CACHE_ENTRIES = 120;
const MAX_REMOTE_IMAGE_CACHE_ENTRIES = 150;
const MAX_REMOTE_IMAGE_BYTES = 512 * 1024;

// Bounded LRU caches (shared safely across in-process bots since keys include guildId/botId/stateHash)
const renderedCardCache = new Map();
const remoteImageDataUriCache = new Map();

const THEME_666 = Object.freeze({
    embedColor: 0xb91f3b,
    embedMagenta: 0xe53955,
    embedDarkPurple: 0x49202f,
    bgDeep: "#080709",
    bgMid: "#100B10",
    bgPanel: "#150D13",
    neonPurple: "#B91F3B",
    neonMagenta: "#E53955",
    borderPurple: "#49202F",
    textPrimary: "#F5EDF0",
    textSecondary: "#B9AAB1",
    textMuted: "#786B73",
});

function setBoundedCache(map, key, value, maxEntries, ttlMs) {
    if (map.has(key)) {
        map.delete(key);
    } else if (map.size >= maxEntries) {
        const oldestKey = map.keys().next().value;
        if (oldestKey !== undefined) {
            map.delete(oldestKey);
        }
    }
    map.set(key, {
        value,
        expiresAt: Date.now() + ttlMs,
    });
}

function getBoundedCache(map, key) {
    const entry = map.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        map.delete(key);
        return null;
    }
    // Refresh LRU order
    map.delete(key);
    map.set(key, entry);
    return entry.value;
}

function loadFontBuffersOnce() {
    if (cachedFontBuffers) return cachedFontBuffers;

    const buffers = [];
    const candidatePaths = [
        path.join(__dirname, "../assets/fonts/Inter-Regular.ttf"),
        path.join(__dirname, "../assets/fonts/Inter-Bold.ttf"),
    ];

    try {
        const pkgDir = path.dirname(require.resolve("dejavu-fonts-ttf/package.json"));
        candidatePaths.push(path.join(pkgDir, "ttf", "DejaVuSans.ttf"));
        candidatePaths.push(path.join(pkgDir, "ttf", "DejaVuSans-Bold.ttf"));
    } catch {
        // Optional npm font fallback if not installed
    }

    // Android Termux & Linux/macOS/Windows fallbacks
    candidatePaths.push(
        "/system/fonts/Roboto-Regular.ttf",
        "/system/fonts/Roboto-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    );

    const seenSizes = new Set();
    for (const filePath of candidatePaths) {
        try {
            if (fs.existsSync(filePath)) {
                const buf = fs.readFileSync(filePath);
                const sig = `${path.basename(filePath)}:${buf.length}`;
                if (buf.length > 0 && !seenSizes.has(sig)) {
                    seenSizes.add(sig);
                    buffers.push(buf);
                }
                if (buffers.length >= 4) break;
            }
        } catch {
            // Ignore unreadable system font path
        }
    }

    cachedFontBuffers = buffers;
    return cachedFontBuffers;
}

async function ensureResvgInitialized() {
    if (resvgModule && wasmInitPromise) {
        await wasmInitPromise;
        return resvgModule;
    }

    if (!wasmInitPromise) {
        wasmInitPromise = (async () => {
            const mod = require("@resvg/resvg-wasm");
            const wasmPath = require.resolve("@resvg/resvg-wasm/index_bg.wasm");
            const wasmBuffer = fs.readFileSync(wasmPath);
            try {
                await mod.initWasm(wasmBuffer);
            } catch (err) {
                const msg = String(err?.message || err);
                if (!msg.toLowerCase().includes("already initialized")) {
                    throw err;
                }
            }
            resvgModule = mod;
            return mod;
        })().catch((err) => {
            wasmInitPromise = null;
            Logger.warn(`[CardRenderer666] Renderer WASM fallback ke mode Embed murni: ${err?.message || err}`);
            return null;
        });
    }

    return wasmInitPromise;
}

function escapeXml(str = "") {
    return String(str || "")
        .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F]/gu, "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function truncateText(str = "", maxChars = 32) {
    const clean = String(str || "")
        .replace(/\s+/g, " ")
        .trim();
    if (clean.length <= maxChars) return clean;
    return `${clean.slice(0, Math.max(1, maxChars - 1)).trim()}…`;
}

function hashState(payload) {
    return crypto.createHash("sha1").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

async function fetchImageDataUri(url) {
    if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) {
        return null;
    }

    const cleanUrl = url.replace(/\?size=\d+/i, "?size=128");
    const cached = getBoundedCache(remoteImageDataUriCache, cleanUrl);
    if (cached !== null) {
        return cached || null;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2200);
    if (typeof timer.unref === "function") timer.unref();

    try {
        const res = await fetch(cleanUrl, { signal: controller.signal });
        if (!res.ok) {
            setBoundedCache(remoteImageDataUriCache, cleanUrl, "", MAX_REMOTE_IMAGE_CACHE_ENTRIES, 60_000);
            return null;
        }
        const contentType = String(res.headers.get("content-type") || "image/png")
            .split(";")[0]
            .trim();
        if (!/^image\/(png|jpeg|jpg|gif)$/i.test(contentType)) {
            setBoundedCache(remoteImageDataUriCache, cleanUrl, "", MAX_REMOTE_IMAGE_CACHE_ENTRIES, 120_000);
            return null;
        }
        const arrBuf = await res.arrayBuffer();
        if (!arrBuf || arrBuf.byteLength === 0 || arrBuf.byteLength > MAX_REMOTE_IMAGE_BYTES) {
            setBoundedCache(remoteImageDataUriCache, cleanUrl, "", MAX_REMOTE_IMAGE_CACHE_ENTRIES, 120_000);
            return null;
        }
        const dataUri = `data:${contentType};base64,${Buffer.from(arrBuf).toString("base64")}`;
        setBoundedCache(remoteImageDataUriCache, cleanUrl, dataUri, MAX_REMOTE_IMAGE_CACHE_ENTRIES, 15 * 60_000);
        return dataUri;
    } catch {
        setBoundedCache(remoteImageDataUriCache, cleanUrl, "", MAX_REMOTE_IMAGE_CACHE_ENTRIES, 45_000);
        return null;
    } finally {
        clearTimeout(timer);
    }
}

function buildSharedDefsAndFrame(width, height) {
    return `
    <defs>
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#080709"/>
            <stop offset="52%" stop-color="#100B10"/>
            <stop offset="100%" stop-color="#150D13"/>
        </linearGradient>
        <linearGradient id="neonBorder" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#B91F3B"/>
            <stop offset="50%" stop-color="#E53955"/>
            <stop offset="100%" stop-color="#B91F3B"/>
        </linearGradient>
        <linearGradient id="barGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#B91F3B"/>
            <stop offset="55%" stop-color="#B91F3B"/>
            <stop offset="100%" stop-color="#FF4568"/>
        </linearGradient>
        <radialGradient id="auraTopRight" cx="88%" cy="15%" r="55%">
            <stop offset="0%" stop-color="#B91F3B" stop-opacity="0.24"/>
            <stop offset="60%" stop-color="#B91F3B" stop-opacity="0.08"/>
            <stop offset="100%" stop-color="#080709" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="auraBottomLeft" cx="12%" cy="88%" r="50%">
            <stop offset="0%" stop-color="#49202F" stop-opacity="0.22"/>
            <stop offset="100%" stop-color="#080709" stop-opacity="0"/>
        </radialGradient>
        <clipPath id="frameClip"><rect width="${width}" height="${height}" rx="22"/></clipPath>
        <pattern id="cyberGrid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#B91F3B" stroke-opacity="0.07" stroke-width="1"/>
        </pattern>
    </defs>
    <rect x="0" y="0" width="${width}" height="${height}" rx="22" fill="url(#bgGrad)"/>
    <rect x="0" y="0" width="${width}" height="${height}" rx="22" fill="url(#auraTopRight)"/>
    <rect x="0" y="0" width="${width}" height="${height}" rx="22" fill="url(#auraBottomLeft)"/>
    <g clip-path="url(#frameClip)">${ambientDetails666(width, height)}</g>
    <rect x="3" y="3" width="${width - 6}" height="${height - 6}" rx="20" fill="none" stroke="#49202F" stroke-width="1.5"/>
    <rect x="10" y="10" width="${width - 20}" height="${height - 20}" rx="15" fill="none" stroke="#B91F3B" stroke-opacity="0.24" stroke-width="1"/>
    `;
}

function buildLogo666Badge(x, y) {
    return `
    <g transform="translate(${x}, ${y})">
        <rect x="0" y="0" width="88" height="36" rx="10" fill="#1D1019" stroke="url(#neonBorder)" stroke-width="2"/>
        <circle cx="18" cy="18" r="5" fill="#E53955"/>
        <text x="52" y="25" text-anchor="middle" fill="#F5EDF0" font-family="Inter, DejaVu Sans, sans-serif" font-weight="bold" font-size="20" letter-spacing="2">666</text>
    </g>`;
}

async function renderSvgToPngBuffer(svg, cacheKey, ttlMs = 30_000) {
    if (cacheKey) {
        const cached = getBoundedCache(renderedCardCache, cacheKey);
        if (cached) return cached;
    }

    const mod = await ensureResvgInitialized();
    if (!mod?.Resvg) return null;

    try {
        const fontBuffers = loadFontBuffersOnce();
        const resvg = new mod.Resvg(svg, {
            font: {
                fontBuffers,
                loadSystemFonts: fontBuffers.length === 0,
                defaultFontFamily: "Inter",
            },
        });
        const pngData = resvg.render();
        const buffer = Buffer.from(pngData.asPng());
        if (cacheKey && buffer.length > 0) {
            setBoundedCache(renderedCardCache, cacheKey, buffer, MAX_CARD_CACHE_ENTRIES, ttlMs);
        }
        return buffer;
    } catch (err) {
        Logger.debug(`[CardRenderer666] Gagal merender kartu SVG: ${err?.message || err}`);
        return null;
    }
}

/**
 * 1. NOW PLAYING 666 CARD (cached by the supplied playback snapshot)
 */
async function renderNowPlayingCard666({
    botId = "bot",
    botName = "LAGUKAN 666",
    trackKey = "",
    title = "Unknown Title",
    author = "Unknown Artist",
    requester = "Listener",
    durationText = "00:00",
    elapsedText = "00:00",
    progressRatio = 0.08,
    artworkUrl = null,
    isPaused = false,
}) {
    const safeRatio = Math.max(0, Math.min(1, Number(progressRatio) || 0));
    const cacheKey = `np666:${hashState({ botId, botName, trackKey, title, author, requester, durationText, elapsedText, safeRatio, artworkUrl, isPaused })}`;
    const hit = getBoundedCache(renderedCardCache, cacheKey);
    if (hit) return hit;

    const coverUri = await fetchImageDataUri(artworkUrl);
    const width = 860;
    const height = 320;
    const barWidth = 530;
    const fillWidth = Math.round(barWidth * safeRatio);

    const coverMarkup = coverUri
        ? `<defs><clipPath id="npCoverClip"><rect x="34" y="68" width="184" height="184" rx="18"/></clipPath></defs>
           <image href="${coverUri}" x="34" y="68" width="184" height="184" preserveAspectRatio="xMidYMid slice" clip-path="url(#npCoverClip)"/>
           <rect x="34" y="68" width="184" height="184" rx="18" fill="none" stroke="url(#neonBorder)" stroke-width="2.5"/>`
        : `<rect x="34" y="68" width="184" height="184" rx="18" fill="#150D13" stroke="url(#neonBorder)" stroke-width="2.5"/>
           <circle cx="126" cy="160" r="56" fill="none" stroke="#E53955" stroke-width="2" stroke-opacity="0.6"/>
           <circle cx="126" cy="160" r="22" fill="#1D1019" stroke="#B91F3B" stroke-width="2"/>
           <text x="126" y="167" text-anchor="middle" fill="#F5EDF0" font-family="Inter, DejaVu Sans, sans-serif" font-weight="bold" font-size="18">666</text>`;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        ${buildSharedDefsAndFrame(width, height)}
        ${brandMark666(30, 13, 48)}
        <text x="94" y="43" fill="#F5EDF0" font-family="Inter, DejaVu Sans, sans-serif" font-weight="bold" font-size="18" letter-spacing="1">666 MUSIC <tspan fill="#B9AAB1">• NOW PLAYING</tspan></text>
        <path d="M30 67H830" stroke="#49202F"/>
        <rect x="${width - 180}" y="19" width="150" height="36" rx="18" fill="#1D1019" stroke="#E53955" stroke-width="1.4"/>
        <circle cx="${width - 158}" cy="37" r="5" fill="#F4778D"/>
        <text x="${width - 100}" y="42" text-anchor="middle" fill="#F4778D" font-family="Inter, DejaVu Sans, sans-serif" font-weight="bold" font-size="12" letter-spacing="1">${isPaused ? "PAUSED" : "LIVE AUDIO"}</text>
        ${waveform666(720, 105, 0.16)}
        <circle cx="190" cy="168" r="80" fill="#080709" stroke="#49202F" stroke-width="2"/>
        <circle cx="190" cy="168" r="72" fill="none" stroke="#49202F" stroke-opacity=".5"/>
        <rect x="30" y="64" width="192" height="192" rx="20" fill="none" stroke="#E53955" stroke-width="8" opacity=".13"/>
        ${coverMarkup}
        ${artworkBadge666(174, 208)}

        <text x="248" y="106" fill="#F5EDF0" font-family="Inter, DejaVu Sans, sans-serif" font-weight="bold" font-size="26"${title.length > 28 ? ' textLength="530" lengthAdjust="spacingAndGlyphs"' : ""}>${escapeXml(truncateText(title, 33))}</text>
        <text x="248" y="138" fill="#F4778D" font-family="Inter, DejaVu Sans, sans-serif" font-weight="bold" font-size="17">${escapeXml(truncateText(author, 42))}</text>

        <rect x="248" y="156" width="330" height="32" rx="9" fill="#150D13" stroke="#B91F3B" stroke-width="1.2"/>
        <text x="262" y="177" fill="#B9AAB1" font-family="Inter, DejaVu Sans, sans-serif" font-size="13">REQUESTED BY: <tspan fill="#F5EDF0" font-weight="bold">${escapeXml(truncateText(requester, 22))}</tspan></text>

        <!-- Neon Progress Bar -->
        <rect x="248" y="210" width="${barWidth}" height="12" rx="6" fill="#1D1019" stroke="#49202F" stroke-width="1"/>
        <rect x="248" y="210" width="${fillWidth}" height="12" rx="6" fill="url(#barGrad)"/>
        <circle cx="${248 + fillWidth}" cy="216" r="8" fill="#F4778D" stroke="#F5EDF0" stroke-width="2"/>

        <text x="248" y="244" fill="#B9AAB1" font-family="Inter, DejaVu Sans, sans-serif" font-weight="bold" font-size="13">${escapeXml(elapsedText)}</text>
        <text x="${248 + barWidth}" y="244" text-anchor="end" fill="#F5EDF0" font-family="Inter, DejaVu Sans, sans-serif" font-weight="bold" font-size="13">${escapeXml(durationText)}</text>
        <text x="34" y="292" fill="#B9AAB1" font-family="Inter, DejaVu Sans, sans-serif" font-size="13">BOT: ${escapeXml(truncateText(botName, 30))}</text>
    </svg>`;

    return renderSvgToPngBuffer(svg, cacheKey, 10 * 60_000);
}

/**
 * 2. MUSIC LEADERBOARD 666 CARD (Top 10 Guild Listeners, cached per guild/page state)
 */
async function renderLeaderboardCard666({
    guildId = "guild",
    guildName = "Discord Server",
    entries = [],
    page = 1,
    totalPages = 1,
    callerRank = null,
    callerUsername = "Listener",
}) {
    const sig = entries.map((e) => `${e.rank}:${e.userId}:${e.hoursText}:${e.totalPlays}`).join("|");
    const cacheKey = `lb666:${hashState({ guildId, page, totalPages, callerRank, sig })}`;
    const hit = getBoundedCache(renderedCardCache, cacheKey);
    if (hit) return hit;

    const rows = entries.slice(0, 10);
    const width = 900;
    const rowHeight = 46;
    const headerHeight = 92;
    const footerHeight = 58;
    const height = headerHeight + Math.max(3, rows.length) * rowHeight + footerHeight;

    let rowsMarkup = "";
    if (rows.length === 0) {
        rowsMarkup = `
        <rect x="34" y="102" width="${width - 68}" height="96" rx="14" fill="#150D13" stroke="#49202F" stroke-width="1.2"/>
        <text x="${width / 2}" y="156" text-anchor="middle" fill="#B9AAB1" font-family="Inter, DejaVu Sans, sans-serif" font-weight="bold" font-size="18">Belum ada riwayat pemutaran musik di server ini.</text>`;
    } else {
        rows.forEach((item, idx) => {
            const y = headerHeight + idx * rowHeight;
            const rank = Number(item.rank || idx + 1);
            let rankColor = "#786B73";
            let rowStroke = "#49202F";
            let medalBadge = `#${rank}`;

            if (rank === 1) {
                rankColor = "#F4778D";
                rowStroke = "#E53955";
                medalBadge = "TOP 1";
            } else if (rank === 2) {
                rankColor = "#F5EDF0";
                rowStroke = "#B91F3B";
                medalBadge = "TOP 2";
            } else if (rank === 3) {
                rankColor = "#B9AAB1";
                rowStroke = "#49202F";
                medalBadge = "TOP 3";
            }

            const initial = escapeXml(
                String(item.username || "U")
                    .charAt(0)
                    .toUpperCase() || "U",
            );

            rowsMarkup += `
            <g transform="translate(34, ${y})">
                <rect x="0" y="0" width="${width - 68}" height="38" rx="10" fill="#150D13" fill-opacity="0.92" stroke="${rowStroke}" stroke-width="1.2"/>
                <rect x="8" y="6" width="66" height="26" rx="7" fill="#1D1019"/>
                <text x="41" y="24" text-anchor="middle" fill="${rankColor}" font-family="Inter, DejaVu Sans, sans-serif" font-weight="bold" font-size="13">${medalBadge}</text>

                <circle cx="98" cy="19" r="13" fill="#1D1019" stroke="${rankColor}" stroke-width="1.5"/>
                <text x="98" y="24" text-anchor="middle" fill="#F5EDF0" font-family="Inter, DejaVu Sans, sans-serif" font-weight="bold" font-size="12">${initial}</text>

                <text x="122" y="24" fill="#F5EDF0" font-family="Inter, DejaVu Sans, sans-serif" font-weight="bold" font-size="15">${escapeXml(truncateText(item.username || item.userId, 28))}</text>

                <text x="${width - 255}" y="24" text-anchor="end" fill="#F4778D" font-family="Inter, DejaVu Sans, sans-serif" font-weight="bold" font-size="14">${escapeXml(item.hoursText || "0.00")}h</text>
                <text x="${width - 90}" y="24" text-anchor="end" fill="#B9AAB1" font-family="Inter, DejaVu Sans, sans-serif" font-weight="bold" font-size="14">${Number(item.totalPlays || 0)} Plays</text>
            </g>`;
        });
    }

    const footerY = height - 44;
    const callerLabel = callerRank
        ? `YOUR POSITION (${truncateText(callerUsername, 18)}): #${callerRank}`
        : `YOUR POSITION (${truncateText(callerUsername, 18)}): UNRANKED`;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        ${buildSharedDefsAndFrame(width, height)}
        ${buildLogo666Badge(34, 24)}
        <text x="136" y="45" fill="#F5EDF0" font-family="Inter, DejaVu Sans, sans-serif" font-weight="bold" font-size="22" letter-spacing="1">MUSIC LEADERBOARD</text>
        <text x="136" y="67" fill="#B9AAB1" font-family="Inter, DejaVu Sans, sans-serif" font-size="13">${escapeXml(truncateText(guildName, 44))} • TOP ACTIVE LISTENERS</text>

        <rect x="${width - 156}" y="26" width="122" height="32" rx="10" fill="#1D1019" stroke="#B91F3B" stroke-width="1.3"/>
        <text x="${width - 95}" y="47" text-anchor="middle" fill="#F5EDF0" font-family="Inter, DejaVu Sans, sans-serif" font-weight="bold" font-size="13">PAGE ${page} / ${totalPages}</text>

        ${rowsMarkup}

        <rect x="34" y="${footerY - 6}" width="${width - 68}" height="32" rx="9" fill="#150D13" stroke="#E53955" stroke-width="1.2"/>
        <text x="52" y="${footerY + 15}" fill="#F5EDF0" font-family="Inter, DejaVu Sans, sans-serif" font-weight="bold" font-size="13">${escapeXml(callerLabel)}</text>
        <text x="${width - 52}" y="${footerY + 15}" text-anchor="end" fill="#786B73" font-family="Inter, DejaVu Sans, sans-serif" font-size="12">666 MUSIC • LISTENING ACTIVITY</text>
    </svg>`;

    return renderSvgToPngBuffer(svg, cacheKey, 30_000);
}

/**
 * 3. USER MUSIC PROFILE 666 CARD (`/profile`)
 */
async function renderUserProfileCard666({
    guildId = "guild",
    guildName = "Discord Server",
    userId = "0",
    username = "Listener",
    avatarUrl = null,
    totalPlays = 0,
    totalHoursText = "0.00",
    favoriteSong = "Belum ada lagu favorit",
    joinServerText = "-",
    activityRankText = "Unranked",
    hasMusicLoverBadge = false,
    badgeLabels = [],
}) {
    const cacheKey = `prof666:${hashState({
        guildId,
        userId,
        username,
        avatarUrl,
        totalPlays,
        totalHoursText,
        favoriteSong,
        joinServerText,
        activityRankText,
        hasMusicLoverBadge,
        badgeLabels,
    })}`;
    const hit = getBoundedCache(renderedCardCache, cacheKey);
    if (hit) return hit;

    const avatarUri = await fetchImageDataUri(avatarUrl);
    const width = 900;
    const height = 390;

    const avatarMarkup = avatarUri
        ? `<defs><clipPath id="profAvatarClip"><circle cx="116" cy="158" r="62"/></clipPath></defs>
           <circle cx="116" cy="158" r="66" fill="none" stroke="url(#neonBorder)" stroke-width="3.5"/>
           <image href="${avatarUri}" x="54" y="96" width="124" height="124" preserveAspectRatio="xMidYMid slice" clip-path="url(#profAvatarClip)"/>`
        : `<circle cx="116" cy="158" r="64" fill="#1D1019" stroke="url(#neonBorder)" stroke-width="3.5"/>
           <text x="116" y="172" text-anchor="middle" fill="#F5EDF0" font-family="Inter, DejaVu Sans, sans-serif" font-weight="bold" font-size="40">${escapeXml(
               String(username || "U")
                   .charAt(0)
                   .toUpperCase(),
           )}</text>`;

    const loverBadgeFill = hasMusicLoverBadge ? "#1D1019" : "#100B10";
    const loverBadgeStroke = hasMusicLoverBadge ? "#E53955" : "#49202F";
    const loverBadgeText = hasMusicLoverBadge ? "MUSIC LOVER UNLOCKED" : "MUSIC LOVER (LOCKED • 10H)";

    const extraBadgesText =
        Array.isArray(badgeLabels) && badgeLabels.length > 0
            ? truncateText(badgeLabels.join(" • "), 64)
            : "Putar lagu di Voice Channel untuk membuka Achievement 666";

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        ${buildSharedDefsAndFrame(width, height)}
        ${buildLogo666Badge(34, 24)}
        <text x="136" y="46" fill="#F5EDF0" font-family="Inter, DejaVu Sans, sans-serif" font-weight="bold" font-size="22" letter-spacing="1.2">USER MUSIC PROFILE</text>
        <text x="136" y="67" fill="#B9AAB1" font-family="Inter, DejaVu Sans, sans-serif" font-size="13">${escapeXml(truncateText(guildName, 48))}</text>

        <!-- Music Lover Badge Pill -->
        <rect x="${width - 286}" y="25" width="252" height="34" rx="17" fill="${loverBadgeFill}" stroke="${loverBadgeStroke}" stroke-width="1.6"/>
        <text x="${width - 160}" y="47" text-anchor="middle" fill="#F5EDF0" font-family="Inter, DejaVu Sans, sans-serif" font-weight="bold" font-size="12" letter-spacing="0.8">${escapeXml(loverBadgeText)}</text>

        ${avatarMarkup}

        <!-- Identity Header -->
        <text x="206" y="118" fill="#F5EDF0" font-family="Inter, DejaVu Sans, sans-serif" font-weight="bold" font-size="27">${escapeXml(truncateText(username, 26))}</text>
        <text x="206" y="143" fill="#B9AAB1" font-family="Inter, DejaVu Sans, sans-serif" font-size="14">USER ID: <tspan fill="#F5EDF0" font-weight="bold">${escapeXml(userId)}</tspan>   •   JOIN SERVER: <tspan fill="#F5EDF0" font-weight="bold">${escapeXml(joinServerText)}</tspan></text>

        <!-- 3 Stat Boxes: Total Play | Total Hours | Activity Rank -->
        <g transform="translate(206, 162)">
            <rect x="0" y="0" width="206" height="74" rx="12" fill="#150D13" stroke="#49202F" stroke-width="1.4"/>
            <text x="18" y="26" fill="#786B73" font-family="Inter, DejaVu Sans, sans-serif" font-weight="bold" font-size="12">TOTAL PLAY</text>
            <text x="18" y="56" fill="#F5EDF0" font-family="Inter, DejaVu Sans, sans-serif" font-weight="bold" font-size="24">${Number(totalPlays || 0)} Lagu</text>

            <rect x="224" y="0" width="206" height="74" rx="12" fill="#150D13" stroke="#E53955" stroke-width="1.4"/>
            <text x="242" y="26" fill="#F4778D" font-family="Inter, DejaVu Sans, sans-serif" font-weight="bold" font-size="12">TOTAL HOURS</text>
            <text x="242" y="56" fill="#F5EDF0" font-family="Inter, DejaVu Sans, sans-serif" font-weight="bold" font-size="24">${escapeXml(totalHoursText)} Jam</text>

            <rect x="448" y="0" width="212" height="74" rx="12" fill="#150D13" stroke="#B91F3B" stroke-width="1.4"/>
            <text x="466" y="26" fill="#F4778D" font-family="Inter, DejaVu Sans, sans-serif" font-weight="bold" font-size="12">ACTIVITY RANK</text>
            <text x="466" y="56" fill="#F4778D" font-family="Inter, DejaVu Sans, sans-serif" font-weight="bold" font-size="24">${escapeXml(activityRankText)}</text>
        </g>

        <!-- Favorite Song Box -->
        <rect x="34" y="256" width="${width - 68}" height="54" rx="12" fill="#150D13" stroke="#B91F3B" stroke-width="1.4"/>
        <text x="54" y="278" fill="#F4778D" font-family="Inter, DejaVu Sans, sans-serif" font-weight="bold" font-size="12">FAVORITE SONG (MOST PLAYED)</text>
        <text x="54" y="299" fill="#F5EDF0" font-family="Inter, DejaVu Sans, sans-serif" font-weight="bold" font-size="16">${escapeXml(truncateText(favoriteSong, 72))}</text>

        <!-- Achievements Strip -->
        <rect x="34" y="322" width="${width - 68}" height="42" rx="11" fill="#150D13" stroke="#E53955" stroke-width="1.2"/>
        <text x="54" y="348" fill="#F5EDF0" font-family="Inter, DejaVu Sans, sans-serif" font-weight="bold" font-size="13">BADGES: <tspan fill="#B9AAB1" font-weight="normal">${escapeXml(extraBadgesText)}</tspan></text>
    </svg>`;

    return renderSvgToPngBuffer(svg, cacheKey, 25_000);
}

function invalidateGuildCardCache(guildId) {
    if (!guildId) return;
    renderedCardCache.clear();
}

module.exports = {
    THEME_666,
    ensureResvgInitialized,
    renderSvgToPngBuffer,
    renderNowPlayingCard666,
    renderLeaderboardCard666,
    renderUserProfileCard666,
    invalidateGuildCardCache,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
