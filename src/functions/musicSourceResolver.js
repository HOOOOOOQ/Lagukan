const { RainlinkTrack, RainlinkSearchResultType } = require("rainlink");
const { getAnyConnectedNode, nodeSupportsSource } = require("./nodeHealthManager.js");
const { PLAYER_STATE_DESTROYED, isGuildManuallyDisconnected, isGuildLeavingInProgress } = require("./voiceSessionManager.js");
const Logger = require("../utils/logger");

const MAX_QUERY_LENGTH = 500;
const RATE_LIMIT_WINDOW_MS = 10000;
const RATE_LIMIT_MAX_REQUESTS = 6;
const DEFAULT_FETCH_TIMEOUT_MS = 8000;

const userSearchTimestamps = new Map();

const DIRECT_AUDIO_EXTENSIONS = new Set([".mp3", ".flac", ".wav", ".ogg", ".oga", ".opus", ".m4a", ".aac", ".webm", ".m3u8", ".mp4"]);

const SPOTIFY_URI_REGEX =
    /^(?:https?:\/\/open\.spotify\.com\/(?:intl-[a-zA-Z-]+\/)?(?:embed\/)?|spotify:)(track|playlist|album|artist)[/:]([A-Za-z0-9]+)/i;
const SPOTIFY_SHORT_REGEX = /^https?:\/\/(?:spotify\.link|spoti\.fi)\/[A-Za-z0-9_-]+/i;
const DEEZER_URL_REGEX = /^https?:\/\/(?:www\.)?deezer\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(track|album|playlist)\/(\d+)/i;
const DEEZER_SHORT_REGEX = /^https?:\/\/(?:deezer\.page\.link|dzr\.page\.link)\/[A-Za-z0-9_-]+/i;
const SOUNDCLOUD_URL_REGEX = /^https?:\/\/(?:(?:www|m|on)\.)?soundcloud\.com\/.+/i;
const YOUTUBE_MUSIC_URL_REGEX = /^https?:\/\/music\.youtube\.com\/.+/i;
const YOUTUBE_URL_REGEX = /^https?:\/\/(?:(?:www|m)\.)?(?:youtube\.com|youtu\.be)\/.+/i;
const BANDCAMP_URL_REGEX = /^https?:\/\/[a-z0-9-]+\.bandcamp\.com\/(track|album)\/[a-z0-9-]+/i;

const spotifyTokenCache = {
    accessToken: null,
    expiresAt: 0,
};

function sanitizeMusicQuery(raw) {
    if (typeof raw !== "string") return "";
    return raw.replace(/[\u0000-\u001F\u007F]/g, "").trim();
}

/**
 * Per-user anti-spam rate limiter for search & play commands.
 */
function checkSearchRateLimit(userId) {
    if (!userId) return { allowed: true, retryAfterMs: 0 };
    const key = String(userId);
    const now = Date.now();
    const recent = (userSearchTimestamps.get(key) || []).filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);

    if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
        const retryAfterMs = Math.max(1000, RATE_LIMIT_WINDOW_MS - (now - recent[0]));
        userSearchTimestamps.set(key, recent);
        return { allowed: false, retryAfterMs };
    }

    recent.push(now);
    userSearchTimestamps.set(key, recent);

    if (userSearchTimestamps.size > 2000) {
        for (const [k, list] of userSearchTimestamps.entries()) {
            if (!list.length || now - list[list.length - 1] >= RATE_LIMIT_WINDOW_MS) {
                userSearchTimestamps.delete(k);
            }
        }
    }

    return { allowed: true, retryAfterMs: 0 };
}

/**
 * Blocks SSRF against localhost, loopback, RFC1918 private networks, link-local, and metadata IPs.
 */
function isBlockedHost(hostname) {
    if (!hostname) return true;
    const host = String(hostname)
        .toLowerCase()
        .replace(/^\[|\]$/g, "");

    if (
        host === "localhost" ||
        host.endsWith(".localhost") ||
        host.endsWith(".local") ||
        host.endsWith(".internal") ||
        host === "0.0.0.0" ||
        host === "::1" ||
        host === "::" ||
        host.startsWith("fe80:") ||
        host.startsWith("fc") ||
        host.startsWith("fd")
    ) {
        return true;
    }

    const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (ipv4Match) {
        const octets = ipv4Match.slice(1).map(Number);
        if (octets.some((n) => n < 0 || n > 255)) return true;
        const [a, b] = octets;
        if (
            a === 0 ||
            a === 10 ||
            a === 127 ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            a >= 224
        ) {
            return true;
        }
    }

    return false;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (typeof timer.unref === "function") timer.unref();

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
                "User-Agent": "LagukanMusicBot/3.2 (+https://github.com/HOOOOOOQ/Lagukan)",
                ...(options.headers || {}),
            },
        });
    } finally {
        clearTimeout(timer);
    }
}

async function validateDirectAudioUrl(urlString) {
    let parsed;
    try {
        parsed = new URL(urlString);
    } catch {
        return { valid: false, reason: "Invalid URL format." };
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { valid: false, reason: "Only HTTP/HTTPS audio URLs are supported." };
    }

    if (parsed.username || parsed.password) {
        return { valid: false, reason: "URLs containing embedded credentials are not allowed." };
    }

    if (isBlockedHost(parsed.hostname)) {
        return { valid: false, reason: "Private, local, or internal network URLs are blocked for security." };
    }

    const lowerPath = parsed.pathname.toLowerCase();
    for (const ext of DIRECT_AUDIO_EXTENSIONS) {
        if (lowerPath.endsWith(ext)) {
            return { valid: true, url: parsed.toString() };
        }
    }

    // Probe Content-Type via HEAD when URL has no explicit audio file extension
    try {
        const headRes = await fetchWithTimeout(parsed.toString(), { method: "HEAD", redirect: "follow" }, 4000);
        const finalHost = (() => {
            try {
                return new URL(headRes.url || parsed.toString()).hostname;
            } catch {
                return parsed.hostname;
            }
        })();

        if (isBlockedHost(finalHost)) {
            return { valid: false, reason: "Redirect to a private/local network address is blocked." };
        }

        const contentType = String(headRes.headers.get("content-type") || "").toLowerCase();
        if (contentType.startsWith("audio/") || contentType.includes("application/ogg") || contentType.includes("mpegurl")) {
            return { valid: true, url: headRes.url || parsed.toString() };
        }
    } catch {
        // Ignore HEAD failure and treat as non-direct audio URL
    }

    return { valid: false, reason: "The provided link is not a supported music platform or direct audio stream." };
}

/**
 * Classifies a user query into a concrete music source type.
 */
function detectMusicQuery(rawInput) {
    const query = sanitizeMusicQuery(rawInput);
    if (!query) {
        return { valid: false, type: "empty", query: "", error: "Please enter a song title or valid music URL." };
    }

    if (query.length > MAX_QUERY_LENGTH) {
        return {
            valid: false,
            type: "too_long",
            query,
            error: `Query is too long (maximum ${MAX_QUERY_LENGTH} characters).`,
        };
    }

    if (/^spotify:(track|playlist|album|artist):[A-Za-z0-9]+$/i.test(query)) {
        const [, entityType, entityId] = SPOTIFY_URI_REGEX.exec(query) || [];
        return {
            valid: true,
            type: "spotify",
            isUrl: true,
            query: `https://open.spotify.com/${entityType.toLowerCase()}/${entityId}`,
            entityType: entityType.toLowerCase(),
            entityId,
        };
    }

    const isHttpUrl = /^https?:\/\/\S+$/i.test(query);
    if (!isHttpUrl) {
        return { valid: true, type: "text", isUrl: false, query };
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(query);
    } catch {
        return { valid: false, type: "invalid_url", query, error: "Invalid URL format." };
    }

    if (isBlockedHost(parsedUrl.hostname)) {
        return {
            valid: false,
            type: "blocked_url",
            query,
            error: "Local or private network URLs are not permitted.",
        };
    }

    if (SPOTIFY_URI_REGEX.test(query)) {
        const [, entityType, entityId] = SPOTIFY_URI_REGEX.exec(query);
        return {
            valid: true,
            type: "spotify",
            isUrl: true,
            query,
            entityType: entityType.toLowerCase(),
            entityId,
        };
    }

    if (SPOTIFY_SHORT_REGEX.test(query)) {
        return { valid: true, type: "spotify_short", isUrl: true, query };
    }

    if (YOUTUBE_MUSIC_URL_REGEX.test(query)) {
        return { valid: true, type: "youtube_music", isUrl: true, query };
    }

    if (YOUTUBE_URL_REGEX.test(query)) {
        return { valid: true, type: "youtube", isUrl: true, query };
    }

    if (SOUNDCLOUD_URL_REGEX.test(query)) {
        return { valid: true, type: "soundcloud", isUrl: true, query };
    }

    if (DEEZER_URL_REGEX.test(query)) {
        const [, entityType, entityId] = DEEZER_URL_REGEX.exec(query);
        return {
            valid: true,
            type: "deezer",
            isUrl: true,
            query,
            entityType: entityType.toLowerCase(),
            entityId,
        };
    }

    if (DEEZER_SHORT_REGEX.test(query)) {
        return { valid: true, type: "deezer_short", isUrl: true, query };
    }

    if (BANDCAMP_URL_REGEX.test(query)) {
        return { valid: true, type: "bandcamp", isUrl: true, query };
    }

    return { valid: true, type: "candidate_url", isUrl: true, query };
}

function normalizeForComparison(str) {
    return String(str || "")
        .toLowerCase()
        .replace(/ - topic$/i, "")
        .replace(/\((?:official|lyric|lyrics|audio|video|music video|visualizer|hd|hq)[^)]*\)/gi, " ")
        .replace(/\[(?:official|lyric|lyrics|audio|video|music video|visualizer|hd|hq)[^\]]*\]/gi, " ")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Scores a candidate Lavalink track against target metadata (title, artist, duration, ISRC)
 * so Spotify/Deezer metadata-only tracks resolve to accurate official audio streams.
 */
function scoreReplacementCandidate(target, candidateTrack) {
    if (!candidateTrack || !candidateTrack.encoded) return -999;

    const targetTitle = normalizeForComparison(target.title);
    const targetAuthor = normalizeForComparison(target.author);
    const candTitle = normalizeForComparison(candidateTrack.title);
    const candAuthor = normalizeForComparison(candidateTrack.author);
    const rawCandTitleLower = String(candidateTrack.title || "").toLowerCase();
    const rawTargetTitleLower = String(target.title || "").toLowerCase();

    let score = 0;

    if (target.isrc && candidateTrack.isrc && String(target.isrc).toUpperCase() === String(candidateTrack.isrc).toUpperCase()) {
        score += 65;
    }

    // Title matching
    if (targetTitle && candTitle) {
        if (candTitle === targetTitle) {
            score += 40;
        } else if (candTitle.includes(targetTitle) || targetTitle.includes(candTitle)) {
            score += 28;
        } else {
            const targetWords = targetTitle.split(" ").filter((w) => w.length > 1);
            if (targetWords.length) {
                const matched = targetWords.filter((w) => candTitle.includes(w)).length;
                score += Math.round((matched / targetWords.length) * 26);
            }
        }
    }

    // Penalize unwanted remixes/versions when the target song is the original version
    const unwantedMarkers = ["karaoke", "nightcore", "8d", "slowed", "reverb", "instrumental", "cover", "1 hour", "full album"];
    for (const marker of unwantedMarkers) {
        if (rawCandTitleLower.includes(marker) && !rawTargetTitleLower.includes(marker)) {
            score -= 22;
        }
    }

    // Artist matching
    if (targetAuthor) {
        const primaryAuthors = String(target.author || "")
            .split(/,|&|\/|feat\.?|ft\.?/i)
            .map((a) => normalizeForComparison(a))
            .filter(Boolean);

        const authorMatched = primaryAuthors.some((a) => a && (candAuthor.includes(a) || a.includes(candAuthor) || candTitle.includes(a)));

        if (authorMatched) {
            score += 30;
        } else {
            score -= 10;
        }

        if (/ - topic$/i.test(String(candidateTrack.author || ""))) {
            score += 10;
        }
    }

    // Duration proximity matching
    if (target.duration > 0 && candidateTrack.duration > 0 && !candidateTrack.isStream) {
        const diffMs = Math.abs(target.duration - candidateTrack.duration);
        if (diffMs <= 2500) score += 25;
        else if (diffMs <= 6000) score += 18;
        else if (diffMs <= 15000) score += 8;
        else if (diffMs <= 35000) score -= 5;
        else if (diffMs <= 120000) score -= 25;
        else score -= 65;
    }

    if (candidateTrack.isStream) {
        score -= 40;
    }

    return score;
}

/**
 * Attaches a smart, bounded multi-engine audio replacement resolver onto a metadata-only RainlinkTrack
 * (e.g. Spotify / Deezer metadata) so Lavalink resolves legal replacement audio matching title, artist & duration.
 */
function createMetadataBackedTrack(metadata, requester, driverId = "lavalink/v4/koinu") {
    const track = new RainlinkTrack(
        {
            encoded: "",
            info: {
                identifier: String(metadata.identifier || metadata.uri || metadata.title || "unknown"),
                isSeekable: true,
                author: metadata.author || "Unknown",
                length: Number(metadata.duration || 0),
                isStream: false,
                position: 0,
                title: metadata.title || "Unknown",
                uri: metadata.uri || "",
                artworkUrl: metadata.artworkUrl || null,
                isrc: metadata.isrc || null,
                sourceName: metadata.originalSource || "spotify",
            },
            pluginInfo: {
                originalSource: metadata.originalSource || "spotify",
                originalUri: metadata.uri || "",
                isMetadataOnly: true,
                resolvedVia: null,
            },
        },
        requester,
        driverId,
    );

    track.resolver = async function smartMetadataResolver(player) {
        if (this.isPlayable && this.driverName === player.node?.driver?.id) {
            this.realUri = this.raw.info.uri;
            return this;
        }

        const cleanAuthor = String(this.author || "")
            .replace(/ - Topic$/i, "")
            .trim();
        const cleanTitle = String(this.title || "").trim();
        const searchQuery = [cleanAuthor, cleanTitle].filter(Boolean).join(" - ") || cleanTitle;
        const origSourceLower = String(metadata.originalSource || this.source || "").toLowerCase();

        // If the stored track already points to a playable direct URL (YouTube, SoundCloud, Bandcamp, HTTP), try it first
        if (origSourceLower !== "spotify" && origSourceLower !== "deezer" && /^https?:\/\/\S+$/i.test(String(this.uri || ""))) {
            const directRes = await player.search(`directSearch=${this.uri}`, { requester: this.requester }).catch(() => null);
            const directTrack = directRes?.tracks?.[0];
            if (directTrack?.encoded) {
                this.encoded = directTrack.encoded;
                this.realUri = directTrack.uri || this.uri;
                this.duration = directTrack.duration || this.duration;
                this.isSeekable = directTrack.isSeekable;
                this.isStream = directTrack.isStream;
                this.source = directTrack.source || this.source;
                this.driverName = player.node?.driver?.id || this.driverName;
                if (!this.artworkUrl && directTrack.artworkUrl) {
                    this.artworkUrl = directTrack.artworkUrl;
                }
                this.pluginInfo = {
                    ...(this.pluginInfo || {}),
                    isMetadataOnly: false,
                    resolvedVia: directTrack.source || origSourceLower,
                };
                return this;
            }
        }

        const enginePrefixes = [
            { prefix: "ytmsearch", label: "youtubeMusic" },
            { prefix: "ytsearch", label: "youtube" },
            { prefix: "scsearch", label: "soundcloud" },
        ];

        let bestMatch = null;
        let bestScore = -999;
        let bestEngineLabel = null;

        for (const engine of enginePrefixes) {
            const res = await player
                .search(`directSearch=${engine.prefix}:${searchQuery}`, { requester: this.requester })
                .catch(() => null);

            const candidates = Array.isArray(res?.tracks) ? res.tracks.slice(0, 8) : [];
            for (const candidate of candidates) {
                const score = scoreReplacementCandidate(
                    {
                        title: cleanTitle,
                        author: cleanAuthor,
                        duration: this.duration,
                        isrc: this.isrc,
                    },
                    candidate,
                );

                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = candidate;
                    bestEngineLabel = engine.label;
                }
            }

            // Early exit once we have a high-confidence official match (title + artist + duration aligned)
            if (bestMatch && bestScore >= 75) {
                break;
            }
        }

        if (!bestMatch || !bestMatch.encoded) {
            throw new Error(`No playable replacement audio found for "${cleanTitle} - ${cleanAuthor}"`);
        }

        this.encoded = bestMatch.encoded;
        this.realUri = bestMatch.uri || this.uri;
        this.duration = bestMatch.duration || this.duration;
        this.isSeekable = bestMatch.isSeekable;
        this.isStream = bestMatch.isStream;
        this.driverName = player.node?.driver?.id || this.driverName;
        if (!this.artworkUrl && bestMatch.artworkUrl) {
            this.artworkUrl = bestMatch.artworkUrl;
        }
        this.pluginInfo = {
            ...(this.pluginInfo || {}),
            originalSource: metadata.originalSource || this.source,
            originalUri: metadata.uri || this.uri,
            isMetadataOnly: true,
            resolvedVia: bestEngineLabel || bestMatch.source || "youtubeMusic",
        };

        return this;
    };

    return track;
}

/**
 * Formats a human-friendly, honest source label for embeds & Now Playing dashboard.
 */
function formatTrackSourceLabel(track) {
    if (!track) return "Music";

    const orig = String(track.pluginInfo?.originalSource || "").toLowerCase();
    const resolvedVia = String(track.pluginInfo?.resolvedVia || "").toLowerCase();
    const rawSource = String(track.source || "music").toLowerCase();

    const prettyMap = {
        youtubemusic: "YouTube Music",
        youtube_music: "YouTube Music",
        ytm: "YouTube Music",
        youtube: "YouTube",
        yt: "YouTube",
        soundcloud: "SoundCloud",
        sc: "SoundCloud",
        spotify: "Spotify",
        deezer: "Deezer",
        bandcamp: "Bandcamp",
        http: "Direct Audio",
        local: "Direct Audio",
    };

    if (orig === "spotify") {
        const via = prettyMap[resolvedVia] || (rawSource !== "spotify" ? prettyMap[rawSource] : null);
        return via ? `Spotify (via ${via})` : "Spotify (Metadata Mirror)";
    }

    if (orig === "deezer") {
        const via = prettyMap[resolvedVia] || (rawSource !== "deezer" ? prettyMap[rawSource] : null);
        return via ? `Deezer (via ${via})` : "Deezer (Metadata Mirror)";
    }

    return prettyMap[rawSource] || rawSource.charAt(0).toUpperCase() + rawSource.slice(1);
}

async function getSpotifyClientToken() {
    const clientId = String(process.env.SPOTIFY_CLIENT_ID || "").trim();
    const clientSecret = String(process.env.SPOTIFY_CLIENT_SECRET || "").trim();
    if (!clientId || !clientSecret) return null;

    if (spotifyTokenCache.accessToken && Date.now() < spotifyTokenCache.expiresAt - 30000) {
        return spotifyTokenCache.accessToken;
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const response = await fetchWithTimeout("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
    });

    if (!response.ok) {
        throw new Error(`Spotify OAuth failed with HTTP ${response.status}`);
    }

    const body = await response.json();
    if (!body?.access_token) {
        throw new Error("Spotify OAuth response did not include an access_token");
    }

    spotifyTokenCache.accessToken = body.access_token;
    spotifyTokenCache.expiresAt = Date.now() + Number(body.expires_in || 3600) * 1000;
    return spotifyTokenCache.accessToken;
}

function mapSpotifyApiTrack(item, fallbackCover = null) {
    if (!item || !item.id || !item.name || item.type === "episode") return null;
    const artists = Array.isArray(item.artists)
        ? item.artists
              .map((a) => a?.name)
              .filter(Boolean)
              .join(", ")
        : "Unknown";
    const cover = item.album?.images?.[0]?.url || fallbackCover || null;

    return {
        identifier: item.id,
        title: item.name,
        author: artists || "Unknown",
        duration: Number(item.duration_ms || 0),
        uri: `https://open.spotify.com/track/${item.id}`,
        artworkUrl: cover,
        isrc: item.external_ids?.isrc || null,
        originalSource: "spotify",
    };
}

async function fetchSpotifyViaOfficialApi(entityType, entityId) {
    const token = await getSpotifyClientToken();
    if (!token) return null;

    const market = String(process.env.SPOTIFY_MARKET || "ID").trim() || "ID";
    const maxPages = Math.min(Math.max(Number.parseInt(process.env.SPOTIFY_PAGE_LIMIT || "5", 10) || 5, 1), 10);

    const apiGet = async (urlOrPath) => {
        const fullUrl = urlOrPath.startsWith("http") ? urlOrPath : `https://api.spotify.com/v1${urlOrPath}`;
        const res = await fetchWithTimeout(fullUrl, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
            throw new Error(`Spotify API HTTP ${res.status}`);
        }
        return res.json();
    };

    if (entityType === "track") {
        const track = await apiGet(`/tracks/${entityId}?market=${encodeURIComponent(market)}`);
        const mapped = mapSpotifyApiTrack(track);
        return mapped ? { type: "TRACK", playlistName: undefined, tracks: [mapped] } : null;
    }

    if (entityType === "album") {
        const album = await apiGet(`/albums/${entityId}?market=${encodeURIComponent(market)}`);
        const cover = album?.images?.[0]?.url || null;
        const tracks = (album?.tracks?.items || []).map((t) => mapSpotifyApiTrack(t, cover)).filter(Boolean);
        let next = album?.tracks?.next || null;
        let page = 1;
        while (next && page < maxPages) {
            const nextPage = await apiGet(next);
            page += 1;
            for (const t of nextPage?.items || []) {
                const mapped = mapSpotifyApiTrack(t, cover);
                if (mapped) tracks.push(mapped);
            }
            next = nextPage?.next || null;
        }
        return { type: "PLAYLIST", playlistName: album?.name || "Spotify Album", tracks };
    }

    if (entityType === "playlist") {
        const playlist = await apiGet(`/playlists/${entityId}?market=${encodeURIComponent(market)}`);
        const cover = playlist?.images?.[0]?.url || null;
        const container = playlist?.tracks || playlist?.items || {};
        const extractEntryTrack = (entry) => entry?.track || entry?.item || null;

        const tracks = (container.items || []).map((entry) => mapSpotifyApiTrack(extractEntryTrack(entry), cover)).filter(Boolean);

        let next = container.next || null;
        let page = 1;
        while (next && page < maxPages) {
            const nextPage = await apiGet(next);
            page += 1;
            for (const entry of nextPage?.items || []) {
                const mapped = mapSpotifyApiTrack(extractEntryTrack(entry), cover);
                if (mapped) tracks.push(mapped);
            }
            next = nextPage?.next || null;
        }
        return { type: "PLAYLIST", playlistName: playlist?.name || "Spotify Playlist", tracks };
    }

    if (entityType === "artist") {
        const [artist, top] = await Promise.all([
            apiGet(`/artists/${entityId}`),
            apiGet(`/artists/${entityId}/top-tracks?market=${encodeURIComponent(market)}`),
        ]);
        const cover = artist?.images?.[0]?.url || null;
        const tracks = (top?.tracks || []).map((t) => mapSpotifyApiTrack(t, cover)).filter(Boolean);
        return { type: "PLAYLIST", playlistName: artist?.name ? `${artist.name} - Top Tracks` : "Spotify Artist", tracks };
    }

    return null;
}

/**
 * Legal public Spotify Embed/oEmbed metadata fallback when SPOTIFY_CLIENT_ID/SECRET are not set.
 * Reads ONLY public track/playlist/album metadata (title, artist, duration, cover) — never audio.
 */
async function fetchSpotifyViaPublicMetadata(entityType, entityId) {
    const canonicalUrl = `https://open.spotify.com/${entityType}/${entityId}`;

    try {
        const embedRes = await fetchWithTimeout(`https://open.spotify.com/embed/${entityType}/${entityId}`);
        if (embedRes.ok) {
            const html = await embedRes.text();
            const nextDataMatch = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i.exec(html);
            if (nextDataMatch?.[1]) {
                const parsed = JSON.parse(nextDataMatch[1]);
                const entity = parsed?.props?.pageProps?.state?.data?.entity;
                if (entity) {
                    const cover = entity.visualIdentity?.image?.[0]?.url || entity.coverArt?.sources?.[0]?.url || null;

                    const trackTitle = entity.title || entity.name;
                    if (entityType === "track" && trackTitle) {
                        const artists = Array.isArray(entity.artists)
                            ? entity.artists
                                  .map((a) => a?.name)
                                  .filter(Boolean)
                                  .join(", ")
                            : entity.subtitle || "Unknown";

                        return {
                            type: "TRACK",
                            playlistName: undefined,
                            tracks: [
                                {
                                    identifier: entity.id || entityId,
                                    title: trackTitle,
                                    author: artists || "Unknown",
                                    duration: Number(entity.duration || 0),
                                    uri: canonicalUrl,
                                    artworkUrl: cover,
                                    isrc: null,
                                    originalSource: "spotify",
                                },
                            ],
                        };
                    }

                    if (Array.isArray(entity.trackList) && entity.trackList.length > 0) {
                        const tracks = entity.trackList
                            .map((item) => {
                                const trackIdMatch = /spotify:track:([A-Za-z0-9]+)/i.exec(String(item?.uri || ""));
                                const trackId = trackIdMatch?.[1] || item?.uid || entityId;
                                if (!item?.title) return null;
                                return {
                                    identifier: trackId,
                                    title: item.title,
                                    author: item.subtitle || "Unknown",
                                    duration: Number(item.duration || 0),
                                    uri: trackIdMatch ? `https://open.spotify.com/track/${trackId}` : canonicalUrl,
                                    artworkUrl: cover,
                                    isrc: null,
                                    originalSource: "spotify",
                                };
                            })
                            .filter(Boolean);

                        if (tracks.length > 0) {
                            return {
                                type: "PLAYLIST",
                                playlistName: entity.name || entity.title || `Spotify ${entityType}`,
                                tracks,
                            };
                        }
                    }
                }
            }
        }
    } catch (err) {
        Logger.debug(`[MusicSource] Public Spotify embed metadata lookup failed: ${err?.message || err}`);
    }

    // Fallback to Spotify's official public oEmbed endpoint for single tracks
    if (entityType === "track") {
        try {
            const oembedRes = await fetchWithTimeout(`https://open.spotify.com/oembed?url=${encodeURIComponent(canonicalUrl)}`);
            if (oembedRes.ok) {
                const oembed = await oembedRes.json();
                if (oembed?.title) {
                    return {
                        type: "TRACK",
                        playlistName: undefined,
                        tracks: [
                            {
                                identifier: entityId,
                                title: oembed.title,
                                author: oembed.author_name || "",
                                duration: 0,
                                uri: canonicalUrl,
                                artworkUrl: oembed.thumbnail_url || null,
                                isrc: null,
                                originalSource: "spotify",
                            },
                        ],
                    };
                }
            }
        } catch {
            // Ignore oEmbed failure
        }
    }

    return null;
}

async function resolveSpotifyQuery(client, detected, requester) {
    let { entityType, entityId, query } = detected;

    // Resolve spotify.link / spoti.fi short links safely
    if (detected.type === "spotify_short") {
        try {
            const shortRes = await fetchWithTimeout(query, { method: "HEAD", redirect: "follow" }, 5000);
            const resolvedUrl = shortRes.url || shortRes.headers.get("location") || "";
            const match = SPOTIFY_URI_REGEX.exec(resolvedUrl);
            if (!match) {
                return {
                    tracks: [],
                    type: RainlinkSearchResultType.SEARCH,
                    error: "Could not resolve short Spotify link.",
                };
            }
            entityType = match[1].toLowerCase();
            entityId = match[2];
            query = `https://open.spotify.com/${entityType}/${entityId}`;
        } catch {
            return {
                tracks: [],
                type: RainlinkSearchResultType.SEARCH,
                error: "Failed to resolve short Spotify link.",
            };
        }
    }

    const activeNode = getAnyConnectedNode(client);
    const driverId = activeNode?.driver?.id || "lavalink/v4/koinu";

    // 1. If connected Lavalink node explicitly supports Spotify (e.g. LavaSrc installed on node), try node first
    if (activeNode && nodeSupportsSource(activeNode, "spotify") === true) {
        const nodeResult = await client.rainlink.search(query, { requester }).catch(() => null);
        if (nodeResult?.tracks?.length) {
            for (const t of nodeResult.tracks) {
                t.pluginInfo = {
                    ...(t.pluginInfo || {}),
                    originalSource: "spotify",
                    originalUri: t.uri || query,
                    isMetadataOnly: true,
                };
            }
            return {
                ...nodeResult,
                sourcePlatform: "spotify",
                isMetadataMirrored: true,
            };
        }
    }

    // 2. Official Spotify Web API (when SPOTIFY_CLIENT_ID & SPOTIFY_CLIENT_SECRET are configured)
    let metadataResult = null;
    let apiError = null;
    try {
        metadataResult = await fetchSpotifyViaOfficialApi(entityType, entityId);
    } catch (err) {
        apiError = err;
        Logger.warn(`[MusicSource] Spotify Web API error (${entityType}/${entityId}): ${err?.message || err}`);
    }

    // 3. Public Spotify metadata fallback (zero-credential Termux mode)
    if (!metadataResult || !metadataResult.tracks?.length) {
        metadataResult = await fetchSpotifyViaPublicMetadata(entityType, entityId);
    }

    if (!metadataResult || !metadataResult.tracks?.length) {
        const hasCreds = Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
        const hint = !hasCreds
            ? "Spotify metadata could not be read publicly for this link. Configure `SPOTIFY_CLIENT_ID` & `SPOTIFY_CLIENT_SECRET` in `.env` (or `LavaSrc` on Lavalink) for full private/editorial playlist support."
            : apiError
              ? `Spotify API request failed (${apiError.message}). Please check your Spotify credentials or link visibility.`
              : "No playable tracks found on that Spotify link.";

        return {
            tracks: [],
            type: RainlinkSearchResultType.SEARCH,
            sourcePlatform: "spotify",
            error: hint,
        };
    }

    const tracks = metadataResult.tracks.map((meta) => createMetadataBackedTrack(meta, requester, driverId));
    return {
        playlistName: metadataResult.playlistName,
        tracks,
        type: metadataResult.type === "PLAYLIST" ? RainlinkSearchResultType.PLAYLIST : RainlinkSearchResultType.TRACK,
        sourcePlatform: "spotify",
        isMetadataMirrored: true,
    };
}

async function resolveDeezerQuery(client, detected, requester) {
    let { entityType, entityId, query } = detected;

    if (detected.type === "deezer_short") {
        try {
            const shortRes = await fetchWithTimeout(query, { method: "HEAD", redirect: "follow" }, 5000);
            const match = DEEZER_URL_REGEX.exec(shortRes.url || "");
            if (!match) {
                return { tracks: [], type: RainlinkSearchResultType.SEARCH, error: "Could not resolve Deezer short link." };
            }
            entityType = match[1].toLowerCase();
            entityId = match[2];
            query = `https://www.deezer.com/${entityType}/${entityId}`;
        } catch {
            return { tracks: [], type: RainlinkSearchResultType.SEARCH, error: "Failed to resolve Deezer short link." };
        }
    }

    const activeNode = getAnyConnectedNode(client);
    const driverId = activeNode?.driver?.id || "lavalink/v4/koinu";

    if (activeNode && nodeSupportsSource(activeNode, "deezer") === true) {
        const nodeResult = await client.rainlink.search(query, { requester }).catch(() => null);
        if (nodeResult?.tracks?.length) {
            return { ...nodeResult, sourcePlatform: "deezer" };
        }
    }

    try {
        const res = await fetchWithTimeout(`https://api.deezer.com/${entityType}/${entityId}`);
        if (!res.ok) throw new Error(`Deezer API HTTP ${res.status}`);
        const data = await res.json();
        if (data?.error) throw new Error(data.error.message || "Deezer resource unavailable");

        const mapDzTrack = (t, fallbackCover = null) => {
            if (!t?.id || !t?.title) return null;
            return createMetadataBackedTrack(
                {
                    identifier: String(t.id),
                    title: t.title,
                    author: t.artist?.name || "Unknown",
                    duration: Number(t.duration || 0) * 1000,
                    uri: t.link || `https://www.deezer.com/track/${t.id}`,
                    artworkUrl: t.album?.cover_big || t.album?.cover_medium || fallbackCover || null,
                    isrc: t.isrc || null,
                    originalSource: "deezer",
                },
                requester,
                driverId,
            );
        };

        if (entityType === "track") {
            const track = mapDzTrack(data);
            return {
                tracks: track ? [track] : [],
                type: RainlinkSearchResultType.TRACK,
                sourcePlatform: "deezer",
                isMetadataMirrored: true,
            };
        }

        const cover = data.cover_big || data.picture_big || data.cover_medium || data.picture_medium || null;
        const tracks = (data.tracks?.data || []).map((t) => mapDzTrack(t, cover)).filter(Boolean);
        return {
            playlistName: data.title || "Deezer Playlist",
            tracks,
            type: RainlinkSearchResultType.PLAYLIST,
            sourcePlatform: "deezer",
            isMetadataMirrored: true,
        };
    } catch (err) {
        Logger.debug(`[MusicSource] Deezer metadata resolution failed: ${err?.message || err}`);
        return {
            tracks: [],
            type: RainlinkSearchResultType.SEARCH,
            sourcePlatform: "deezer",
            error: "Could not load tracks from that Deezer link.",
        };
    }
}

/**
 * Primary Smart Music Search & URL Resolver with bounded multi-source fallback.
 */
async function smartSearch(client, rawInput, options = {}) {
    const requester = options.requester;
    const preferredEngine = options.preferredEngine || null;

    const detected = detectMusicQuery(rawInput);
    if (!detected.valid) {
        return {
            tracks: [],
            type: RainlinkSearchResultType.SEARCH,
            detectedType: detected.type,
            error: detected.error,
        };
    }

    const activeNode = getAnyConnectedNode(client);
    if (!activeNode) {
        return {
            tracks: [],
            type: RainlinkSearchResultType.SEARCH,
            detectedType: detected.type,
            error: "Music node (Lavalink) is currently offline or reconnecting. Please try again in a moment.",
        };
    }

    // 1. Spotify Track / Album / Playlist / Artist
    if (detected.type === "spotify" || detected.type === "spotify_short") {
        const spRes = await resolveSpotifyQuery(client, detected, requester);
        return { ...spRes, detectedType: "spotify" };
    }

    // 2. Deezer Track / Album / Playlist
    if (detected.type === "deezer" || detected.type === "deezer_short") {
        const dzRes = await resolveDeezerQuery(client, detected, requester);
        return { ...dzRes, detectedType: "deezer" };
    }

    // 3. Candidate direct audio stream URL (validated against SSRF & audio MIME/extension)
    if (detected.type === "candidate_url") {
        // Allow LavaSrc-enabled nodes to resolve Apple Music / Tidal URLs if explicitly supported by node
        if (/music\.apple\.com/i.test(detected.query) && nodeSupportsSource(activeNode, "applemusic") === true) {
            const appleRes = await client.rainlink.search(detected.query, { requester }).catch(() => null);
            if (appleRes?.tracks?.length) {
                return { ...appleRes, detectedType: "applemusic", sourcePlatform: "applemusic" };
            }
        }

        const check = await validateDirectAudioUrl(detected.query);
        if (!check.valid) {
            return {
                tracks: [],
                type: RainlinkSearchResultType.SEARCH,
                detectedType: "unsupported_url",
                error: check.reason,
            };
        }

        if (nodeSupportsSource(activeNode, "http") === false) {
            return {
                tracks: [],
                type: RainlinkSearchResultType.SEARCH,
                detectedType: "direct_audio",
                error: "Direct HTTP audio streaming is disabled on the connected Lavalink server.",
            };
        }

        const directRes = await client.rainlink.search(check.url, { requester }).catch(() => null);
        if (!directRes?.tracks?.length) {
            return {
                tracks: [],
                type: RainlinkSearchResultType.SEARCH,
                detectedType: "direct_audio",
                error: "Could not load audio stream from that URL.",
            };
        }
        return { ...directRes, detectedType: "direct_audio", sourcePlatform: "http" };
    }

    // 4. YouTube, YouTube Music, SoundCloud, Bandcamp URLs
    if (detected.isUrl) {
        if (detected.type === "bandcamp" && nodeSupportsSource(activeNode, "bandcamp") === false) {
            return {
                tracks: [],
                type: RainlinkSearchResultType.SEARCH,
                detectedType: "bandcamp",
                error: "Bandcamp source is disabled on the connected Lavalink server.",
            };
        }

        if (detected.type === "soundcloud" && nodeSupportsSource(activeNode, "soundcloud") === false) {
            return {
                tracks: [],
                type: RainlinkSearchResultType.SEARCH,
                detectedType: "soundcloud",
                error: "SoundCloud source is disabled on the connected Lavalink server.",
            };
        }

        const directUrlRes = await client.rainlink.search(detected.query, { requester }).catch(() => null);
        if (directUrlRes?.tracks?.length) {
            return { ...directUrlRes, detectedType: detected.type, sourcePlatform: detected.type };
        }

        // Bounded fallback for YouTube / YT Music single-video links via YouTube oEmbed -> SoundCloud/YTM search
        if (detected.type === "youtube" || detected.type === "youtube_music") {
            try {
                const oembed = await fetchWithTimeout(
                    `https://www.youtube.com/oembed?url=${encodeURIComponent(detected.query)}&format=json`,
                    {},
                    4000,
                );
                if (oembed.ok) {
                    const meta = await oembed.json();
                    if (meta?.title) {
                        const fallbackQuery = [meta.author_name?.replace(/ - Topic$/i, ""), meta.title].filter(Boolean).join(" - ");
                        for (const engine of ["youtubeMusic", "soundcloud"]) {
                            const fbRes = await client.rainlink.search(fallbackQuery, { requester, engine }).catch(() => null);
                            if (fbRes?.tracks?.length) {
                                return {
                                    playlistName: undefined,
                                    tracks: [fbRes.tracks[0]],
                                    type: RainlinkSearchResultType.TRACK,
                                    detectedType: detected.type,
                                    sourcePlatform: engine,
                                };
                            }
                        }
                    }
                }
            } catch {
                // Ignore YouTube oEmbed fallback failure
            }
        }

        return {
            tracks: [],
            type: RainlinkSearchResultType.SEARCH,
            detectedType: detected.type,
            error: "No playable tracks could be loaded from that link.",
        };
    }

    // 5. Plain-text search with bounded fallback chain (max 3 attempts, zero infinite loops)
    const configuredPrimary = client.config?.rainlinkOptions?.defaultSearchEngine || "youtubeMusic";
    const configuredFallback = client.config?.rainlinkOptions?.searchFallback?.engine || "youtube";

    const engineOrder = [];
    const pushUnique = (eng) => {
        if (eng && !engineOrder.includes(eng)) engineOrder.push(eng);
    };

    if (preferredEngine && preferredEngine !== "auto") {
        pushUnique(preferredEngine);
    }
    pushUnique(configuredPrimary);
    pushUnique(configuredFallback);
    pushUnique("soundcloud");

    for (const engine of engineOrder.slice(0, 3)) {
        if (engine === "soundcloud" && nodeSupportsSource(activeNode, "soundcloud") === false) {
            continue;
        }

        const result = await client.rainlink.search(detected.query, { requester, engine }).catch((err) => {
            Logger.debug(`[MusicSource] Search engine '${engine}' failed for '${detected.query}': ${err?.message || err}`);
            return null;
        });

        if (result?.tracks?.length) {
            return {
                ...result,
                detectedType: "text",
                sourcePlatform: engine,
            };
        }
    }

    return {
        tracks: [],
        type: RainlinkSearchResultType.SEARCH,
        detectedType: "text",
        error: `No matching songs found for \`${detected.query}\`.`,
    };
}

/**
 * Safely enqueues tracks (including large playlists) in bounded chunks so the event loop
 * and Lavalink player never freeze or crash.
 */
function enqueueTracksStaged(client, player, tracks, options = {}) {
    const maxTracks = Math.min(Math.max(Number.parseInt(process.env.MAX_PLAYLIST_TRACKS || "500", 10) || 500, 20), 1000);
    const chunkSize = Math.min(Math.max(Number(options.chunkSize || 50), 10), 100);

    const boundedTracks = Array.isArray(tracks) ? tracks.slice(0, maxTracks) : [];
    const truncatedCount = Math.max(0, (tracks?.length || 0) - boundedTracks.length);

    if (!boundedTracks.length) {
        return { addedImmediate: 0, totalScheduled: 0, truncatedCount: 0 };
    }

    const firstChunk = boundedTracks.slice(0, chunkSize);
    for (const track of firstChunk) {
        player.queue.add(track);
    }

    const remaining = boundedTracks.slice(chunkSize);
    if (remaining.length > 0) {
        let offset = 0;
        const guildId = String(player.guildId);

        const pumpNextBatch = () => {
            if (
                offset >= remaining.length ||
                !player ||
                player.state === PLAYER_STATE_DESTROYED ||
                player.sudoDestroy ||
                isGuildManuallyDisconnected(client, guildId) ||
                isGuildLeavingInProgress(guildId)
            ) {
                return;
            }

            const slice = remaining.slice(offset, offset + chunkSize);
            offset += chunkSize;

            try {
                for (const track of slice) {
                    player.queue.add(track);
                }
            } catch (err) {
                Logger.debug(`[MusicSource] Staged playlist batch stopped (${guildId}): ${err?.message || err}`);
                return;
            }

            if (offset < remaining.length) {
                const timer = setTimeout(pumpNextBatch, 200);
                if (typeof timer.unref === "function") timer.unref();
            }
        };

        const initialTimer = setTimeout(pumpNextBatch, 200);
        if (typeof initialTimer.unref === "function") initialTimer.unref();
    }

    return {
        addedImmediate: firstChunk.length,
        totalScheduled: boundedTracks.length,
        truncatedCount,
    };
}

/**
 * Rehydrates a stored track object (from MongoDB playlist, favorite, or history) into a RainlinkTrack.
 */
function hydrateStoredTrack(client, stored, requester) {
    const activeNode = getAnyConnectedNode(client);
    const driverId = activeNode?.driver?.id || "lavalink/v4/koinu";
    const origSource = stored.originalSource || stored.source || "youtubeMusic";

    if (origSource === "spotify" || origSource === "deezer" || !stored.uri) {
        return createMetadataBackedTrack(
            {
                identifier: stored.identifier || stored.uri || stored.title,
                title: stored.title || "Unknown",
                author: stored.author || "Unknown",
                duration: Number(stored.duration || 0),
                uri: stored.uri || "",
                artworkUrl: stored.artworkUrl || null,
                isrc: stored.isrc || null,
                originalSource: origSource === "deezer" ? "deezer" : "spotify",
            },
            requester,
            driverId,
        );
    }

    return createMetadataBackedTrack(
        {
            identifier: stored.identifier || stored.uri,
            title: stored.title || "Unknown",
            author: stored.author || "Unknown",
            duration: Number(stored.duration || 0),
            uri: stored.uri,
            artworkUrl: stored.artworkUrl || null,
            isrc: stored.isrc || null,
            originalSource: stored.source || "youtubeMusic",
        },
        requester,
        driverId,
    );
}

/**
 * Serializes a live RainlinkTrack into a compact MongoDB-safe plain object.
 */
function serializeTrack(track, extra = {}) {
    return {
        title: String(track?.title || "Unknown").slice(0, 200),
        author: String(track?.author || "Unknown").slice(0, 150),
        uri: String(track?.pluginInfo?.originalUri || track?.uri || "").slice(0, 500),
        identifier: String(track?.identifier || "").slice(0, 150),
        duration: Number(track?.duration || 0),
        isStream: Boolean(track?.isStream),
        artworkUrl: track?.artworkUrl ? String(track.artworkUrl).slice(0, 500) : null,
        source: String(track?.source || "music").slice(0, 40),
        originalSource: track?.pluginInfo?.originalSource ? String(track.pluginInfo.originalSource).slice(0, 40) : null,
        ...extra,
    };
}

module.exports = {
    MAX_QUERY_LENGTH,
    sanitizeMusicQuery,
    checkSearchRateLimit,
    isBlockedHost,
    validateDirectAudioUrl,
    detectMusicQuery,
    scoreReplacementCandidate,
    createMetadataBackedTrack,
    formatTrackSourceLabel,
    smartSearch,
    enqueueTracksStaged,
    hydrateStoredTrack,
    serializeTrack,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
