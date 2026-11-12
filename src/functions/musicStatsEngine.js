const mongoose = require("mongoose");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, StringSelectMenuBuilder } = require("discord.js");
const { convertTime } = require("./timeFormat.js");
const { getUserFavorites, listSavedPlaylists } = require("./musicPermissions.js");
const { getPremiumAccess } = require("./premiumSystem.js");
const { safeReply, safeEditReply, safeDeferUpdate } = require("./interactionResponder.js");
const { isCloudDatabaseReady } = require("../databases/cloudAdapter.js");

function isStatsDatabaseReady(model) {
    if (isCloudDatabaseReady()) return true;
    if (mongoose.connection.readyState === 1) return true;
    if (model && !model.db) return true; // Custom non-Mongoose adapter/mock
    return false;
}

const DAY_NAMES_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

const LEVEL_TIERS = [
    { level: 1, minXp: 0, title: "New Listener", badge: "🌱" },
    { level: 2, minXp: 150, title: "Casual Listener", badge: "🎧" },
    { level: 3, minXp: 500, title: "Music Lover", badge: "🎵" },
    { level: 4, minXp: 1500, title: "Music Addict", badge: "🔥" },
    { level: 5, minXp: 4000, title: "Music Legend", badge: "👑" },
    { level: 6, minXp: 10000, title: "Lagukan Legend", badge: "💎" },
];

// Active per-guild playback tracking sessions: Map<guildId, SessionObject>
const activePlaybackSessions = new Map();

function computeLevelInfo(rawXp = 0) {
    const xp = Math.max(0, Math.floor(Number(rawXp || 0)));
    let matched = LEVEL_TIERS[0];
    let nextMinXp = LEVEL_TIERS[1].minXp;

    for (let i = 0; i < LEVEL_TIERS.length; i++) {
        if (xp >= LEVEL_TIERS[i].minXp) {
            matched = LEVEL_TIERS[i];
            nextMinXp = LEVEL_TIERS[i + 1]?.minXp || null;
        }
    }

    let level = matched.level;
    let floorXp = matched.minXp;
    if (matched.level >= 6 && xp >= 10000) {
        const extraLevels = Math.floor((xp - 10000) / 5000);
        level = 6 + extraLevels;
        floorXp = 10000 + extraLevels * 5000;
        nextMinXp = floorXp + 5000;
    }

    const span = Math.max(1, (nextMinXp || floorXp + 1000) - floorXp);
    const gainedInLevel = Math.max(0, xp - floorXp);
    const pct = Math.min(100, Math.round((gainedInLevel / span) * 100));
    const filled = Math.round((pct / 100) * 12);
    const bar = `${"▰".repeat(filled)}${"▱".repeat(Math.max(0, 12 - filled))}`;

    return {
        level,
        title: matched.title,
        badge: matched.badge,
        xp,
        floorXp,
        nextLevelXp: nextMinXp || floorXp + 5000,
        progressPct: pct,
        progressBar: bar,
    };
}

function formatListeningDurationHuman(ms = 0) {
    const totalSec = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    if (totalSec === 0) return "0m";
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hours > 0) return `${hours}j ${mins}m`;
    if (mins > 0) return `${mins}m ${secs}d`;
    return `${secs}d`;
}

function normalizeTrackKey(track) {
    if (!track) return "unknown";
    if (track.identifier) return `id:${String(track.identifier).toLowerCase()}`;
    const cleanTitle = String(track.title || "unknown")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
    const cleanAuthor = String(track.author || "unknown")
        .replace(/ - Topic$/i, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
    return `meta:${cleanTitle}::${cleanAuthor}`;
}

function inferTrackGenre(track) {
    const explicit = track?.pluginInfo?.genre || track?.genre || null;
    if (explicit && typeof explicit === "string" && explicit.trim()) {
        return explicit.trim();
    }
    return null;
}

function extractTrackAlbum(track) {
    const explicit = track?.pluginInfo?.albumName || track?.album || null;
    if (explicit && typeof explicit === "string" && explicit.trim()) {
        return explicit.trim();
    }
    return null;
}

function getIsoWeekKey(date = new Date()) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function getMonthKey(date = new Date()) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function collectHumanVoiceListenerIds(client, guildId, voiceId, requesterId = null) {
    const ids = new Set();
    if (requesterId && String(requesterId) !== String(client?.user?.id || "")) {
        ids.add(String(requesterId));
    }

    const guild = client?.guilds?.cache?.get?.(String(guildId || ""));
    const channel = guild?.members?.me?.voice?.channel || (voiceId ? guild?.channels?.cache?.get?.(String(voiceId)) : null);

    if (channel?.members && typeof channel.members.values === "function") {
        for (const m of channel.members.values()) {
            if (!m || m.user?.bot) continue;
            if (m.voice?.selfDeaf || m.voice?.serverDeaf) continue;
            ids.add(String(m.id || m.user?.id));
        }
    }
    return ids;
}

function upsertCounterArray(list = [], entry, maxEntries = 35) {
    const arr = Array.isArray(list) ? [...list.map((x) => ({ ...x }))] : [];
    const idx = arr.findIndex((item) => item.key === entry.key);
    if (idx >= 0) {
        arr[idx].plays = Number(arr[idx].plays || 0) + Number(entry.plays || 0);
        arr[idx].listenedMs = Number(arr[idx].listenedMs || 0) + Number(entry.listenedMs || 0);
        if (entry.label) arr[idx].label = entry.label;
        if (entry.subLabel) arr[idx].subLabel = entry.subLabel;
        if (entry.uri) arr[idx].uri = entry.uri;
    } else {
        arr.push({
            key: entry.key,
            label: entry.label || entry.key,
            subLabel: entry.subLabel || null,
            uri: entry.uri || null,
            plays: Number(entry.plays || 0),
            listenedMs: Number(entry.listenedMs || 0),
        });
    }
    arr.sort((a, b) => b.plays - a.plays || b.listenedMs - a.listenedMs);
    return arr.slice(0, maxEntries);
}

async function ensureUserProfileDoc(client, userId) {
    if (!userId || !client?.userMusicProfileData || !isStatsDatabaseReady(client.userMusicProfileData)) return null;
    const uid = String(userId);
    const existing = await client.userMusicProfileData.findOne({ userId: uid }).catch(() => null);
    if (existing) return typeof existing.toObject === "function" ? existing.toObject() : existing;

    const created = await client.userMusicProfileData
        .findOneAndUpdate(
            { userId: uid },
            {
                $setOnInsert: {
                    userId: uid,
                    totalTracksRequested: 0,
                    totalTracksStarted: 0,
                    totalTracksCompleted: 0,
                    totalListeningMs: 0,
                    xp: 0,
                    level: 1,
                    levelTitle: "New Listener",
                    recentXpAwards: [],
                },
            },
            { upsert: true, returnDocument: "after" },
        )
        .catch(() => null);

    return created ? (typeof created.toObject === "function" ? created.toObject() : created) : null;
}

async function ensureGuildUserStatsDoc(client, guildId, userId) {
    if (!guildId || !userId || !client?.musicStatisticsData || !isStatsDatabaseReady(client.musicStatisticsData)) return null;
    const gid = String(guildId);
    const uid = String(userId);
    const existing = await client.musicStatisticsData.findOne({ guildId: gid, userId: uid }).catch(() => null);
    if (existing) return typeof existing.toObject === "function" ? existing.toObject() : existing;

    const created = await client.musicStatisticsData
        .findOneAndUpdate(
            { guildId: gid, userId: uid },
            {
                $setOnInsert: {
                    guildId: gid,
                    userId: uid,
                    tracksRequested: 0,
                    tracksStarted: 0,
                    tracksCompleted: 0,
                    totalListeningMs: 0,
                    xp: 0,
                    topTracks: [],
                    topArtists: [],
                    topGenres: [],
                },
            },
            { upsert: true, returnDocument: "after" },
        )
        .catch(() => null);

    return created ? (typeof created.toObject === "function" ? created.toObject() : created) : null;
}

/**
 * Records that a user requested track(s) (e.g. via /play, /search, or Request Panel).
 * Never awards XP or completed counts — strictly tracks genuine requests.
 */
async function recordTrackRequest(client, { guildId, userId, count = 1 }) {
    if (!userId || String(userId) === String(client?.user?.id || "")) return;
    const inc = Math.max(1, Math.min(Number(count || 1), 50));
    const uid = String(userId);
    const gid = guildId ? String(guildId) : null;

    const profile = await ensureUserProfileDoc(client, uid);
    if (profile && client?.userMusicProfileData) {
        await client.userMusicProfileData
            .findOneAndUpdate(
                { userId: uid },
                {
                    $set: {
                        totalTracksRequested: Number(profile.totalTracksRequested || 0) + inc,
                        lastActiveAt: new Date(),
                    },
                },
                { upsert: true, returnDocument: "after" },
            )
            .catch(() => {});
    }

    if (gid && client?.musicStatisticsData) {
        const gStats = await ensureGuildUserStatsDoc(client, gid, uid);
        if (gStats) {
            await client.musicStatisticsData
                .findOneAndUpdate(
                    { guildId: gid, userId: uid },
                    { $set: { tracksRequested: Number(gStats.tracksRequested || 0) + inc } },
                    { upsert: true, returnDocument: "after" },
                )
                .catch(() => {});
        }
    }
}

/**
 * Starts a real playback telemetry session when Lavalink begins playing a track.
 */
async function onTrackSessionStart(client, player, track) {
    if (!player?.guildId || !track) return;
    if (player.data?.get?.("guessTheSongActive")) return;

    const gid = String(player.guildId);
    if (activePlaybackSessions.has(gid)) {
        await onTrackSessionEnd(client, player, "replaced").catch(() => {});
    }

    const now = Date.now();
    const requesterId =
        track.requester?.id && String(track.requester.id) !== String(client?.user?.id || "") ? String(track.requester.id) : null;
    const participants = collectHumanVoiceListenerIds(client, gid, player.voiceId, requesterId);
    const trackKey = normalizeTrackKey(track);
    const sessionKey = `${gid}:${trackKey}:${now}`;

    const cleanAuthor =
        String(track.author || "Unknown")
            .replace(/ - Topic$/i, "")
            .trim() || "Unknown";

    const session = {
        sessionKey,
        guildId: gid,
        voiceId: player.voiceId,
        trackKey,
        title: String(track.title || "Unknown"),
        author: cleanAuthor,
        album: extractTrackAlbum(track),
        genre: inferTrackGenre(track),
        uri: track.pluginInfo?.originalUri || track.uri || "",
        identifier: String(track.identifier || ""),
        artworkUrl: track.artworkUrl || null,
        source: String(track.pluginInfo?.originalSource || track.source || "music"),
        duration: Number(track.duration || 0),
        requesterId,
        participants,
        startedAt: now,
        lastTickAt: now,
        lastPosition: Number(player.position || 0),
        realListenedMs: 0,
        settled: false,
    };

    activePlaybackSessions.set(gid, session);

    // Increment tracksStarted once per listener in this session
    for (const uid of participants) {
        const profile = await ensureUserProfileDoc(client, uid);
        if (profile && client?.userMusicProfileData) {
            await client.userMusicProfileData
                .findOneAndUpdate(
                    { userId: uid },
                    {
                        $set: {
                            totalTracksStarted: Number(profile.totalTracksStarted || 0) + 1,
                            lastActiveAt: new Date(now),
                        },
                    },
                    { upsert: true, returnDocument: "after" },
                )
                .catch(() => {});
        }
        const gStats = await ensureGuildUserStatsDoc(client, gid, uid);
        if (gStats && client?.musicStatisticsData) {
            await client.musicStatisticsData
                .findOneAndUpdate(
                    { guildId: gid, userId: uid },
                    { $set: { tracksStarted: Number(gStats.tracksStarted || 0) + 1 } },
                    { upsert: true, returnDocument: "after" },
                )
                .catch(() => {});
        }
    }
}

/**
 * Accumulates genuine non-paused playback duration on playerUpdate ticks (immune to /seek exploits).
 */
function onTrackSessionTick(client, player) {
    if (!player?.guildId) return;
    const gid = String(player.guildId);
    const session = activePlaybackSessions.get(gid);
    if (!session || session.settled) return;

    const now = Date.now();
    const pos = Math.max(0, Number(player.position || 0));
    const wallDelta = Math.max(0, now - session.lastTickAt);
    const posDelta = pos - session.lastPosition;

    if (!player.paused && player.playing && posDelta > 0) {
        const maxAllowed = Math.max(1500, Math.floor(wallDelta * 1.4));
        session.realListenedMs += Math.min(posDelta, maxAllowed);
    }

    session.lastTickAt = now;
    session.lastPosition = pos;

    const currentHumans = collectHumanVoiceListenerIds(client, gid, player.voiceId, null);
    for (const uid of currentHumans) {
        session.participants.add(uid);
    }
}

/**
 * Records a failed track attempt without counting it as listened/completed or awarding XP.
 */
async function onTrackSessionFailed(client, player, track) {
    if (!player?.guildId) return;
    const gid = String(player.guildId);
    const active = activePlaybackSessions.get(gid);

    if (active && !active.settled) {
        active.settled = true;
        activePlaybackSessions.delete(gid);
    }

    const uid = track?.requester?.id && String(track.requester.id) !== String(client?.user?.id || "") ? String(track.requester.id) : null;

    if (!uid || !client?.listeningHistoryData) return;

    const now = new Date();
    const tKey = normalizeTrackKey(track);
    const eventKey = `failed:${gid}:${uid}:${tKey}:${now.getTime()}`;

    await client.listeningHistoryData
        .findOneAndUpdate(
            { eventKey },
            {
                $set: {
                    eventKey,
                    userId: uid,
                    guildId: gid,
                    requesterId: uid,
                    trackKey: tKey,
                    title: String(track?.title || "Unknown"),
                    author: String(track?.author || "Unknown"),
                    album: extractTrackAlbum(track),
                    genre: inferTrackGenre(track),
                    uri: track?.uri || "",
                    identifier: String(track?.identifier || ""),
                    artworkUrl: track?.artworkUrl || null,
                    source: String(track?.source || "music"),
                    duration: Number(track?.duration || 0),
                    listenedMs: 0,
                    xpAwarded: 0,
                    status: "failed",
                    dayOfWeek: now.getDay(),
                    hourOfDay: now.getHours(),
                    startedAt: now,
                    endedAt: now,
                },
            },
            { upsert: true, returnDocument: "after" },
        )
        .catch(() => {});
}

/**
 * Settles an active playback session when a track finishes, skips, or stops.
 */
async function onTrackSessionEnd(client, player, reason = "finished") {
    if (!player?.guildId) return;
    const gid = String(player.guildId);
    const session = activePlaybackSessions.get(gid);
    if (!session || session.settled) return;

    session.settled = true;
    activePlaybackSessions.delete(gid);

    const now = Date.now();
    const wallElapsed = Math.max(0, now - session.startedAt);
    const tailWall = Math.max(0, now - session.lastTickAt);
    const pos = Math.max(0, Number(player.position || 0));
    const tailPos = Math.max(0, pos - session.lastPosition);

    if (!player.paused && tailPos > 0) {
        session.realListenedMs += Math.min(tailPos, Math.max(1500, Math.floor(tailWall * 1.4)));
    } else if (session.realListenedMs === 0 && reason === "finished" && wallElapsed > 0) {
        session.realListenedMs = Math.min(wallElapsed, session.duration || wallElapsed);
    }

    if (session.duration > 0) {
        session.realListenedMs = Math.min(session.realListenedMs, session.duration);
    }

    const listenedMs = Math.max(0, Math.round(session.realListenedMs));
    const minValidListenMs = session.duration > 0 ? Math.min(20000, Math.max(5000, Math.floor(session.duration * 0.5))) : 20000;
    const isCompleted =
        listenedMs >= minValidListenMs &&
        (reason === "finished" || listenedMs >= 30000 || (session.duration > 0 && listenedMs >= session.duration * 0.5));

    const status = reason === "failed" ? "failed" : isCompleted ? "completed" : "stopped";
    const startDate = new Date(session.startedAt);
    const endDate = new Date(now);
    const weekKey = getIsoWeekKey(startDate);
    const monthKey = getMonthKey(startDate);

    for (const uid of session.participants) {
        const eventKey = `${session.sessionKey}:${uid}`;

        // Guard against duplicate recording of the exact same eventKey
        const alreadyRecorded = await client.listeningHistoryData?.findOne?.({ eventKey }).catch(() => null);
        if (alreadyRecorded) continue;

        const profile = await ensureUserProfileDoc(client, uid);
        let xpAwarded = 0;

        if (status !== "failed" && (listenedMs >= 5000 || isCompleted)) {
            const recentWindowCutoff = now - 30 * 60 * 1000;
            const recentAwards = (Array.isArray(profile?.recentXpAwards) ? profile.recentXpAwards : []).filter(
                (r) => new Date(r.awardedAt).getTime() > recentWindowCutoff,
            );
            const sameTrackRecentCount = recentAwards.filter((r) => r.trackKey === session.trackKey).length;

            // Anti-farming: 1st play = 100% XP, 2nd repeat within 30m = 50% XP, 3rd+ repeat = 0 XP
            if (sameTrackRecentCount < 2) {
                const durationXp = Math.floor(listenedMs / 6000); // 10 XP per full minute
                const rawXp = isCompleted ? Math.max(6, durationXp) : durationXp;
                const scaledXp = sameTrackRecentCount === 0 ? rawXp : Math.floor(rawXp * 0.5);
                xpAwarded = Math.min(120, Math.max(0, scaledXp));
                if (xpAwarded > 0) {
                    recentAwards.push({ trackKey: session.trackKey, awardedAt: endDate });
                }
            }

            if (profile && client?.userMusicProfileData) {
                const nextXp = Number(profile.xp || 0) + xpAwarded;
                const levelMeta = computeLevelInfo(nextXp);
                await client.userMusicProfileData
                    .findOneAndUpdate(
                        { userId: uid },
                        {
                            $set: {
                                totalTracksCompleted: Number(profile.totalTracksCompleted || 0) + (isCompleted ? 1 : 0),
                                totalListeningMs: Number(profile.totalListeningMs || 0) + listenedMs,
                                xp: nextXp,
                                level: levelMeta.level,
                                levelTitle: levelMeta.title,
                                lastTrack: {
                                    title: session.title,
                                    author: session.author,
                                    album: session.album,
                                    genre: session.genre,
                                    uri: session.uri,
                                    artworkUrl: session.artworkUrl,
                                    source: session.source,
                                    guildId: gid,
                                    playedAt: endDate,
                                },
                                lastActiveAt: endDate,
                                recentXpAwards: recentAwards.slice(-25),
                            },
                        },
                        { upsert: true, returnDocument: "after" },
                    )
                    .catch(() => {});
            }

            const gStats = await ensureGuildUserStatsDoc(client, gid, uid);
            if (gStats && client?.musicStatisticsData) {
                const topTracks = isCompleted
                    ? upsertCounterArray(gStats.topTracks, {
                          key: session.trackKey,
                          label: session.title,
                          subLabel: session.author,
                          uri: session.uri,
                          plays: 1,
                          listenedMs,
                      })
                    : gStats.topTracks;

                const topArtists =
                    isCompleted && session.author
                        ? upsertCounterArray(gStats.topArtists, {
                              key: session.author.toLowerCase(),
                              label: session.author,
                              plays: 1,
                              listenedMs,
                          })
                        : gStats.topArtists;

                const topGenres =
                    isCompleted && session.genre
                        ? upsertCounterArray(gStats.topGenres, {
                              key: session.genre.toLowerCase(),
                              label: session.genre,
                              plays: 1,
                              listenedMs,
                          })
                        : gStats.topGenres;

                await client.musicStatisticsData
                    .findOneAndUpdate(
                        { guildId: gid, userId: uid },
                        {
                            $set: {
                                tracksCompleted: Number(gStats.tracksCompleted || 0) + (isCompleted ? 1 : 0),
                                totalListeningMs: Number(gStats.totalListeningMs || 0) + listenedMs,
                                xp: Number(gStats.xp || 0) + xpAwarded,
                                topTracks,
                                topArtists,
                                topGenres,
                                lastPlayedAt: endDate,
                            },
                        },
                        { upsert: true, returnDocument: "after" },
                    )
                    .catch(() => {});
            }

            if (client?.musicLeaderboardData) {
                for (const [periodType, periodKey] of [
                    ["weekly", weekKey],
                    ["monthly", monthKey],
                ]) {
                    const existingLb = await client.musicLeaderboardData
                        .findOne({ guildId: gid, periodType, periodKey, userId: uid })
                        .catch(() => null);
                    const plainLb = existingLb ? (typeof existingLb.toObject === "function" ? existingLb.toObject() : existingLb) : null;

                    await client.musicLeaderboardData
                        .findOneAndUpdate(
                            { guildId: gid, periodType, periodKey, userId: uid },
                            {
                                $set: {
                                    tracksCompleted: Number(plainLb?.tracksCompleted || 0) + (isCompleted ? 1 : 0),
                                    totalListeningMs: Number(plainLb?.totalListeningMs || 0) + listenedMs,
                                    xp: Number(plainLb?.xp || 0) + xpAwarded,
                                },
                            },
                            { upsert: true, returnDocument: "after" },
                        )
                        .catch(() => {});
                }
            }
        }

        await client.listeningHistoryData
            ?.findOneAndUpdate(
                { eventKey },
                {
                    $set: {
                        eventKey,
                        userId: uid,
                        guildId: gid,
                        requesterId: session.requesterId,
                        trackKey: session.trackKey,
                        title: session.title,
                        author: session.author,
                        album: session.album,
                        genre: session.genre,
                        uri: session.uri,
                        identifier: session.identifier,
                        artworkUrl: session.artworkUrl,
                        source: session.source,
                        duration: session.duration,
                        listenedMs,
                        xpAwarded,
                        status,
                        dayOfWeek: startDate.getDay(),
                        hourOfDay: startDate.getHours(),
                        startedAt: startDate,
                        endedAt: endDate,
                    },
                },
                { upsert: true, returnDocument: "after" },
            )
            .catch(() => {});
    }
}

async function computeUserProfileSnapshot(client, { targetUser, targetMember = null, guild = null }) {
    const uid = String(targetUser.id);
    const gid = guild?.id ? String(guild.id) : null;

    const [profileDoc, guildStatsDoc, allGuildStatsRaw, favorites, personalPlaylists, premium, userHistoryRaw] = await Promise.all([
        ensureUserProfileDoc(client, uid),
        gid ? ensureGuildUserStatsDoc(client, gid, uid) : Promise.resolve(null),
        gid && client?.musicStatisticsData ? client.musicStatisticsData.find({ guildId: gid }).catch(() => []) : Promise.resolve([]),
        getUserFavorites(client, targetUser).catch(() => []),
        listSavedPlaylists(client, { scope: "personal", userId: uid, guildId: gid }).catch(() => []),
        getPremiumAccess(client, { userId: uid, guildId: gid }),
        client?.listeningHistoryData ? client.listeningHistoryData.find({ userId: uid }).catch(() => []) : Promise.resolve([]),
    ]);

    const allGuildStats = (Array.isArray(allGuildStatsRaw) ? allGuildStatsRaw : [])
        .map((d) => (typeof d.toObject === "function" ? d.toObject() : d))
        .filter((d) => Number(d.totalListeningMs || 0) > 0 || Number(d.tracksCompleted || 0) > 0)
        .sort((a, b) => b.xp - a.xp || b.totalListeningMs - a.totalListeningMs || b.tracksCompleted - a.tracksCompleted);

    const rankIdx = allGuildStats.findIndex((d) => String(d.userId) === uid);
    const serverRank = rankIdx >= 0 ? `#${rankIdx + 1} dari ${allGuildStats.length}` : "Belum masuk ranking";

    // Aggregate global top track, artist, genre across user's completed history (with guildStats fallback)
    const userHistory = (Array.isArray(userHistoryRaw) ? userHistoryRaw : [])
        .map((d) => (typeof d.toObject === "function" ? d.toObject() : d))
        .sort((a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime());

    const completedRows = userHistory.filter((r) => r.status === "completed");
    let topTrackLabel = guildStatsDoc?.topTracks?.[0] ? `${guildStatsDoc.topTracks[0].label} (${guildStatsDoc.topTracks[0].plays}x)` : null;
    let topArtistLabel = guildStatsDoc?.topArtists?.[0]
        ? `${guildStatsDoc.topArtists[0].label} (${guildStatsDoc.topArtists[0].plays}x)`
        : null;
    let topGenreLabel = guildStatsDoc?.topGenres?.[0]?.label || null;

    if (completedRows.length > 0) {
        const trackMap = new Map();
        const artistMap = new Map();
        const genreMap = new Map();
        for (const r of completedRows) {
            const tk = r.trackKey || `${r.title}::${r.author}`;
            const prevT = trackMap.get(tk) || { title: r.title, author: r.author, count: 0 };
            prevT.count += 1;
            trackMap.set(tk, prevT);

            if (r.author && r.author !== "Unknown") {
                const ak = r.author.toLowerCase();
                const prevA = artistMap.get(ak) || { name: r.author, count: 0 };
                prevA.count += 1;
                artistMap.set(ak, prevA);
            }
            if (r.genre) {
                const gk = r.genre.toLowerCase();
                const prevG = genreMap.get(gk) || { name: r.genre, count: 0 };
                prevG.count += 1;
                genreMap.set(gk, prevG);
            }
        }
        const bestT = [...trackMap.values()].sort((a, b) => b.count - a.count)[0];
        const bestA = [...artistMap.values()].sort((a, b) => b.count - a.count)[0];
        const bestG = [...genreMap.values()].sort((a, b) => b.count - a.count)[0];
        if (bestT) topTrackLabel = `${bestT.title} — ${bestT.author} (${bestT.count}x)`;
        if (bestA) topArtistLabel = `${bestA.name} (${bestA.count}x)`;
        if (bestG) topGenreLabel = bestG.name;
    }

    const levelInfo = computeLevelInfo(profileDoc?.xp || 0);

    return {
        profile: profileDoc || {},
        guildStats: guildStatsDoc || {},
        levelInfo,
        serverRank,
        totalRankedListeners: allGuildStats.length,
        favorites: Array.isArray(favorites) ? favorites : [],
        personalPlaylists: Array.isArray(personalPlaylists) ? personalPlaylists : [],
        recentHistory: userHistory.filter((r) => r.status !== "failed").slice(0, 15),
        topTrackLabel: topTrackLabel || "Belum tercatat",
        topArtistLabel: topArtistLabel || "Belum tercatat",
        topGenreLabel: topGenreLabel || "Metadata belum tersedia",
        premium,
        joinedTimestamp: targetMember?.joinedTimestamp || null,
        displayName: targetMember?.displayName || targetUser.globalName || targetUser.username,
    };
}

function buildMusicProfileEmbed(client, { targetUser, snapshot }) {
    const botName = client.config.botName || "Lagukan";
    const iconUrl = client.user?.displayAvatarURL?.() || undefined;
    const avatarUrl = typeof targetUser.displayAvatarURL === "function" ? targetUser.displayAvatarURL({ size: 256 }) : iconUrl;
    const color = snapshot.premium?.customAccentColor || client.config.embedColor || "#5865F2";

    const joinedStr = snapshot.joinedTimestamp ? `<t:${Math.floor(snapshot.joinedTimestamp / 1000)}:D>` : "Tidak tersedia";

    const lastTrack = snapshot.profile?.lastTrack;
    const lastActivityStr =
        lastTrack?.title && lastTrack?.playedAt
            ? `**${lastTrack.title}** — ${lastTrack.author || "Unknown"} (<t:${Math.floor(new Date(lastTrack.playedAt).getTime() / 1000)}:R>)`
            : "Belum ada aktivitas pemutaran";

    const reqCount = Number(snapshot.profile?.totalTracksRequested || 0);
    const startCount = Number(snapshot.profile?.totalTracksStarted || 0);
    const doneCount = Number(snapshot.profile?.totalTracksCompleted || 0);
    const listenMs = Number(snapshot.profile?.totalListeningMs || 0);
    const lv = snapshot.levelInfo;

    const embed = new EmbedBuilder()
        .setColor(color)
        .setAuthor({
            name: `${botName} • Profil Musik Anggota ${snapshot.premium?.isPremium ? `(${snapshot.premium.badge})` : ""}`,
            iconURL: iconUrl,
        })
        .setThumbnail(avatarUrl || null)
        .setDescription(
            `👤 **${snapshot.displayName}** (\`@${targetUser.username}\`)\n` +
                `🆔 User ID: \`${targetUser.id}\` • 📅 Bergabung Server: ${joinedStr}\n\n` +
                `${lv.badge} **Level ${lv.level} — ${lv.title}**\n` +
                `\`${lv.progressBar}\` **${lv.xp} / ${lv.nextLevelXp} XP** (${lv.progressPct}%)`,
        )
        .addFields(
            {
                name: "🎶 Total Lagu Diputar",
                value: `**\`${doneCount}\`** selesai\n*(Diminta: \`${reqCount}\` • Dimulai: \`${startCount}\`)*`,
                inline: true,
            },
            {
                name: "⏱️ Total Waktu Mendengarkan",
                value: `\`${formatListeningDurationHuman(listenMs)}\``,
                inline: true,
            },
            {
                name: "🏆 Ranking Pendengar Server",
                value: `\`${snapshot.serverRank}\``,
                inline: true,
            },
            {
                name: "🔥 Lagu Paling Sering Diputar",
                value: snapshot.topTrackLabel,
                inline: true,
            },
            {
                name: "🎤 Artis Favorit",
                value: snapshot.topArtistLabel,
                inline: true,
            },
            {
                name: "🎼 Genre Favorit",
                value: `\`${snapshot.topGenreLabel}\``,
                inline: true,
            },
            {
                name: "❤️ Lagu Favorit",
                value: `\`${snapshot.favorites.length}\` lagu`,
                inline: true,
            },
            {
                name: "📂 Playlist Pribadi",
                value: `\`${snapshot.personalPlaylists.length}\` playlist`,
                inline: true,
            },
            {
                name: "💎 Status Akun",
                value: `\`${snapshot.premium?.label || "Standard"}\``,
                inline: true,
            },
            {
                name: "🕒 Aktivitas Musik Terakhir",
                value: lastActivityStr,
                inline: false,
            },
        )
        .setFooter({
            text: `${botName} Music Profile • Statistik dihitung murni dari durasi pemutaran nyata`,
            iconURL: iconUrl,
        })
        .setTimestamp();

    return embed;
}

function buildMusicProfileButtons(activeView = "profile") {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("mprof:favorite")
            .setEmoji("❤️")
            .setLabel("Favorite")
            .setStyle(activeView === "favorite" ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("mprof:playlist")
            .setEmoji("📂")
            .setLabel("Playlist")
            .setStyle(activeView === "playlist" ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("mprof:history")
            .setEmoji("🕒")
            .setLabel("Listening History")
            .setStyle(activeView === "history" ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("mprof:wrapped")
            .setEmoji("🎁")
            .setLabel("Music Wrapped")
            .setStyle(activeView === "wrapped" ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("mprof:refresh").setEmoji("🔄").setLabel("Refresh Profile").setStyle(ButtonStyle.Success),
    );
    return [row];
}

async function computeMusicWrappedData(client, { userId, periodType = "weekly", period = null, guildId = null }) {
    const resolvedPeriod = period || periodType || "weekly";
    const uid = String(userId);
    const windowDays = resolvedPeriod === "alltime" ? 3650 : resolvedPeriod === "monthly" ? 30 : 7;
    const cutoff = Date.now() - windowDays * 86400 * 1000;

    const rawRows = client?.listeningHistoryData ? await client.listeningHistoryData.find({ userId: uid }).catch(() => []) : [];

    const rows = (Array.isArray(rawRows) ? rawRows : [])
        .map((r) => (typeof r.toObject === "function" ? r.toObject() : r))
        .filter(
            (r) =>
                r.status !== "failed" &&
                new Date(r.startedAt || 0).getTime() >= cutoff &&
                (r.status === "completed" || Number(r.listenedMs || 0) >= 15000),
        );

    if (rows.length === 0) {
        return { sufficient: false, periodType: resolvedPeriod, windowDays };
    }

    let totalListeningMs = 0;
    const trackMap = new Map();
    const artistMap = new Map();
    const genreMap = new Map();
    const dayCounters = new Array(7).fill(0);
    const hourCounters = new Array(24).fill(0);

    for (const r of rows) {
        const ms = Number(r.listenedMs || 0);
        totalListeningMs += ms;

        const tk = r.trackKey || `${r.title}::${r.author}`;
        const curT = trackMap.get(tk) || { title: r.title, author: r.author, plays: 0, listenedMs: 0 };
        curT.plays += 1;
        curT.listenedMs += ms;
        trackMap.set(tk, curT);

        if (r.author && r.author !== "Unknown") {
            const ak = r.author.toLowerCase();
            const curA = artistMap.get(ak) || { name: r.author, plays: 0, listenedMs: 0 };
            curA.plays += 1;
            curA.listenedMs += ms;
            artistMap.set(ak, curA);
        }

        if (r.genre) {
            const gk = r.genre.toLowerCase();
            const curG = genreMap.get(gk) || { name: r.genre, plays: 0 };
            curG.plays += 1;
            genreMap.set(gk, curG);
        }

        const dIdx = Number.isInteger(r.dayOfWeek) ? r.dayOfWeek : new Date(r.startedAt).getDay();
        const hIdx = Number.isInteger(r.hourOfDay) ? r.hourOfDay : new Date(r.startedAt).getHours();
        if (dIdx >= 0 && dIdx < 7) dayCounters[dIdx] += 1;
        if (hIdx >= 0 && hIdx < 24) hourCounters[hIdx] += 1;
    }

    const topTracks = [...trackMap.values()].sort((a, b) => b.plays - a.plays || b.listenedMs - a.listenedMs).slice(0, 10);
    const topArtists = [...artistMap.values()].sort((a, b) => b.plays - a.plays || b.listenedMs - a.listenedMs).slice(0, 5);
    const topGenres = [...genreMap.values()].sort((a, b) => b.plays - a.plays);

    let bestDayIdx = 0;
    for (let i = 1; i < 7; i++) {
        if (dayCounters[i] > dayCounters[bestDayIdx]) bestDayIdx = i;
    }
    let bestHourIdx = 0;
    for (let i = 1; i < 24; i++) {
        if (hourCounters[i] > hourCounters[bestHourIdx]) bestHourIdx = i;
    }

    const periodKey = periodType === "monthly" ? getMonthKey(new Date()) : getIsoWeekKey(new Date());
    await client.musicWrappedData
        ?.findOneAndUpdate(
            { userId: uid, guildId: guildId ? String(guildId) : "global", periodType, periodKey },
            {
                $set: {
                    totalTracks: rows.length,
                    totalListeningMs,
                    topTracks,
                    topArtists,
                    favoriteGenre: topGenres[0]?.name || null,
                    mostActiveDay: DAY_NAMES_ID[bestDayIdx],
                    mostActiveHour: bestHourIdx,
                    generatedAt: new Date(),
                },
            },
            { upsert: true, returnDocument: "after" },
        )
        .catch(() => {});

    return {
        sufficient: true,
        periodType,
        windowDays,
        totalTracks: rows.length,
        totalListeningMs,
        topTracks,
        topArtists,
        favoriteGenre: topGenres[0]?.name || null,
        mostActiveDay: DAY_NAMES_ID[bestDayIdx],
        mostActiveHour: bestHourIdx,
        mostPlayedSong: topTracks[0] || null,
    };
}

function buildMusicWrappedPages(client, targetUser, wrapped) {
    const botName = client.config.botName || "Lagukan";
    const color = client.config.embedColor || "#5865F2";
    const periodLabel =
        wrapped.periodType === "alltime"
            ? "Sepanjang Waktu (All-Time)"
            : wrapped.periodType === "monthly"
              ? "Bulanan (30 Hari Terakhir)"
              : "Mingguan (7 Hari Terakhir)";

    if (!wrapped.sufficient) {
        const emptyEmbed = new EmbedBuilder()
            .setColor(color)
            .setTitle(`🎁 ${botName} Music Wrapped — ${periodLabel}`)
            .setDescription(
                `Belum ada cukup aktivitas mendengarkan musik yang tercatat untuk **${targetUser.username}** pada periode ini.\n\n` +
                    `Dengarkan musik bersama **${botName}** terlebih dahulu — statistik Wrapped hanya dibuat dari pemutaran lagu yang benar-benar berjalan.`,
            );
        return [emptyEmbed];
    }

    const hourStr = `${String(wrapped.mostActiveHour).padStart(2, "0")}:00 - ${String((wrapped.mostActiveHour + 1) % 24).padStart(2, "0")}:00`;

    const page1 = new EmbedBuilder()
        .setColor(color)
        .setTitle(`🎁 ${botName} Music Wrapped — ${periodLabel}`)
        .setThumbnail(typeof targetUser.displayAvatarURL === "function" ? targetUser.displayAvatarURL({ size: 256 }) : null)
        .setDescription(`Rekap aktivitas musik asli milik **${targetUser.username}** selama **${wrapped.windowDays} hari** terakhir:`)
        .addFields(
            { name: "🎵 Total Lagu Didengarkan", value: `\`${wrapped.totalTracks}\` lagu`, inline: true },
            { name: "⏱️ Total Durasi", value: `\`${formatListeningDurationHuman(wrapped.totalListeningMs)}\``, inline: true },
            { name: "🎼 Genre Favorit", value: `\`${wrapped.favoriteGenre || "Metadata belum tersedia"}\``, inline: true },
            { name: "📅 Hari Paling Aktif", value: `\`${wrapped.mostActiveDay}\``, inline: true },
            { name: "⏰ Jam Paling Aktif", value: `\`${hourStr}\``, inline: true },
            {
                name: "🏆 Lagu Paling Sering Diputar",
                value: wrapped.mostPlayedSong
                    ? `**${wrapped.mostPlayedSong.title}** — ${wrapped.mostPlayedSong.author} (\`${wrapped.mostPlayedSong.plays}x\`)`
                    : "-",
                inline: false,
            },
        )
        .setFooter({ text: `Halaman 1/3 • Ringkasan Aktivitas` });

    const topTrackLines = wrapped.topTracks.map(
        (t, idx) => `\`#${idx + 1}\` **${t.title}** — ${t.author} • \`${t.plays}x\` (\`${formatListeningDurationHuman(t.listenedMs)}\`)`,
    );
    const page2 = new EmbedBuilder()
        .setColor(color)
        .setTitle(`🔥 Top ${wrapped.topTracks.length} Lagu — ${periodLabel}`)
        .setDescription(topTrackLines.length ? topTrackLines.join("\n") : "Belum ada data lagu.")
        .setFooter({ text: `Halaman 2/3 • Top 10 Lagu` });

    const topArtistLines = wrapped.topArtists.map(
        (a, idx) => `\`#${idx + 1}\` **${a.name}** • \`${a.plays}\` pemutaran (\`${formatListeningDurationHuman(a.listenedMs)}\`)`,
    );
    const page3 = new EmbedBuilder()
        .setColor(color)
        .setTitle(`🎤 Top ${wrapped.topArtists.length} Artis — ${periodLabel}`)
        .setDescription(topArtistLines.length ? topArtistLines.join("\n") : "Belum ada data artis.")
        .setFooter({ text: `Halaman 3/3 • Top 5 Artis` });

    return [page1, page2, page3];
}

function attachMusicProfileCollector(client, message, { viewerId, targetUser, targetMember, guild }) {
    if (!message || typeof message.createMessageComponentCollector !== "function") return;

    const collector = message.createMessageComponentCollector({ time: 5 * 60 * 1000 });
    collector.on("collect", (btn) => {
        void (async () => {
            const embedColor = client.config.embedColor || "#5865F2";
            const isOwnerViewer = String(btn.user.id) === String(viewerId);
            if (!isOwnerViewer) {
                const deny = new EmbedBuilder()
                    .setColor(embedColor)
                    .setDescription("Gunakan `/musicprofile` milikmu sendiri untuk menggunakan tombol interaktif profil.");
                await safeReply(btn, { embeds: [deny], flags: MessageFlags.Ephemeral });
                return;
            }

            if (btn.customId === "mprof:refresh") {
                const ack = await safeDeferUpdate(btn);
                if (!ack) return;
                const fresh = await computeUserProfileSnapshot(client, { targetUser, targetMember, guild });
                await message
                    .edit({
                        embeds: [buildMusicProfileEmbed(client, { targetUser, snapshot: fresh })],
                        components: buildMusicProfileButtons("profile"),
                    })
                    .catch(() => {});
                return;
            }

            const snapshot = await computeUserProfileSnapshot(client, { targetUser, targetMember, guild });

            if (btn.customId === "mprof:favorite") {
                const lines = snapshot.favorites.slice(0, 12).map((f, idx) => {
                    const dur = f.isStream ? "LIVE" : convertTime(f.duration || 0);
                    return `\`${idx + 1}.\` **${f.title}** — ${f.author} (\`${dur}\`)`;
                });
                const favEmbed = new EmbedBuilder()
                    .setColor(embedColor)
                    .setTitle(`❤️ Daftar Lagu Favorit — ${targetUser.username} (${snapshot.favorites.length})`)
                    .setDescription(lines.length ? lines.join("\n") : "*Belum ada lagu favorit tersimpan.*")
                    .setFooter({
                        text:
                            String(targetUser.id) === String(btn.user.id)
                                ? "Gunakan /favorite add atau /favorite remove untuk mengelola daftar milikmu."
                                : "Mode baca-saja (Anda sedang melihat profil anggota lain).",
                    });
                await safeReply(btn, { embeds: [favEmbed], flags: MessageFlags.Ephemeral });
                return;
            }

            if (btn.customId === "mprof:playlist") {
                const lines = snapshot.personalPlaylists
                    .slice(0, 12)
                    .map((pl, idx) => `\`${idx + 1}.\` **${pl.name}** — \`${(pl.tracks || []).length}\` lagu`);
                const plEmbed = new EmbedBuilder()
                    .setColor(embedColor)
                    .setTitle(`📂 Playlist Pribadi — ${targetUser.username} (${snapshot.personalPlaylists.length})`)
                    .setDescription(lines.length ? lines.join("\n") : "*Belum ada playlist pribadi dibuat.*")
                    .setFooter({
                        text:
                            String(targetUser.id) === String(btn.user.id)
                                ? "Gunakan /playlist create, /playlist rename, atau /playlist load untuk mengelola playlist Anda."
                                : "Mode baca-saja (hanya pemilik akun yang dapat mengubah playlist miliknya).",
                    });
                await safeReply(btn, { embeds: [plEmbed], flags: MessageFlags.Ephemeral });
                return;
            }

            if (btn.customId === "mprof:history") {
                const lines = snapshot.recentHistory.slice(0, 10).map((h, idx) => {
                    const ts = h.startedAt ? `<t:${Math.floor(new Date(h.startedAt).getTime() / 1000)}:R>` : "";
                    return `\`${idx + 1}.\` **${h.title}** — ${h.author} • \`${formatListeningDurationHuman(h.listenedMs)}\` ${ts}`;
                });
                const histEmbed = new EmbedBuilder()
                    .setColor(embedColor)
                    .setTitle(`🕒 Riwayat Mendengarkan — ${targetUser.username}`)
                    .setDescription(
                        `Total Lagu Didengarkan: **\`${snapshot.profile?.totalTracksCompleted || 0}\`** lagu\n\n` +
                            (lines.length ? lines.join("\n") : "*Belum ada riwayat lagu yang selesai diputar.*"),
                    );
                await safeReply(btn, { embeds: [histEmbed], flags: MessageFlags.Ephemeral });
                return;
            }

            if (btn.customId === "mprof:wrapped") {
                const wrapped = await computeMusicWrappedData(client, {
                    userId: targetUser.id,
                    periodType: "weekly",
                    guildId: guild?.id,
                });
                const pages = buildMusicWrappedPages(client, targetUser, wrapped);
                await safeReply(btn, { embeds: [pages[0]], flags: MessageFlags.Ephemeral });
            }
        })().catch(() => {});
    });
}

/**
 * Builds paginated per-guild Music Leaderboard across all 6 required modes:
 * active, songs, artists, time, weekly, monthly.
 */
async function buildMusicLeaderboardPayload(client, guild, mode = "active", pageIndex = 0) {
    const gid = String(guild.id);
    const botName = client.config.botName || "Lagukan";
    const color = client.config.embedColor || "#5865F2";
    const perPage = 10;

    const modeMeta = {
        active: { title: "🏆 Most Active Listener", desc: "Anggota paling aktif mendengarkan musik di server ini" },
        songs: { title: "🎵 Most Played Songs", desc: "Lagu yang paling sering diputar sampai selesai di server ini" },
        artists: { title: "🎤 Top Artists", desc: "Artis terpopuler berdasarkan pemutaran di server ini" },
        time: { title: "⏱️ Total Listening Time", desc: "Total durasi mendengarkan musik terlama di server ini" },
        weekly: { title: "📅 Weekly Listener", desc: "Pendengar paling aktif minggu ini di server ini" },
        monthly: { title: "🗓️ Monthly Listener", desc: "Pendengar paling aktif bulan ini di server ini" },
    };

    const selectedMode = modeMeta[mode] ? mode : "active";
    let entries = [];

    if (selectedMode === "weekly" || selectedMode === "monthly") {
        const periodKey = selectedMode === "monthly" ? getMonthKey(new Date()) : getIsoWeekKey(new Date());
        const raw = client?.musicLeaderboardData
            ? await client.musicLeaderboardData.find({ guildId: gid, periodType: selectedMode, periodKey }).catch(() => [])
            : [];
        const rows = (Array.isArray(raw) ? raw : [])
            .map((r) => (typeof r.toObject === "function" ? r.toObject() : r))
            .filter((r) => Number(r.totalListeningMs || 0) > 0 || Number(r.tracksCompleted || 0) > 0)
            .sort((a, b) => b.totalListeningMs - a.totalListeningMs || b.tracksCompleted - a.tracksCompleted);

        entries = rows.map(
            (r, i) =>
                `\`#${i + 1}\` <@${r.userId}> — **\`${formatListeningDurationHuman(r.totalListeningMs)}\`** • \`${r.tracksCompleted}\` lagu (\`${r.xp} XP\`)`,
        );
    } else {
        const raw = client?.musicStatisticsData ? await client.musicStatisticsData.find({ guildId: gid }).catch(() => []) : [];
        const statsList = (Array.isArray(raw) ? raw : []).map((r) => (typeof r.toObject === "function" ? r.toObject() : r));

        if (selectedMode === "active") {
            const sorted = statsList
                .filter((r) => Number(r.tracksCompleted || 0) > 0 || Number(r.xp || 0) > 0)
                .sort((a, b) => b.tracksCompleted - a.tracksCompleted || b.xp - a.xp);
            entries = sorted.map((r, i) => {
                const lv = computeLevelInfo(r.xp || 0);
                return `\`#${i + 1}\` <@${r.userId}> — **\`${r.tracksCompleted}\`** lagu • ${lv.badge} Lv.${lv.level} (\`${r.xp} XP\`)`;
            });
        } else if (selectedMode === "time") {
            const sorted = statsList
                .filter((r) => Number(r.totalListeningMs || 0) > 0)
                .sort((a, b) => b.totalListeningMs - a.totalListeningMs);
            entries = sorted.map(
                (r, i) =>
                    `\`#${i + 1}\` <@${r.userId}> — **\`${formatListeningDurationHuman(r.totalListeningMs)}\`** (\`${r.tracksCompleted}\` lagu)`,
            );
        } else if (selectedMode === "songs") {
            const songAgg = new Map();
            for (const s of statsList) {
                for (const t of s.topTracks || []) {
                    const prev = songAgg.get(t.key) || { label: t.label, subLabel: t.subLabel, plays: 0, listenedMs: 0 };
                    prev.plays += Number(t.plays || 0);
                    prev.listenedMs += Number(t.listenedMs || 0);
                    songAgg.set(t.key, prev);
                }
            }
            const sorted = [...songAgg.values()].sort((a, b) => b.plays - a.plays || b.listenedMs - a.listenedMs);
            entries = sorted.map(
                (t, i) =>
                    `\`#${i + 1}\` **${t.label}** ${t.subLabel ? `— ${t.subLabel}` : ""} • \`${t.plays}x\` (\`${formatListeningDurationHuman(t.listenedMs)}\`)`,
            );
        } else if (selectedMode === "artists") {
            const artistAgg = new Map();
            for (const s of statsList) {
                for (const a of s.topArtists || []) {
                    const prev = artistAgg.get(a.key) || { label: a.label, plays: 0, listenedMs: 0 };
                    prev.plays += Number(a.plays || 0);
                    prev.listenedMs += Number(a.listenedMs || 0);
                    artistAgg.set(a.key, prev);
                }
            }
            const sorted = [...artistAgg.values()].sort((a, b) => b.plays - a.plays || b.listenedMs - a.listenedMs);
            entries = sorted.map(
                (a, i) => `\`#${i + 1}\` **${a.label}** • \`${a.plays}\` pemutaran (\`${formatListeningDurationHuman(a.listenedMs)}\`)`,
            );
        }
    }

    const totalPages = Math.max(1, Math.ceil(entries.length / perPage));
    const safePage = Math.min(Math.max(0, pageIndex), totalPages - 1);
    const slice = entries.slice(safePage * perPage, safePage * perPage + perPage);

    const embed = new EmbedBuilder()
        .setColor(color)
        .setAuthor({
            name: `${botName} • Server Music Leaderboard (${guild.name || gid})`,
            iconURL: client.user?.displayAvatarURL?.() || undefined,
        })
        .setTitle(modeMeta[selectedMode].title)
        .setDescription(
            `*${modeMeta[selectedMode].desc}*\n\n` +
                (slice.length ? slice.join("\n") : "*Belum ada statistik aktivitas musik yang tercatat di server ini.*"),
        )
        .setFooter({ text: `Halaman ${safePage + 1}/${totalPages} • Total Entri: ${entries.length} • Guild ID: ${gid}` })
        .setTimestamp();

    const selectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("mlb:mode")
            .setPlaceholder("Pilih kategori Music Leaderboard...")
            .addOptions(
                Object.entries(modeMeta).map(([key, m]) => ({
                    label: m.title.replace(/^[^\s]+\s/, ""),
                    value: key,
                    description: m.desc.slice(0, 95),
                    default: key === selectedMode,
                })),
            ),
    );

    const pageRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("mlb:prev")
            .setEmoji("◀️")
            .setLabel("Prev")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage <= 0),
        new ButtonBuilder()
            .setCustomId("mlb:page")
            .setLabel(`Page ${safePage + 1} / ${totalPages}`)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId("mlb:next")
            .setEmoji("▶️")
            .setLabel("Next")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage >= totalPages - 1),
    );

    return {
        embed,
        embeds: [embed],
        components: [selectRow, pageRow],
        safePage,
        totalPages,
        totalItems: entries.length,
        selectedMode,
    };
}

async function buildProfileEmbedAndComponents(client, { guild, targetUser, targetMember = null }) {
    const snapshot = await computeUserProfileSnapshot(client, { targetUser, targetMember, guild });
    return {
        embeds: [buildMusicProfileEmbed(client, { targetUser, snapshot })],
        components: buildMusicProfileButtons("profile"),
    };
}

async function getUserListeningHistory(client, userId, limit = 50) {
    if (!userId || !client?.listeningHistoryData) return [];
    const raw = await client.listeningHistoryData.find({ userId: String(userId) }).catch(() => []);
    return (Array.isArray(raw) ? raw : [])
        .map((r) => (typeof r.toObject === "function" ? r.toObject() : r))
        .filter((r) => r.status !== "failed" && (r.status === "completed" || Number(r.listenedMs || 0) >= 10000))
        .sort((a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime())
        .slice(0, limit)
        .map((r) => ({ ...r, playedAt: r.startedAt || r.endedAt }));
}

module.exports = {
    LEVEL_TIERS,
    computeLevelInfo,
    formatListeningDurationHuman,
    formatListeningDuration: formatListeningDurationHuman,
    normalizeTrackKey,
    ensureUserProfileDoc,
    ensureUserMusicProfile: ensureUserProfileDoc,
    recordTrackRequest,
    onTrackSessionStart,
    onTrackSessionTick,
    onTrackSessionFailed,
    onTrackSessionEnd,
    computeUserProfileSnapshot,
    buildMusicProfileEmbed,
    buildMusicProfileButtons,
    buildProfileEmbedAndComponents,
    attachMusicProfileCollector,
    attachProfileCollector: attachMusicProfileCollector,
    getUserListeningHistory,
    computeMusicWrappedData,
    buildMusicWrappedPages,
    buildMusicLeaderboardPayload,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
