const { EmbedBuilder } = require("discord.js");
const { smartSearch, serializeTrack, hydrateStoredTrack } = require("./musicSourceResolver.js");
const { PLAYER_STATE_DESTROYED, performManualLeave, getGuildPlayer, isGuildManuallyDisconnected } = require("./voiceSessionManager.js");
const { isPlayerActivelyPlayingOrPausedTrack, startPlayerIfIdle, findAutoplayRecommendation } = require("./musicPermissions.js");
const { cleanupNowPlayingMessage, refreshNowPlayingDashboard } = require("./nowPlayingManager.js");

const RADIO_STATIONS = {
    indonesian_pop: {
        id: "indonesian_pop",
        label: "🇮🇩 Pop & Indie Indonesia",
        genre: "Indonesian Pop",
        seeds: [
            "Kunto Aji Teh Hijau",
            "HIVI! Remaja",
            "Hindia Secukupnya",
            "Sheila On 7 Dan",
            "Payung Teduh Resah",
            "Tulus Hati-Hati di Jalan",
            "Nadin Amizah Bertaut",
            "Pamungkas To The Bone",
            "Juicy Luicy Lantas",
            "Fiersa Besari Celengan Rindu",
        ],
    },
    lofi_chill: {
        id: "lofi_chill",
        label: "☕ Lo-Fi & Chill Beats",
        genre: "Lo-Fi Chill",
        seeds: [
            "lofi hip hop chill beats to relax",
            "chillhop essentials instrumental",
            "cozy rainy night lofi",
            "late night coding lofi beats",
            "jazzy lofi coffee shop",
        ],
    },
    global_pop: {
        id: "global_pop",
        label: "🌍 Global Pop Hits",
        genre: "Pop",
        seeds: [
            "The Weeknd Blinding Lights",
            "Dua Lipa Levitating",
            "Bruno Mars Leave The Door Open",
            "Coldplay Yellow",
            "Billie Eilish Birds of a Feather",
            "Taylor Swift Anti-Hero",
        ],
    },
    rock_alt: {
        id: "rock_alt",
        label: "🎸 Rock & Alternative",
        genre: "Rock",
        seeds: [
            "Linkin Park In The End",
            "Arctic Monkeys Do I Wanna Know",
            "Green Day Boulevard of Broken Dreams",
            "Queen Bohemian Rhapsody",
            "Muse Starlight",
            "Dewa 19 Kangen",
        ],
    },
    edm_electronic: {
        id: "edm_electronic",
        label: "⚡ EDM & Electronic",
        genre: "Electronic",
        seeds: [
            "Avicii Levels",
            "Calvin Harris Summer",
            "Zedd Clarity",
            "Martin Garrix High On Life",
            "Alan Walker Faded",
            "Kygo Firestone",
        ],
    },
    hiphop_rnb: {
        id: "hiphop_rnb",
        label: "🎤 Hip-Hop & R&B",
        genre: "R&B / Hip-Hop",
        seeds: [
            "SZA Snooze",
            "Daniel Caesar Best Part",
            "Kendrick Lamar Luther",
            "Post Malone Sunflower",
            "Frank Ocean Pink + White",
            "Joji Glimpse of Us",
        ],
    },
    acoustic_jazz: {
        id: "acoustic_jazz",
        label: "🎷 Acoustic & Jazz",
        genre: "Jazz / Acoustic",
        seeds: [
            "Laufey From The Start",
            "Norah Jones Don't Know Why",
            "John Mayer Gravity",
            "Maliq & D'Essentials Untitled",
            "Ardhito Pramono Bitterlove",
        ],
    },
    anime_jpop: {
        id: "anime_jpop",
        label: "🌸 Anime & J-Pop",
        genre: "J-Pop",
        seeds: [
            "YOASOBI Idol",
            "Kenshi Yonezu Kick Back",
            "Official HIGE DANdism Pretender",
            "Fujii Kaze Shinunoga E-Wa",
            "Radwimps Sparkle",
            "LiSA Gurenge",
        ],
    },
};

// Map<guildId, { timer, endsAt, durationMinutes, clearQueue, leaveVoice, textChannelId, requestedBy }>
const guildSleepTimers = new Map();

// Map<guildId, { enabled, mode: "radio"|"autodj", stationId, customQuery, label, genre, recentKeys: string[], seedCursor: number }>
const guildRadioStates = new Map();

// Map<guildId, { savedAt, voiceId, textId, currentTrack, upcomingTracks, position, volume, loop }>
const autoResumeSnapshots = new Map();

function cancelGuildSleepTimer(guildId) {
    if (!guildId) return false;
    const gid = String(guildId);
    const existing = guildSleepTimers.get(gid);
    if (!existing) return false;
    if (existing.timer) clearTimeout(existing.timer);
    guildSleepTimers.delete(gid);
    return true;
}

function getGuildSleepTimer(guildId) {
    if (!guildId) return null;
    const gid = String(guildId);
    const entry = guildSleepTimers.get(gid);
    if (!entry) return null;
    if (Date.now() >= entry.endsAt) {
        cancelGuildSleepTimer(gid);
        return null;
    }
    return {
        ...entry,
        remainingMs: Math.max(0, entry.endsAt - Date.now()),
    };
}

function setGuildSleepTimer(
    client,
    { guildId, durationMinutes, clearQueue = true, leaveVoice = false, textChannelId = null, requestedBy = null },
) {
    const gid = String(guildId);
    cancelGuildSleepTimer(gid);

    const mins = Math.max(0.01, Math.min(Number(durationMinutes || 15), 720));
    const durationMs = Math.round(mins * 60 * 1000);
    const endsAt = Date.now() + durationMs;

    const timer = setTimeout(() => {
        guildSleepTimers.delete(gid);
        void (async () => {
            stopGuildRadioMode(gid);
            const player = getGuildPlayer(client, gid);
            const notifyChannelId = textChannelId || player?.textId;
            const channel = notifyChannelId ? client.channels?.cache?.get?.(notifyChannelId) : null;

            if (player && player.state !== PLAYER_STATE_DESTROYED) {
                player._manualStopAt = Date.now();
                await cleanupNowPlayingMessage(player, true);
                if (clearQueue) {
                    player.queue?.clear?.();
                    player.data?.set?.("shuffled", false);
                }

                if (leaveVoice) {
                    const guildObj = client.guilds?.cache?.get?.(gid) || { id: gid };
                    await performManualLeave(client, guildObj, player).catch(() => {});
                } else {
                    await Promise.resolve(player.stop()).catch(() => {});
                }
            }

            if (channel && typeof channel.send === "function") {
                const embed = new EmbedBuilder()
                    .setColor(client.config?.embedColor || "#5865F2")
                    .setTitle("😴 Sleep Timer Selesai")
                    .setDescription(
                        `Waktu Sleep Timer telah habis. Pemutaran musik telah dihentikan` +
                            `${clearQueue ? ", antrean dibersihkan" : ""}` +
                            `${leaveVoice ? ", dan bot keluar dari voice channel." : "."}`,
                    )
                    .setTimestamp();
                await channel.send({ embeds: [embed] }).catch(() => {});
            }
        })().catch(() => {});
    }, durationMs);

    if (typeof timer.unref === "function") timer.unref();

    const meta = {
        guildId: gid,
        timer,
        endsAt,
        durationMinutes: mins,
        clearQueue: Boolean(clearQueue),
        leaveVoice: Boolean(leaveVoice),
        textChannelId,
        requestedBy,
    };
    guildSleepTimers.set(gid, meta);
    return meta;
}

function getGuildRadioState(guildId) {
    if (!guildId) return null;
    const state = guildRadioStates.get(String(guildId));
    return state?.enabled ? state : null;
}

function stopGuildRadioMode(guildId) {
    if (!guildId) return false;
    const gid = String(guildId);
    const had = guildRadioStates.has(gid);
    guildRadioStates.delete(gid);
    return had;
}

function buildTrackDedupKey(track) {
    if (!track) return "";
    if (track.identifier) return String(track.identifier).toLowerCase();
    return `${String(track.title || "")
        .toLowerCase()
        .trim()}::${String(track.author || "")
        .toLowerCase()
        .trim()}`;
}

function isSuitableRadioCandidate(track, recentKeysSet) {
    if (!track) return false;
    const hasAudio = Boolean(track.encoded) || typeof track.resolver === "function";
    if (!hasAudio) return false;
    const key = buildTrackDedupKey(track);
    if (key && recentKeysSet.has(key)) return false;
    const dur = Number(track.duration || 0);
    if (dur > 20 * 60 * 1000) return false;
    if (/\b(1\s*hour|10\s*hour|karaoke|instrumental\s*loop)\b/i.test(String(track.title || ""))) return false;
    return true;
}

async function fetchNextStationTrack(client, state, requester) {
    const recentSet = new Set(state.recentKeys || []);
    const station = RADIO_STATIONS[state.stationId] || null;
    const seedPool = station ? station.seeds : [state.customQuery || "Indonesian Pop Hits"];

    for (let attempt = 0; attempt < seedPool.length; attempt++) {
        const seed = seedPool[(state.seedCursor + attempt) % seedPool.length];
        const res = await smartSearch(client, seed, { requester: requester || client.user }).catch(() => null);
        const candidates = (res?.tracks || []).filter((t) => isSuitableRadioCandidate(t, recentSet));
        if (candidates.length > 0) {
            state.seedCursor = (state.seedCursor + attempt + 1) % seedPool.length;
            const picked = candidates[0];
            if (state.genre) {
                picked.pluginInfo = { ...(picked.pluginInfo || {}), genre: state.genre };
            }
            const k = buildTrackDedupKey(picked);
            if (k) {
                state.recentKeys.push(k);
                if (state.recentKeys.length > 30) state.recentKeys.shift();
            }
            return picked;
        }
    }
    return null;
}

async function startGuildRadioMode(
    client,
    player,
    { mode = "radio", stationId = "indonesian_pop", customQuery = null, requester = null } = {},
) {
    if (!player?.guildId) return { ok: false, error: "Player tidak tersedia." };
    player._manualStopAt = 0;
    const gid = String(player.guildId);
    const station = stationId === "custom" ? null : RADIO_STATIONS[stationId] || RADIO_STATIONS.indonesian_pop;

    const state = {
        enabled: true,
        mode: mode === "autodj" ? "autodj" : "radio",
        stationId: station ? station.id : "custom",
        customQuery: customQuery ? String(customQuery).trim() : null,
        label: mode === "autodj" ? "🎧 Smart Auto DJ" : station ? station.label : `📻 Custom Radio: ${customQuery}`,
        genre: station?.genre || (customQuery ? String(customQuery).slice(0, 32) : null),
        recentKeys: [],
        seedCursor: 0,
    };

    if (player.queue?.current) {
        const curKey = buildTrackDedupKey(player.queue.current);
        if (curKey) state.recentKeys.push(curKey);
    }

    guildRadioStates.set(gid, state);

    // Ensure at least 2 verified tracks are queued immediately for Radio Mode
    let addedCount = 0;
    if (state.mode === "radio") {
        for (let i = 0; i < 2; i++) {
            const next = await fetchNextStationTrack(client, state, requester || client.user);
            if (next) {
                player.queue.add(next);
                addedCount += 1;
            }
        }

        if (!isPlayerActivelyPlayingOrPausedTrack(player) && (player.queue.current || player.queue.size > 0)) {
            const startRes = await startPlayerIfIdle(client, player, {
                waitForTrackStart: true,
                timeoutMs: 6000,
                userId: requester?.id,
                command: "radio",
            });
            if (!startRes.ok) {
                stopGuildRadioMode(gid);
                return { ok: false, error: startRes.error || "Gagal memulai audio Radio Mode." };
            }
        } else {
            await refreshNowPlayingDashboard(client, player).catch(() => {});
        }
    }

    return { ok: true, state, addedCount };
}

/**
 * Called by queueEmpty when Radio Mode or Auto DJ is active on a guild.
 */
async function pickNextRadioOrAutoDjTrack(client, player) {
    if (!player?.guildId) return null;
    const state = getGuildRadioState(player.guildId);
    if (!state) return null;

    if (state.mode === "radio") {
        return fetchNextStationTrack(client, state, client.user);
    }

    // Auto DJ mode: match last track's artist & genre while avoiding recent repeats
    const recentSet = new Set(state.recentKeys || []);
    const autoCandidate = await findAutoplayRecommendation(client, player);
    if (autoCandidate && isSuitableRadioCandidate(autoCandidate, recentSet)) {
        const k = buildTrackDedupKey(autoCandidate);
        if (k) {
            state.recentKeys.push(k);
            if (state.recentKeys.length > 30) state.recentKeys.shift();
        }
        return autoCandidate;
    }

    return fetchNextStationTrack(client, state, client.user);
}

function saveAutoResumeSnapshot(player) {
    if (!player?.guildId || !player.queue?.current) return;
    const gid = String(player.guildId);
    autoResumeSnapshots.set(gid, {
        savedAt: Date.now(),
        voiceId: player.voiceId,
        textId: player.textId,
        currentTrack: serializeTrack(player.queue.current),
        upcomingTracks: Array.isArray(player.queue) ? player.queue.slice(0, 30).map((t) => serializeTrack(t)) : [],
        position: Number(player.position || 0),
        volume: Number(player.volume || 100),
        loop: player.loop || "none",
    });
}

function clearAutoResumeSnapshot(guildId) {
    if (!guildId) return;
    autoResumeSnapshots.delete(String(guildId));
}

async function tryAutoResumeGuildPlayback(client, player) {
    if (!player?.guildId || isGuildManuallyDisconnected(client, player.guildId)) return false;
    const gid = String(player.guildId);
    const snap = autoResumeSnapshots.get(gid);
    if (!snap || Date.now() - snap.savedAt > 30 * 60 * 1000) return false;
    if (isPlayerActivelyPlayingOrPausedTrack(player)) return false;

    const currentHydrated = snap.currentTrack ? hydrateStoredTrack(client, snap.currentTrack, client.user) : null;
    if (!currentHydrated) return false;

    player.queue.add(currentHydrated);
    for (const item of snap.upcomingTracks || []) {
        const h = hydrateStoredTrack(client, item, client.user);
        if (h) player.queue.add(h);
    }
    if (snap.loop && snap.loop !== "none") {
        player.setLoop(snap.loop);
    }

    const res = await startPlayerIfIdle(client, player, {
        waitForTrackStart: false,
        command: "autoResume",
    });
    return Boolean(res.ok);
}

module.exports = {
    RADIO_STATIONS,
    setGuildSleepTimer,
    cancelGuildSleepTimer,
    getGuildSleepTimer,
    startGuildRadioMode,
    stopGuildRadioMode,
    getGuildRadioState,
    pickNextRadioOrAutoDjTrack,
    saveAutoResumeSnapshot,
    clearAutoResumeSnapshot,
    tryAutoResumeGuildPlayback,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
