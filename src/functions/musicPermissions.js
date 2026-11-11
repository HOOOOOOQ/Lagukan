const crypto = require("crypto");
const { PermissionsBitField } = require("discord.js");
const { normalizeGuildData, normalizeUserData, createDataGuild, createDataUser } = require("./createData.js");
const { cleanupStalePlayerIfDisconnected, clearManualDisconnect, getGuildPlayer } = require("./voiceSessionManager.js");
const { getAnyConnectedNode } = require("./nodeHealthManager.js");
const { serializeTrack } = require("./musicSourceResolver.js");
const Logger = require("../utils/logger");

const MAX_HISTORY_ITEMS = 50;
const MAX_FAVORITES_PER_USER = 100;
const MAX_PLAYLISTS_PER_OWNER = 25;
const MAX_TRACKS_PER_PLAYLIST = 300;

const guildPlayerCreationLocks = new Map();

function ensureGuildDataSync(client, guildOrId) {
    const guildId = typeof guildOrId === "string" ? guildOrId : guildOrId?.id;
    if (!guildId) return null;

    const gId = String(guildId);
    const guildObj = typeof guildOrId === "object" && guildOrId ? guildOrId : client?.guilds?.cache?.get?.(gId) || { id: gId };
    let data = client?.data?.get?.(`guildData_${gId}`);

    if (!data) {
        data = normalizeGuildData(client, guildObj, { id: gId });
        client?.data?.set?.(`guildData_${gId}`, data);
    } else if (!data.music) {
        data = normalizeGuildData(client, guildObj, data);
        client?.data?.set?.(`guildData_${gId}`, data);
    }

    return data;
}

function getGuildMusicSettings(client, guildOrId) {
    const data = ensureGuildDataSync(client, guildOrId);
    return (
        data?.music || {
            defaultVolume: client?.config?.defaultVolume || 100,
            autoplay: false,
            djMode: false,
            djRoleId: null,
            autoLeave: {
                enabled: true,
                timeout: client?.config?.leaveTimeout || 60000,
            },
        }
    );
}

async function updateGuildMusicSettings(client, guildOrId, patch = {}) {
    const guildId = typeof guildOrId === "string" ? guildOrId : guildOrId?.id;
    if (!guildId) return null;
    const gId = String(guildId);
    const guildObj = typeof guildOrId === "object" && guildOrId ? guildOrId : client?.guilds?.cache?.get?.(gId) || { id: gId };

    const existing = (await createDataGuild(client, guildObj)) || ensureGuildDataSync(client, guildObj);
    const mergedRaw = {
        ...existing,
        music: {
            ...(existing.music || {}),
            ...patch,
            autoLeave: {
                ...(existing.music?.autoLeave || {}),
                ...(patch.autoLeave || {}),
            },
        },
    };

    // Never allow @everyone role ID as DJ Role
    if (mergedRaw.music.djRoleId && String(mergedRaw.music.djRoleId) === gId) {
        mergedRaw.music.djRoleId = null;
    }

    const normalized = normalizeGuildData(client, guildObj, mergedRaw);
    client?.data?.set?.(`guildData_${gId}`, normalized);

    if (typeof client?.guildData?.findOneAndUpdate === "function") {
        await client.guildData
            .findOneAndUpdate({ id: gId }, { $set: { music: normalized.music } }, { upsert: true, returnDocument: "after" })
            .catch((err) => {
                Logger.debug(`[MusicSettings] Gagal menyimpan pengaturan musik guild (${gId}): ${err?.message || err}`);
            });
    }

    return normalized.music;
}

function isGuildAutoplayEnabled(client, guildId) {
    if (!guildId) return false;
    return Boolean(getGuildMusicSettings(client, String(guildId))?.autoplay);
}

async function setGuildAutoplay(client, guildOrId, enabled) {
    const updated = await updateGuildMusicSettings(client, guildOrId, { autoplay: Boolean(enabled) });
    return Boolean(updated?.autoplay);
}

function resolveMemberPerms(member, interactionOrMsg = null) {
    if (interactionOrMsg?.memberPermissions && typeof interactionOrMsg.memberPermissions.has === "function") {
        return interactionOrMsg.memberPermissions;
    }
    if (member?.permissions && typeof member.permissions.has === "function") {
        return member.permissions;
    }
    if (member?.permissions) {
        try {
            return new PermissionsBitField(BigInt(member.permissions));
        } catch {
            return null;
        }
    }
    return null;
}

function memberHasRole(member, roleId) {
    if (!member || !roleId) return false;
    if (member.roles?.cache && typeof member.roles.cache.has === "function") {
        return member.roles.cache.has(roleId);
    }
    if (Array.isArray(member._roles)) {
        return member._roles.includes(roleId);
    }
    if (Array.isArray(member.roles)) {
        return member.roles.includes(roleId);
    }
    return false;
}

/**
 * Evaluates whether a member is permitted to execute playback control actions under DJ Mode.
 */
function checkDjAccess(client, context = {}) {
    const { guild, member, user, player, track, allowRequester = false, interaction = null } = context;
    const guildId = String(guild?.id || player?.guildId || "");
    const userId = String(user?.id || member?.user?.id || member?.id || "");

    if (!guildId) return { allowed: true };

    if (Array.isArray(client?.config?.dev) && client.config.dev.includes(userId)) {
        return { allowed: true };
    }

    const settings = getGuildMusicSettings(client, guild || guildId);
    if (!settings.djMode) {
        return { allowed: true };
    }

    const perms = resolveMemberPerms(member, interaction);
    if (
        perms &&
        (perms.has(PermissionsBitField.Flags.Administrator) ||
            perms.has(PermissionsBitField.Flags.ManageGuild) ||
            perms.has(PermissionsBitField.Flags.ManageChannels))
    ) {
        return { allowed: true };
    }

    if (settings.djRoleId && memberHasRole(member, settings.djRoleId)) {
        return { allowed: true };
    }

    if (allowRequester && track?.requester?.id && String(track.requester.id) === userId) {
        return { allowed: true };
    }

    // Allow if the member is the sole human listener in the bot's voice channel
    const botVoiceChannel = guild?.members?.me?.voice?.channel || (player?.voiceId ? guild?.channels?.cache?.get?.(player.voiceId) : null);

    if (botVoiceChannel?.members) {
        const humans = botVoiceChannel.members.filter((m) => !m.user?.bot);
        if (humans.size === 1 && humans.has(userId)) {
            return { allowed: true };
        }
    }

    const roleHint = settings.djRoleId ? ` or the <@&${settings.djRoleId}> DJ role` : "";
    return {
        allowed: false,
        reason: `DJ Mode is active in this server. You need \`Manage Server\` permission${roleHint} to control playback.`,
    };
}

/**
 * Thread-safe single-player-per-guild getter/creator with node verification and per-guild defaultVolume.
 */
async function getOrCreateGuildPlayer(client, options = {}) {
    const { guild, voiceChannelId, textChannelId } = options;
    if (!guild?.id || !voiceChannelId) {
        throw new Error("Guild and voiceChannelId are required to create a music player.");
    }

    const gId = String(guild.id);
    if (guildPlayerCreationLocks.has(gId)) {
        return guildPlayerCreationLocks.get(gId);
    }

    const task = (async () => {
        const existing = await cleanupStalePlayerIfDisconnected(client, guild);
        if (existing) {
            if (textChannelId) existing.textId = textChannelId;
            return existing;
        }

        const connectedNode = getAnyConnectedNode(client);
        if (!connectedNode) {
            throw new Error("Lavalink music node is currently offline or reconnecting.");
        }

        await clearManualDisconnect(client, gId, guild);
        const musicSettings = getGuildMusicSettings(client, guild);

        const created = await client.rainlink.create({
            guildId: gId,
            textId: textChannelId,
            voiceId: voiceChannelId,
            shardId: guild.shardId ?? 0,
            volume: musicSettings.defaultVolume || client.config.defaultVolume || 100,
            deaf: true,
        });

        // Guard against duplicate entries: ensure RainlinkDatabase maps strictly 1 player for gId
        const registered = getGuildPlayer(client, gId) || created;
        return registered;
    })();

    guildPlayerCreationLocks.set(gId, task);
    try {
        return await task;
    } finally {
        guildPlayerCreationLocks.delete(gId);
    }
}

/**
 * Records a track in the guild's bounded playback history (memory + MongoDB).
 */
async function recordGuildTrackHistory(client, guildId, track) {
    if (!guildId || !track) return;
    const gId = String(guildId);
    const guildObj = client?.guilds?.cache?.get?.(gId) || { id: gId };
    const guildData = ensureGuildDataSync(client, guildObj);

    const entry = serializeTrack(track, {
        requesterId: track.requester?.id ? String(track.requester.id) : null,
        requesterTag: track.requester?.username || track.requester?.tag || null,
        playedAt: new Date(),
    });

    const currentHistory = Array.isArray(guildData.history) ? [...guildData.history] : [];
    const latest = currentHistory[0];

    // Avoid flooding history when a single song is on song-loop
    if (
        latest &&
        latest.uri === entry.uri &&
        latest.title === entry.title &&
        Date.now() - new Date(latest.playedAt || 0).getTime() < 15 * 60 * 1000
    ) {
        currentHistory[0] = entry;
    } else {
        currentHistory.unshift(entry);
    }

    guildData.history = currentHistory.slice(0, MAX_HISTORY_ITEMS);
    client?.data?.set?.(`guildData_${gId}`, guildData);

    if (typeof client?.guildData?.findOneAndUpdate === "function") {
        await client.guildData
            .findOneAndUpdate({ id: gId }, { $set: { history: guildData.history } }, { upsert: true, returnDocument: "after" })
            .catch((err) => {
                Logger.debug(`[History] Gagal menyimpan riwayat lagu guild (${gId}): ${err?.message || err}`);
            });
    }
}

async function getGuildTrackHistory(client, guild) {
    if (!guild?.id) return [];
    const gId = String(guild.id);
    const data = (await createDataGuild(client, guild)) || ensureGuildDataSync(client, guild);
    return Array.isArray(data?.history) ? data.history : [];
}

async function clearGuildTrackHistory(client, guild) {
    if (!guild?.id) return;
    const gId = String(guild.id);
    const data = ensureGuildDataSync(client, guild);
    data.history = [];
    client?.data?.set?.(`guildData_${gId}`, data);

    await client.guildData
        ?.findOneAndUpdate({ id: gId }, { $set: { history: [] } }, { upsert: true, returnDocument: "after" })
        .catch(() => {});
}

// ============================================================================
// Per-User Favorites Management
// ============================================================================

async function getUserFavorites(client, user) {
    if (!user?.id) return [];
    const uId = String(user.id);
    let userData = client?.data?.get?.(`userData_${uId}`);
    if (!userData || !Array.isArray(userData.favorites)) {
        const doc = await client?.userData?.findOne?.({ id: uId }).catch(() => null);
        userData = normalizeUserData(uId, doc ? doc.toObject() : userData || { id: uId });
        client?.data?.set?.(`userData_${uId}`, userData);
    }
    return userData.favorites;
}

function isSameTrackEntry(a, b) {
    if (!a || !b) return false;
    if (a.uri && b.uri && a.uri === b.uri) return true;
    if (a.identifier && b.identifier && a.identifier === b.identifier) return true;
    return (
        String(a.title || "").toLowerCase() === String(b.title || "").toLowerCase() &&
        String(a.author || "").toLowerCase() === String(b.author || "").toLowerCase()
    );
}

async function addUserFavorite(client, user, track) {
    if (!user?.id || !track) return { status: "invalid", favorites: [] };
    await createDataUser(client, user);
    const uId = String(user.id);
    const favorites = [...(await getUserFavorites(client, user))];
    const entry = serializeTrack(track, { addedAt: new Date() });

    if (favorites.some((item) => isSameTrackEntry(item, entry))) {
        return { status: "exists", favorites, entry };
    }

    if (favorites.length >= MAX_FAVORITES_PER_USER) {
        return { status: "limit", favorites, max: MAX_FAVORITES_PER_USER };
    }

    favorites.unshift(entry);
    const cached = normalizeUserData(uId, { ...(client.data.get(`userData_${uId}`) || { id: uId }), favorites });
    client.data.set(`userData_${uId}`, cached);

    await client.userData
        ?.findOneAndUpdate({ id: uId }, { $set: { favorites } }, { upsert: true, returnDocument: "after" })
        .catch((err) => {
            Logger.debug(`[Favorites] Gagal menyimpan favorit user (${uId}): ${err?.message || err}`);
        });

    return { status: "added", favorites, entry };
}

async function removeUserFavorite(client, user, oneBasedIndex) {
    const uId = String(user?.id || "");
    const favorites = [...(await getUserFavorites(client, user))];
    const idx = Number(oneBasedIndex) - 1;
    if (idx < 0 || idx >= favorites.length) {
        return { status: "out_of_range", favorites };
    }

    const [removed] = favorites.splice(idx, 1);
    const cached = normalizeUserData(uId, { ...(client.data.get(`userData_${uId}`) || { id: uId }), favorites });
    client.data.set(`userData_${uId}`, cached);

    await client.userData
        ?.findOneAndUpdate({ id: uId }, { $set: { favorites } }, { upsert: true, returnDocument: "after" })
        .catch(() => {});

    return { status: "removed", removed, favorites };
}

async function clearUserFavorites(client, user) {
    const uId = String(user?.id || "");
    const cached = normalizeUserData(uId, { ...(client.data.get(`userData_${uId}`) || { id: uId }), favorites: [] });
    client.data.set(`userData_${uId}`, cached);

    await client.userData
        ?.findOneAndUpdate({ id: uId }, { $set: { favorites: [] } }, { upsert: true, returnDocument: "after" })
        .catch(() => {});
}

// ============================================================================
// Personal & Server Playlists Management
// ============================================================================

function normalizePlaylistName(rawName) {
    const cleaned = String(rawName || "")
        .replace(/[\u0000-\u001F\u007F]/g, "")
        .trim()
        .replace(/\s+/g, " ");
    return {
        display: cleaned,
        normalized: cleaned.toLowerCase(),
    };
}

function canManageServerPlaylist(client, guild, member, user, interaction = null) {
    const perms = resolveMemberPerms(member, interaction);
    if (perms && (perms.has(PermissionsBitField.Flags.Administrator) || perms.has(PermissionsBitField.Flags.ManageGuild))) {
        return true;
    }

    const settings = getGuildMusicSettings(client, guild);
    if (settings.djRoleId && memberHasRole(member, settings.djRoleId)) {
        return true;
    }

    if (Array.isArray(client?.config?.dev) && client.config.dev.includes(String(user?.id || ""))) {
        return true;
    }

    return false;
}

async function createSavedPlaylist(client, { scope = "personal", name, description = "", userId, guildId }) {
    const { display, normalized } = normalizePlaylistName(name);
    if (!display || display.length > 50) {
        return { ok: false, error: "Playlist name must be between 1 and 50 characters." };
    }

    const filter = scope === "server" ? { scope: "server", guildId: String(guildId) } : { scope: "personal", ownerId: String(userId) };

    const count = await client.playlistData.countDocuments(filter);
    if (count >= MAX_PLAYLISTS_PER_OWNER) {
        return {
            ok: false,
            error: `Maximum playlist limit (${MAX_PLAYLISTS_PER_OWNER}) reached for ${scope === "server" ? "this server" : "your account"}.`,
        };
    }

    const existing = await client.playlistData.findOne({ ...filter, normalizedName: normalized });
    if (existing) {
        return { ok: false, error: `A ${scope} playlist named \`${existing.name}\` already exists.` };
    }

    const created = await client.playlistData.create({
        playlistId: crypto.randomUUID(),
        name: display,
        normalizedName: normalized,
        scope,
        ownerId: String(userId),
        guildId: scope === "server" ? String(guildId) : null,
        description: String(description || "")
            .trim()
            .slice(0, 150),
        tracks: [],
    });

    return { ok: true, playlist: created.toObject() };
}

async function listSavedPlaylists(client, { scope = "personal", userId, guildId }) {
    const filter = scope === "server" ? { scope: "server", guildId: String(guildId) } : { scope: "personal", ownerId: String(userId) };

    const query = client.playlistData.find(filter);
    const docs = typeof query?.sort === "function" ? await query.sort({ updatedAt: -1 }) : await Promise.resolve(query);

    if (!Array.isArray(docs)) return [];
    return docs.map((d) => (typeof d?.toObject === "function" ? d.toObject() : d));
}

async function getSavedPlaylist(client, { scope = "personal", name, userId, guildId }) {
    const { normalized } = normalizePlaylistName(name);
    if (!normalized) return null;

    const filter =
        scope === "server"
            ? { scope: "server", guildId: String(guildId), normalizedName: normalized }
            : { scope: "personal", ownerId: String(userId), normalizedName: normalized };

    const doc = await client.playlistData.findOne(filter);
    if (!doc) return null;
    return typeof doc.toObject === "function" ? doc.toObject() : doc;
}

async function addTracksToPlaylist(client, { scope = "personal", name, tracks = [], userId, guildId }) {
    const { normalized } = normalizePlaylistName(name);
    const filter =
        scope === "server"
            ? { scope: "server", guildId: String(guildId), normalizedName: normalized }
            : { scope: "personal", ownerId: String(userId), normalizedName: normalized };

    const doc = await client.playlistData.findOne(filter);
    if (!doc) {
        return { ok: false, error: `Playlist \`${name}\` was not found in ${scope} playlists.` };
    }

    const availableSlots = MAX_TRACKS_PER_PLAYLIST - doc.tracks.length;
    if (availableSlots <= 0) {
        return { ok: false, error: `Playlist \`${doc.name}\` is full (maximum ${MAX_TRACKS_PER_PLAYLIST} tracks).` };
    }

    const incoming = tracks.slice(0, availableSlots).map((t) =>
        serializeTrack(t, {
            addedBy: String(userId),
            addedAt: new Date(),
        }),
    );

    doc.tracks.push(...incoming);
    await doc.save();

    return {
        ok: true,
        playlist: doc.toObject(),
        addedCount: incoming.length,
        truncatedCount: Math.max(0, tracks.length - incoming.length),
    };
}

async function removeTrackFromPlaylist(client, { scope = "personal", name, position, userId, guildId }) {
    const { normalized } = normalizePlaylistName(name);
    const filter =
        scope === "server"
            ? { scope: "server", guildId: String(guildId), normalizedName: normalized }
            : { scope: "personal", ownerId: String(userId), normalizedName: normalized };

    const doc = await client.playlistData.findOne(filter);
    if (!doc) {
        return { ok: false, error: `Playlist \`${name}\` was not found.` };
    }

    const idx = Number(position) - 1;
    if (idx < 0 || idx >= doc.tracks.length) {
        return { ok: false, error: `Track position must be between 1 and ${doc.tracks.length || 1}.` };
    }

    const [removed] = doc.tracks.splice(idx, 1);
    await doc.save();
    return { ok: true, removed, playlist: doc.toObject() };
}

async function deleteSavedPlaylist(client, { scope = "personal", name, userId, guildId }) {
    const { normalized } = normalizePlaylistName(name);
    const filter =
        scope === "server"
            ? { scope: "server", guildId: String(guildId), normalizedName: normalized }
            : { scope: "personal", ownerId: String(userId), normalizedName: normalized };

    const deleted = await client.playlistData.findOneAndDelete(filter);
    if (!deleted) {
        return { ok: false, error: `Playlist \`${name}\` was not found.` };
    }
    return { ok: true, playlist: typeof deleted.toObject === "function" ? deleted.toObject() : deleted };
}

// ============================================================================
// Smart Autoplay & Similar Track Recommendation Engine
// ============================================================================

async function findAutoplayRecommendation(client, player) {
    if (!player) return null;

    const prevList = Array.isArray(player.queue?.previous) ? player.queue.previous : [];
    const guildData = ensureGuildDataSync(client, player.guildId);
    const historyList = Array.isArray(guildData?.history) ? guildData.history : [];

    const seedTrack = prevList[prevList.length - 1] || historyList[0] || null;
    if (!seedTrack) return null;

    const recentSeen = new Set();
    for (const item of [...prevList.slice(-15), ...historyList.slice(0, 15)]) {
        if (item?.identifier) recentSeen.add(String(item.identifier).toLowerCase());
        if (item?.uri) recentSeen.add(String(item.uri).toLowerCase());
        if (item?.title) recentSeen.add(String(item.title).toLowerCase().trim());
    }

    const isUnseen = (cand) => {
        if (!cand) return false;
        const id = String(cand.identifier || "").toLowerCase();
        const uri = String(cand.uri || "").toLowerCase();
        const title = String(cand.title || "")
            .toLowerCase()
            .trim();
        if (id && recentSeen.has(id)) return false;
        if (uri && recentSeen.has(uri)) return false;
        if (title && recentSeen.has(title)) return false;
        return true;
    };

    const requester = seedTrack.requester || client.user;
    const ytIdCandidate = /^[A-Za-z0-9_-]{11}$/.test(String(seedTrack.identifier || ""))
        ? seedTrack.identifier
        : (() => {
              const m = /[?&]v=([A-Za-z0-9_-]{11})/.exec(String(seedTrack.realUri || seedTrack.uri || ""));
              return m?.[1] || null;
          })();

    // 1. Try YouTube Music Radio Mix when we have a valid 11-char video identifier
    if (ytIdCandidate) {
        const mixUrl = `https://music.youtube.com/watch?v=${ytIdCandidate}&list=RD${ytIdCandidate}`;
        const mixRes = await client.rainlink.search(mixUrl, { requester }).catch(() => null);
        const candidates = (mixRes?.tracks || []).filter(isUnseen);
        if (candidates.length > 0) {
            const topPool = candidates.slice(0, Math.min(8, candidates.length));
            return topPool[Math.floor(Math.random() * topPool.length)];
        }
    }

    // 2. Fallback: Search similar songs by artist & title across YouTube Music -> SoundCloud
    const cleanAuthor = String(seedTrack.author || "")
        .replace(/ - Topic$/i, "")
        .trim();
    const cleanTitle = String(seedTrack.title || "").trim();
    const queries = [
        cleanAuthor && cleanAuthor !== "Unknown" ? `${cleanAuthor} popular songs` : null,
        cleanAuthor && cleanTitle ? `${cleanAuthor} ${cleanTitle}` : cleanTitle,
    ].filter(Boolean);

    for (const q of queries) {
        for (const engine of ["youtubeMusic", "youtube", "soundcloud"]) {
            const res = await client.rainlink.search(q, { requester, engine }).catch(() => null);
            const candidates = (res?.tracks || []).filter(isUnseen);
            if (candidates.length > 0) {
                const topPool = candidates.slice(0, Math.min(6, candidates.length));
                return topPool[Math.floor(Math.random() * topPool.length)];
            }
        }
    }

    return null;
}

module.exports = {
    MAX_HISTORY_ITEMS,
    MAX_FAVORITES_PER_USER,
    MAX_PLAYLISTS_PER_OWNER,
    MAX_TRACKS_PER_PLAYLIST,
    ensureGuildDataSync,
    getGuildMusicSettings,
    updateGuildMusicSettings,
    isGuildAutoplayEnabled,
    setGuildAutoplay,
    checkDjAccess,
    getOrCreateGuildPlayer,
    recordGuildTrackHistory,
    getGuildTrackHistory,
    clearGuildTrackHistory,
    getUserFavorites,
    addUserFavorite,
    removeUserFavorite,
    clearUserFavorites,
    canManageServerPlaylist,
    createSavedPlaylist,
    listSavedPlaylists,
    getSavedPlaylist,
    addTracksToPlaylist,
    removeTrackFromPlaylist,
    deleteSavedPlaylist,
    findAutoplayRecommendation,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
