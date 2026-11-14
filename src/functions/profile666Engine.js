const mongoose = require("mongoose");
const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
const { isCloudDatabaseReady } = require("../databases/cloudAdapter.js");
const { THEME_666, renderLeaderboardCard666, renderUserProfileCard666, invalidateGuildCardCache } = require("./cardRenderer666.js");
const { getBotAppId, getActiveVoiceSession666, sendSessionNotification666 } = require("./profileNotificationManager.js");
const Logger = require("../utils/logger");

// Isolated in-memory active track sessions keyed strictly by `${botApplicationId}:${guildId}`
const activeTrackSessions666 = new Map();

// Bounded Leaderboard query cache keyed by `guildId` (TTL = 25s, invalidated on stats write)
const guildLeaderboardCache = new Map();
const LEADERBOARD_CACHE_TTL_MS = 25_000;
const LEADERBOARD_PAGE_SIZE = 10;

const ACHIEVEMENTS_666 = Object.freeze([
    {
        id: "first_song",
        name: "First Song",
        icon: "🎵",
        description: "Memutar lagu pertama kali menggunakan sistem musik 666 di server ini.",
        check: ({ totalPlays }) => totalPlays >= 1,
    },
    {
        id: "music_lover",
        name: "Music Lover",
        icon: "💜",
        description: "Mendengarkan musik selama total 10 jam waktu aktif sebenarnya.",
        check: ({ totalListeningSeconds }) => totalListeningSeconds >= 10 * 3600,
    },
    {
        id: "music_addict",
        name: "Music Addict",
        icon: "🔥",
        description: "Mendengarkan musik selama total 50 jam waktu aktif sebenarnya.",
        check: ({ totalListeningSeconds }) => totalListeningSeconds >= 50 * 3600,
    },
    {
        id: "night_listener",
        name: "Night Listener",
        icon: "🌙",
        description: "Mendengarkan musik pada waktu tengah malam (00:00 – 04:59).",
        check: ({ totalPlays, isNightSession }) => totalPlays >= 1 && Boolean(isNightSession),
    },
    {
        id: "top_listener",
        name: "Top Listener",
        icon: "👑",
        description: "Mencapai peringkat #1 pendengar paling aktif di papan peringkat server.",
        check: ({ rank, totalUsers, totalPlays, totalListeningSeconds }) =>
            rank === 1 && (totalUsers >= 2 || totalPlays >= 3) && (totalListeningSeconds > 0 || totalPlays >= 2),
    },
    {
        id: "plays_100",
        name: "100 Plays",
        icon: "💿",
        description: "Memutar total 100 lagu di server ini.",
        check: ({ totalPlays }) => totalPlays >= 100,
    },
    {
        id: "plays_1000",
        name: "1000 Plays",
        icon: "💎",
        description: "Memutar total 1.000 lagu di server ini.",
        check: ({ totalPlays }) => totalPlays >= 1000,
    },
]);

function isDbReady(model) {
    if (isCloudDatabaseReady()) return true;
    if (model?.db && typeof model.db.readyState === "number") {
        return model.db.readyState === 1;
    }
    if (mongoose.connection.readyState === 1) return true;
    if (model && !model.db) return true;
    return false;
}

function makeBotGuildKey(botApplicationId, guildId) {
    return `${String(botApplicationId)}:${String(guildId)}`;
}

function normalizeTrackKey666(track) {
    if (!track) return "unknown";
    if (track.identifier) {
        return `id:${String(track.identifier).toLowerCase().trim()}`;
    }
    const title = String(track.title || "unknown")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
    const author = String(track.author || "unknown")
        .replace(/ - Topic$/i, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
    return `meta:${title}::${author}`;
}

function collectVoiceHumanListenerIds666(client, guildId, voiceChannelId, requesterId = null) {
    const botId = getBotAppId(client);
    const listeners = new Set();

    if (requesterId && String(requesterId) !== botId) {
        listeners.add(String(requesterId));
    }

    const guild = client?.guilds?.cache?.get?.(String(guildId || ""));
    const voiceChannel =
        (voiceChannelId && guild?.channels?.cache?.get?.(String(voiceChannelId))) || guild?.members?.me?.voice?.channel || null;

    if (voiceChannel?.members && typeof voiceChannel.members.values === "function") {
        for (const member of voiceChannel.members.values()) {
            if (!member || member.user?.bot) continue;
            if (member.voice?.selfDeaf || member.voice?.serverDeaf) continue;
            const uid = String(member.id || member.user?.id || "");
            if (uid && uid !== botId) {
                listeners.add(uid);
            }
        }
    }

    return listeners;
}

function isMidnightWindow(date = new Date()) {
    const hour = date.getHours();
    return hour >= 0 && hour < 5;
}

function invalidateGuildLeaderboardCache(guildId) {
    if (!guildId) return;
    guildLeaderboardCache.delete(String(guildId));
    invalidateGuildCardCache(String(guildId));
}

function mergeFavoriteSongs(existingList = [], updateEntry, maxItems = 30) {
    const map = new Map();
    for (const item of existingList || []) {
        if (!item?.trackKey) continue;
        map.set(item.trackKey, {
            trackKey: item.trackKey,
            title: item.title || "Unknown",
            author: item.author || "Unknown",
            uri: item.uri || null,
            artworkUrl: item.artworkUrl || null,
            plays: Number(item.plays || 0),
            listenedSeconds: Number(item.listenedSeconds || 0),
            lastPlayedAt: item.lastPlayedAt || null,
        });
    }

    if (updateEntry?.trackKey) {
        const prev = map.get(updateEntry.trackKey);
        if (prev) {
            prev.plays += Number(updateEntry.plays || 0);
            prev.listenedSeconds += Number(updateEntry.listenedSeconds || 0);
            if (updateEntry.title) prev.title = updateEntry.title;
            if (updateEntry.author) prev.author = updateEntry.author;
            if (updateEntry.uri) prev.uri = updateEntry.uri;
            if (updateEntry.artworkUrl) prev.artworkUrl = updateEntry.artworkUrl;
            if (updateEntry.lastPlayedAt) prev.lastPlayedAt = updateEntry.lastPlayedAt;
        } else {
            map.set(updateEntry.trackKey, {
                trackKey: updateEntry.trackKey,
                title: updateEntry.title || "Unknown",
                author: updateEntry.author || "Unknown",
                uri: updateEntry.uri || null,
                artworkUrl: updateEntry.artworkUrl || null,
                plays: Number(updateEntry.plays || 0),
                listenedSeconds: Number(updateEntry.listenedSeconds || 0),
                lastPlayedAt: updateEntry.lastPlayedAt || new Date(),
            });
        }
    }

    return Array.from(map.values())
        .sort((a, b) => b.plays - a.plays || b.listenedSeconds - a.listenedSeconds)
        .slice(0, maxItems);
}

/**
 * Atomically increments play count or listening duration for a single `(botApplicationId, guildId, userId)` record.
 */
async function atomicUpsertBotUserStats(
    client,
    { botApplicationId, guildId, userId, incPlays = 0, incCompleted = 0, incSeconds = 0, songDelta = null, playedAt = new Date() },
) {
    const model = client?.profile666StatsData;
    if (!model || !isDbReady(model) || !botApplicationId || !guildId || !userId) return null;

    const filter = {
        botApplicationId: String(botApplicationId),
        guildId: String(guildId),
        userId: String(userId),
    };

    const incFields = {};
    if (incPlays > 0) incFields.totalPlays = incPlays;
    if (incCompleted > 0) incFields.completedPlays = incCompleted;
    if (incSeconds > 0) incFields.totalListeningSeconds = incSeconds;

    const updateDoc = {
        $set: { lastPlayedAt: playedAt },
    };
    if (Object.keys(incFields).length > 0) {
        updateDoc.$inc = incFields;
    }

    const updated = await model.findOneAndUpdate(filter, updateDoc, { upsert: true, returnDocument: "after" }).catch((err) => {
        Logger.debug(`[Profile666] Gagal atomic upsert stats (${botApplicationId}/${guildId}/${userId}): ${err?.message || err}`);
        return null;
    });

    if (updated && songDelta?.trackKey) {
        const plain = typeof updated.toObject === "function" ? updated.toObject() : updated;
        const nextFavorites = mergeFavoriteSongs(plain.favoriteSongs || [], songDelta);
        await model.findOneAndUpdate(filter, { $set: { favoriteSongs: nextFavorites } }, { returnDocument: "after" }).catch(() => {});
    }

    invalidateGuildLeaderboardCache(guildId);
    return updated;
}

/**
 * Reads aggregated guild-level statistics for all listeners in `guildId` across the server's
 * isolated per-bot telemetry rows (strictly separated by `guildId`, cached for 25s).
 */
async function getGuildAggregatedLeaderboard(client, guildId, forceRefresh = false) {
    const gId = String(guildId || "");
    if (!gId) return [];

    if (!forceRefresh && guildLeaderboardCache.has(gId)) {
        const cached = guildLeaderboardCache.get(gId);
        if (Date.now() <= cached.expiresAt) {
            return cached.rows;
        }
        guildLeaderboardCache.delete(gId);
    }

    const model = client?.profile666StatsData;
    if (!model || !isDbReady(model)) {
        return [];
    }

    const docs = (await model.find({ guildId: gId }).catch(() => [])) || [];
    const byUser = new Map();

    for (const rawDoc of docs) {
        const doc = typeof rawDoc.toObject === "function" ? rawDoc.toObject() : rawDoc;
        if (!doc?.userId || String(doc.guildId) !== gId) continue;

        const uid = String(doc.userId);
        let agg = byUser.get(uid);
        if (!agg) {
            agg = {
                guildId: gId,
                userId: uid,
                totalPlays: 0,
                completedPlays: 0,
                totalListeningSeconds: 0,
                favoriteSongsMap: new Map(),
                achievementIds: new Set(),
                lastPlayedAt: null,
                perBot: {},
            };
            byUser.set(uid, agg);
        }

        const plays = Math.max(0, Number(doc.totalPlays || 0));
        const completed = Math.max(0, Number(doc.completedPlays || 0));
        const secs = Math.max(0, Number(doc.totalListeningSeconds || 0));

        agg.totalPlays += plays;
        agg.completedPlays += completed;
        agg.totalListeningSeconds += secs;

        if (doc.botApplicationId) {
            agg.perBot[String(doc.botApplicationId)] = {
                totalPlays: plays,
                completedPlays: completed,
                totalListeningSeconds: secs,
            };
        }

        if (doc.lastPlayedAt) {
            const d = new Date(doc.lastPlayedAt);
            if (!agg.lastPlayedAt || d > agg.lastPlayedAt) {
                agg.lastPlayedAt = d;
            }
        }

        for (const song of doc.favoriteSongs || []) {
            if (!song?.trackKey) continue;
            const prev = agg.favoriteSongsMap.get(song.trackKey);
            if (prev) {
                prev.plays += Number(song.plays || 0);
                prev.listenedSeconds += Number(song.listenedSeconds || 0);
            } else {
                agg.favoriteSongsMap.set(song.trackKey, {
                    trackKey: song.trackKey,
                    title: song.title || "Unknown",
                    author: song.author || "Unknown",
                    uri: song.uri || null,
                    artworkUrl: song.artworkUrl || null,
                    plays: Number(song.plays || 0),
                    listenedSeconds: Number(song.listenedSeconds || 0),
                });
            }
        }

        for (const ach of doc.achievements || []) {
            if (ach?.id) agg.achievementIds.add(ach.id);
        }
    }

    const sorted = Array.from(byUser.values())
        .filter((u) => u.totalPlays > 0 || u.totalListeningSeconds > 0)
        .map((u) => {
            const favoriteSongs = Array.from(u.favoriteSongsMap.values()).sort(
                (a, b) => b.plays - a.plays || b.listenedSeconds - a.listenedSeconds,
            );
            return {
                guildId: u.guildId,
                userId: u.userId,
                totalPlays: u.totalPlays,
                completedPlays: u.completedPlays,
                totalListeningSeconds: u.totalListeningSeconds,
                favoriteSongs,
                favoriteSong: favoriteSongs[0] || null,
                achievementIds: Array.from(u.achievementIds),
                lastPlayedAt: u.lastPlayedAt,
                perBot: u.perBot,
            };
        })
        .sort((a, b) => b.totalListeningSeconds - a.totalListeningSeconds || b.totalPlays - a.totalPlays);

    sorted.forEach((entry, idx) => {
        entry.rank = idx + 1;
    });

    guildLeaderboardCache.set(gId, {
        rows: sorted,
        expiresAt: Date.now() + LEADERBOARD_CACHE_TTL_MS,
    });

    return sorted;
}

async function getUnlockedAchievementIds(client, guildId, userId) {
    const model = client?.userGuildAchievementData;
    if (!model || !isDbReady(model) || !guildId || !userId) return [];

    const docs =
        (await model
            .find({
                guildId: String(guildId),
                userId: String(userId),
            })
            .catch(() => [])) || [];

    return docs.map((d) => String(d.achievementId)).filter(Boolean);
}

/**
 * Atomically claims an achievement once per `(guildId, userId, achievementId)`.
 * Uses unique compound index `{ guildId: 1, userId: 1, achievementId: 1 }` so concurrent bots
 * can NEVER unlock or announce the same achievement twice.
 */
async function tryAtomicUnlockAchievement(client, { botApplicationId, guildId, userId, achievementId, sessionId }) {
    const model = client?.userGuildAchievementData;
    if (!model || !isDbReady(model)) return false;

    const gId = String(guildId);
    const uId = String(userId);
    const aId = String(achievementId);

    const already = await model.findOne({ guildId: gId, userId: uId, achievementId: aId }).catch(() => null);
    if (already) return false;

    try {
        await model.create({
            guildId: gId,
            userId: uId,
            achievementId: aId,
            botApplicationId: String(botApplicationId),
            sessionId: sessionId ? String(sessionId) : null,
            unlockedAt: new Date(),
        });
    } catch {
        // Duplicate key (E11000) or DB error -> another process already unlocked it
        return false;
    }

    // Mirror into Profile666Stats.achievements array for schema completeness
    if (client?.profile666StatsData && isDbReady(client.profile666StatsData)) {
        const doc = await client.profile666StatsData
            .findOne({ botApplicationId: String(botApplicationId), guildId: gId, userId: uId })
            .catch(() => null);
        if (doc) {
            const plain = typeof doc.toObject === "function" ? doc.toObject() : doc;
            const current = Array.isArray(plain.achievements) ? plain.achievements : [];
            if (!current.some((x) => x?.id === aId)) {
                await client.profile666StatsData
                    .findOneAndUpdate(
                        { botApplicationId: String(botApplicationId), guildId: gId, userId: uId },
                        { $set: { achievements: [...current, { id: aId, unlockedAt: new Date() }] } },
                    )
                    .catch(() => {});
            }
        }
    }

    return true;
}

function buildAchievementEmbed666(client, { username, userId, achievement }) {
    const botName = client?.user?.username || "Lagukan 666";
    return new EmbedBuilder()
        .setColor(THEME_666.embedMagenta)
        .setAuthor({
            name: `666 • ACHIEVEMENT UNLOCKED`,
            iconURL: client?.user?.displayAvatarURL?.({ extension: "png", size: 128 }) || undefined,
        })
        .setTitle(`${achievement.icon} ${achievement.name}`)
        .setDescription([`Selamat **${username}** (<@${userId}>)!`, `> ${achievement.description}`].join("\n"))
        .addFields(
            { name: "Pengguna", value: `\`${username}\``, inline: true },
            { name: "Achievement", value: `${achievement.icon} **${achievement.name}**`, inline: true },
        )
        .setFooter({ text: `666 Music Profile • ${botName}` })
        .setTimestamp();
}

async function evaluateAndDispatchAchievements666(client, { botApplicationId, guildId, userId, sessionId, isNightSession }) {
    if (!botApplicationId || !guildId || !userId) return [];

    const leaderboard = await getGuildAggregatedLeaderboard(client, guildId, true);
    const userEntry = leaderboard.find((row) => row.userId === String(userId));
    if (!userEntry) return [];

    const existingIds = new Set([...(userEntry.achievementIds || []), ...(await getUnlockedAchievementIds(client, guildId, userId))]);

    const context = {
        totalPlays: userEntry.totalPlays,
        completedPlays: userEntry.completedPlays,
        totalListeningSeconds: userEntry.totalListeningSeconds,
        rank: userEntry.rank || null,
        totalUsers: leaderboard.length,
        isNightSession: Boolean(isNightSession),
    };

    const newlyUnlocked = [];

    for (const ach of ACHIEVEMENTS_666) {
        if (existingIds.has(ach.id)) continue;
        if (!ach.check(context)) continue;

        const wonLock = await tryAtomicUnlockAchievement(client, {
            botApplicationId,
            guildId,
            userId,
            achievementId: ach.id,
            sessionId,
        });

        if (!wonLock) continue;
        newlyUnlocked.push(ach);

        // Resolve display username cleanly without requiring GuildMembers privileged intent
        const guild = client?.guilds?.cache?.get?.(String(guildId));
        const cachedUser = client?.users?.cache?.get?.(String(userId)) || guild?.members?.cache?.get?.(String(userId))?.user || null;
        const username = cachedUser?.globalName || cachedUser?.username || `User ${userId}`;

        const embed = buildAchievementEmbed666(client, {
            username,
            userId,
            achievement: ach,
        });

        // Strictly send ONLY to the notification channel linked to THIS bot's active voice session
        await sendSessionNotification666(client, guildId, { embeds: [embed] }, sessionId);
    }

    return newlyUnlocked;
}

/**
 * Called ONLY when a track genuinely starts playing on `client`'s Rainlink player (`trackStart`).
 * Never called when tracks are merely queued!
 */
async function onProfile666TrackStart(client, player, track) {
    const botApplicationId = getBotAppId(client);
    const guildId = String(player?.guildId || "");
    if (!botApplicationId || !guildId || !track) return;
    if (player.data?.get?.("guessTheSongActive")) return;

    const mapKey = makeBotGuildKey(botApplicationId, guildId);
    if (activeTrackSessions666.has(mapKey)) {
        await onProfile666TrackEnd(client, player, "replaced").catch(() => {});
    }

    const now = Date.now();
    const requesterId = track.requester?.id && String(track.requester.id) !== botApplicationId ? String(track.requester.id) : null;
    const listeners = collectVoiceHumanListenerIds666(client, guildId, player.voiceId, requesterId);
    const voiceSession = getActiveVoiceSession666(client, guildId);
    const sessionId = voiceSession?.sessionId || player.data?.get?.("sessionId666") || null;

    const cleanAuthor =
        String(track.author || "Unknown")
            .replace(/ - Topic$/i, "")
            .trim() || "Unknown";

    const trackKey = normalizeTrackKey666(track);
    const isPaused = Boolean(player.paused);
    const nightFlag = isMidnightWindow(new Date(now));

    const tracker = {
        botApplicationId,
        guildId,
        voiceChannelId: String(player.voiceId || ""),
        sessionId,
        trackKey,
        title: String(track.title || "Unknown"),
        author: cleanAuthor,
        uri: track.pluginInfo?.originalUri || track.uri || null,
        artworkUrl: track.artworkUrl || null,
        durationMs: Math.max(0, Number(track.duration || 0)),
        isStream: Boolean(track.isStream),
        listeners,
        startedAt: now,
        isPaused,
        segmentStartWallMs: isPaused ? null : now,
        segmentStartPosMs: Math.max(0, Number(player.position || 0)),
        accumulatedUnpausedMs: 0,
        isNightSession: nightFlag,
        settled: false,
    };

    activeTrackSessions666.set(mapKey, tracker);

    // Record 1 real play per active listener (actual playback started, NOT queue addition!)
    for (const uid of listeners) {
        await atomicUpsertBotUserStats(client, {
            botApplicationId,
            guildId,
            userId: uid,
            incPlays: 1,
            songDelta: {
                trackKey,
                title: tracker.title,
                author: tracker.author,
                uri: tracker.uri,
                artworkUrl: tracker.artworkUrl,
                plays: 1,
                listenedSeconds: 0,
                lastPlayedAt: new Date(now),
            },
            playedAt: new Date(now),
        });

        await evaluateAndDispatchAchievements666(client, {
            botApplicationId,
            guildId,
            userId: uid,
            sessionId,
            isNightSession: nightFlag,
        });
    }
}

/**
 * Freezes unpaused duration stopwatch immediately when player enters paused state.
 * Time spent paused is NEVER counted toward Total Hours.
 */
function onProfile666Pause(client, player) {
    const botApplicationId = getBotAppId(client);
    const guildId = String(player?.guildId || "");
    if (!botApplicationId || !guildId) return;

    const tracker = activeTrackSessions666.get(makeBotGuildKey(botApplicationId, guildId));
    if (!tracker || tracker.settled || tracker.isPaused) return;

    const now = Date.now();
    if (tracker.segmentStartWallMs !== null) {
        const wallDelta = Math.max(0, now - tracker.segmentStartWallMs);
        const currentPos = Math.max(0, Number(player?.position || 0));
        const posDelta = currentPos - tracker.segmentStartPosMs;
        const segmentMs = posDelta > 0 ? Math.min(posDelta, Math.max(1500, Math.floor(wallDelta * 1.25))) : wallDelta;
        tracker.accumulatedUnpausedMs += Math.max(0, segmentMs);
    }

    tracker.isPaused = true;
    tracker.segmentStartWallMs = null;
}

/**
 * Resumes unpaused duration stopwatch from the exact moment playback resumes.
 */
function onProfile666Resume(client, player) {
    const botApplicationId = getBotAppId(client);
    const guildId = String(player?.guildId || "");
    if (!botApplicationId || !guildId) return;

    const tracker = activeTrackSessions666.get(makeBotGuildKey(botApplicationId, guildId));
    if (!tracker || tracker.settled || !tracker.isPaused) return;

    tracker.isPaused = false;
    tracker.segmentStartWallMs = Date.now();
    tracker.segmentStartPosMs = Math.max(0, Number(player?.position || 0));
}

/**
 * Event-driven Lavalink `playerUpdate` checkpoint (never runs a 1s interval!).
 */
function onProfile666Tick(client, player) {
    const botApplicationId = getBotAppId(client);
    const guildId = String(player?.guildId || "");
    if (!botApplicationId || !guildId) return;

    const tracker = activeTrackSessions666.get(makeBotGuildKey(botApplicationId, guildId));
    if (!tracker || tracker.settled) return;

    if (player.paused && !tracker.isPaused) {
        onProfile666Pause(client, player);
        return;
    }
    if (!player.paused && tracker.isPaused) {
        onProfile666Resume(client, player);
        return;
    }

    if (!tracker.isPaused && tracker.segmentStartWallMs !== null) {
        const now = Date.now();
        const wallDelta = Math.max(0, now - tracker.segmentStartWallMs);
        const currentPos = Math.max(0, Number(player.position || 0));
        const posDelta = currentPos - tracker.segmentStartPosMs;

        if (posDelta > 0) {
            tracker.accumulatedUnpausedMs += Math.min(posDelta, Math.max(1500, Math.floor(wallDelta * 1.25)));
        }
        tracker.segmentStartWallMs = now;
        tracker.segmentStartPosMs = currentPos;
    }

    const activeHumans = collectVoiceHumanListenerIds666(client, guildId, player.voiceId, null);
    for (const uid of activeHumans) {
        tracker.listeners.add(uid);
    }
}

/**
 * Settles real unpaused listening seconds when a track ends, skips, or the player disconnects.
 */
async function onProfile666TrackEnd(client, player, reason = "finished") {
    const botApplicationId = getBotAppId(client);
    const guildId = String(player?.guildId || "");
    if (!botApplicationId || !guildId) return;

    const mapKey = makeBotGuildKey(botApplicationId, guildId);
    const tracker = activeTrackSessions666.get(mapKey);
    if (!tracker || tracker.settled) return;

    tracker.settled = true;
    activeTrackSessions666.delete(mapKey);

    if (reason === "failed") return;

    const now = Date.now();
    if (!tracker.isPaused && tracker.segmentStartWallMs !== null) {
        const wallDelta = Math.max(0, now - tracker.segmentStartWallMs);
        const currentPos = Math.max(0, Number(player?.position || 0));
        const posDelta = currentPos - tracker.segmentStartPosMs;

        if (posDelta > 0) {
            tracker.accumulatedUnpausedMs += Math.min(posDelta, Math.max(1500, Math.floor(wallDelta * 1.25)));
        } else if (wallDelta > 0) {
            tracker.accumulatedUnpausedMs += wallDelta;
        }
    }

    let totalMs = Math.max(0, Math.round(tracker.accumulatedUnpausedMs));
    if (!tracker.isStream && tracker.durationMs > 0) {
        totalMs = Math.min(totalMs, tracker.durationMs);
    }

    const listenedSeconds = Math.max(0, Math.floor(totalMs / 1000));
    const minCompleteSec = tracker.durationMs > 0 ? Math.min(20, Math.max(5, Math.floor(tracker.durationMs / 2000))) : 20;
    const isCompleted =
        listenedSeconds >= minCompleteSec &&
        (reason === "finished" || listenedSeconds >= 30 || (tracker.durationMs > 0 && totalMs >= tracker.durationMs * 0.5));

    const nightFlag = tracker.isNightSession || isMidnightWindow(new Date(now));

    for (const uid of tracker.listeners) {
        await atomicUpsertBotUserStats(client, {
            botApplicationId,
            guildId,
            userId: uid,
            incPlays: 0,
            incCompleted: isCompleted ? 1 : 0,
            incSeconds: listenedSeconds,
            songDelta:
                listenedSeconds > 0
                    ? {
                          trackKey: tracker.trackKey,
                          title: tracker.title,
                          author: tracker.author,
                          uri: tracker.uri,
                          artworkUrl: tracker.artworkUrl,
                          plays: 0,
                          listenedSeconds,
                          lastPlayedAt: new Date(now),
                      }
                    : null,
            playedAt: new Date(now),
        });

        await evaluateAndDispatchAchievements666(client, {
            botApplicationId,
            guildId,
            userId: uid,
            sessionId: tracker.sessionId,
            isNightSession: nightFlag,
        });
    }
}

function formatHoursDecimal(seconds = 0) {
    const hrs = Math.max(0, Number(seconds || 0)) / 3600;
    return hrs.toFixed(2);
}

function formatJoinDate(dateInput) {
    if (!dateInput) return "Tidak diketahui";
    const d = new Date(dateInput);
    if (Number.isNaN(d.getTime())) return "Tidak diketahui";
    const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    return `${String(d.getUTCDate()).padStart(2, "0")} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Builds the `/leaderboard` Top 10 payload (666 Embed + cached 666 PNG Card + Pagination).
 */
async function buildLeaderboard666Payload(client, guild, callerUser, requestedPage = 0) {
    const guildId = String(guild?.id || "");
    const guildName = guild?.name || "Discord Server";
    const allRows = await getGuildAggregatedLeaderboard(client, guildId);

    const totalPages = Math.max(1, Math.ceil(allRows.length / LEADERBOARD_PAGE_SIZE));
    const safePage = Math.max(0, Math.min(Number(requestedPage) || 0, totalPages - 1));
    const slice = allRows.slice(safePage * LEADERBOARD_PAGE_SIZE, (safePage + 1) * LEADERBOARD_PAGE_SIZE);

    const enriched = await Promise.all(
        slice.map(async (row) => {
            const member = guild?.members?.cache?.get?.(row.userId) || null;
            const userObj =
                member?.user || client?.users?.cache?.get?.(row.userId) || (await client?.users?.fetch?.(row.userId).catch(() => null));
            const username = userObj?.globalName || userObj?.username || `User ${row.userId}`;
            const avatarUrl = userObj?.displayAvatarURL?.({ extension: "png", size: 128 }) || null;
            return {
                ...row,
                username,
                avatarUrl,
                hoursText: formatHoursDecimal(row.totalListeningSeconds),
            };
        }),
    );

    const callerId = String(callerUser?.id || "");
    const callerEntry = allRows.find((r) => r.userId === callerId) || null;
    const callerRank = callerEntry?.rank || null;
    const callerUsername = callerUser?.globalName || callerUser?.username || "Listener";

    const lines =
        enriched.length === 0
            ? ["Belum ada aktivitas mendengarkan musik yang tercatat di server ini."]
            : enriched.map((item) => {
                  const rankIcon = item.rank === 1 ? "👑" : item.rank === 2 ? "🥈" : item.rank === 3 ? "🥉" : `\`#${item.rank}\``;
                  return `${rankIcon} **${item.username}** — \`${item.hoursText} Jam\` • \`${item.totalPlays} Lagu\``;
              });

    const embed = new EmbedBuilder()
        .setColor(THEME_666.embedColor)
        .setAuthor({
            name: `666 • MUSIC LEADERBOARD`,
            iconURL: guild?.iconURL?.({ extension: "png", size: 128 }) || undefined,
        })
        .setTitle(`Top 10 Active Listeners — ${guildName}`)
        .setDescription(lines.join("\n"))
        .addFields({
            name: "Posisi Kamu",
            value: callerRank
                ? `**#${callerRank}** dari **${allRows.length}** pendengar (\`${formatHoursDecimal(callerEntry.totalListeningSeconds)} Jam\` • \`${callerEntry.totalPlays} Lagu\`)`
                : "Belum masuk peringkat — putar lagu di Voice Channel untuk mulai tercatat!",
            inline: false,
        })
        .setFooter({
            text: `666 Music Profile • Halaman ${safePage + 1}/${totalPages} • Server ID: ${guildId}`,
        })
        .setTimestamp();

    const files = [];
    const pngBuffer = await renderLeaderboardCard666({
        guildId,
        guildName,
        entries: enriched,
        page: safePage + 1,
        totalPages,
        callerRank,
        callerUsername,
    });

    if (pngBuffer) {
        const attachment = new AttachmentBuilder(pngBuffer, { name: "666-leaderboard.png" });
        files.push(attachment);
        embed.setImage("attachment://666-leaderboard.png");
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("lb666:prev")
            .setLabel("◀ Sebelumnya")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage <= 0),
        new ButtonBuilder()
            .setCustomId("lb666:page")
            .setLabel(`Halaman ${safePage + 1} / ${totalPages}`)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId("lb666:next")
            .setLabel("Berikutnya ▶")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage >= totalPages - 1),
    );

    return {
        embeds: [embed],
        files,
        components: [row],
        safePage,
        totalPages,
    };
}

/**
 * Builds the User Music Profile (`/profile`) payload.
 */
async function buildUserProfile666Payload(client, { guild, targetUser, targetMember = null }) {
    const guildId = String(guild?.id || "");
    const guildName = guild?.name || "Discord Server";
    const userId = String(targetUser?.id || "");
    const username = targetUser?.globalName || targetUser?.username || `User ${userId}`;
    const avatarUrl = targetUser?.displayAvatarURL?.({ extension: "png", size: 256 }) || null;

    const resolvedMember =
        targetMember || guild?.members?.cache?.get?.(userId) || (await guild?.members?.fetch?.(userId).catch(() => null));

    const joinServerText = formatJoinDate(resolvedMember?.joinedAt || resolvedMember?.joinedTimestamp || null);

    const leaderboard = await getGuildAggregatedLeaderboard(client, guildId);
    const userEntry = leaderboard.find((r) => r.userId === userId) || null;
    const unlockedIds = new Set([...(userEntry?.achievementIds || []), ...(await getUnlockedAchievementIds(client, guildId, userId))]);

    const totalPlays = userEntry?.totalPlays || 0;
    const totalSeconds = userEntry?.totalListeningSeconds || 0;
    const totalHoursText = formatHoursDecimal(totalSeconds);
    const activityRankText = userEntry?.rank ? `#${userEntry.rank}` : "Unranked";

    const fav = userEntry?.favoriteSong || null;
    const favoriteSongText = fav ? `${fav.title} — ${fav.author} (${fav.plays}x diputar)` : "Belum ada lagu yang diputar";

    const hasMusicLoverBadge = unlockedIds.has("music_lover") || totalSeconds >= 10 * 3600;
    const unlockedMeta = ACHIEVEMENTS_666.filter((a) => unlockedIds.has(a.id));

    const embed = new EmbedBuilder()
        .setColor(THEME_666.embedColor)
        .setAuthor({
            name: `666 • USER MUSIC PROFILE`,
            iconURL: avatarUrl || undefined,
        })
        .setTitle(`${username}`)
        .setThumbnail(avatarUrl)
        .addFields(
            { name: "👤 Username", value: `\`${username}\``, inline: true },
            { name: "🆔 User ID", value: `\`${userId}\``, inline: true },
            { name: "🏆 Activity Rank", value: `**${activityRankText}**`, inline: true },
            { name: "▶️ Total Play", value: `**${totalPlays}** Lagu`, inline: true },
            { name: "⏱️ Total Hours", value: `**${totalHoursText}** Jam`, inline: true },
            { name: "📅 Join Server", value: `\`${joinServerText}\``, inline: true },
            {
                name: "💜 Badge Music Lover",
                value: hasMusicLoverBadge ? "🟣 **Music Lover (Aktif)**" : "🔒 *Belum terbuka (Target: 10 Jam)*",
                inline: false,
            },
            { name: "🎵 Favorite Song", value: `\`${favoriteSongText}\``, inline: false },
            {
                name: `🏅 Achievements (${unlockedMeta.length}/${ACHIEVEMENTS_666.length})`,
                value:
                    unlockedMeta.length > 0
                        ? unlockedMeta.map((a) => `${a.icon} **${a.name}**`).join(" • ")
                        : "*Belum ada achievement terbuka*",
                inline: false,
            },
        )
        .setFooter({
            text: `666 Music Profile • ${guildName}`,
        })
        .setTimestamp();

    const files = [];
    const pngBuffer = await renderUserProfileCard666({
        guildId,
        guildName,
        userId,
        username,
        avatarUrl,
        totalPlays,
        totalHoursText,
        favoriteSong: favoriteSongText,
        joinServerText,
        activityRankText,
        hasMusicLoverBadge,
        badgeLabels: unlockedMeta.map((a) => a.name),
    });

    if (pngBuffer) {
        const attachment = new AttachmentBuilder(pngBuffer, { name: "666-profile.png" });
        files.push(attachment);
        embed.setImage("attachment://666-profile.png");
    }

    return {
        embeds: [embed],
        files,
    };
}

/**
 * Helper to inspect isolated per-bot user stats directly (useful for diagnostics & multi-bot verification).
 */
async function getIsolatedBotUserStats666(client, botApplicationId, guildId, userId) {
    const model = client?.profile666StatsData;
    if (!model || !isDbReady(model)) return null;
    const doc = await model
        .findOne({
            botApplicationId: String(botApplicationId),
            guildId: String(guildId),
            userId: String(userId),
        })
        .catch(() => null);
    return doc ? (typeof doc.toObject === "function" ? doc.toObject() : doc) : null;
}

module.exports = {
    ACHIEVEMENTS_666,
    onProfile666TrackStart,
    onProfile666Pause,
    onProfile666Resume,
    onProfile666Tick,
    onProfile666TrackEnd,
    getGuildAggregatedLeaderboard,
    getIsolatedBotUserStats666,
    buildLeaderboard666Payload,
    buildUserProfile666Payload,
    invalidateGuildLeaderboardCache,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
