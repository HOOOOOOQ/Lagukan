const mongoose = require("mongoose");
const { ChannelType, PermissionsBitField } = require("discord.js");
const { isCloudDatabaseReady } = require("../databases/cloudAdapter.js");
const {
    hasActiveGuildPlayer,
    prepareGuildForReconnect,
    isGuildManuallyDisconnected,
    isGuildLeavingInProgress,
    clearManualDisconnect,
} = require("./voiceSessionManager.js");
const { selectHealthyNode, getAnyConnectedNode, waitForNodeSessionReady } = require("./nodeHealthManager.js");
const { getGuildMusicSettings } = require("./musicPermissions.js");
const { openOrSyncVoiceSession666 } = require("./profileNotificationManager.js");
const Logger = require("../utils/logger");

// Bounded exponential backoff delays (ms) — prevents infinite reconnect loops!
const BACKOFF_DELAYS_MS = Object.freeze([1500, 4000, 9000, 18000, 35000]);
const MAX_BACKOFF_ATTEMPTS = BACKOFF_DELAYS_MS.length;

function isDbReady(model) {
    if (isCloudDatabaseReady()) return true;
    if (model?.db && typeof model.db.readyState === "number") {
        return model.db.readyState === 1;
    }
    if (mongoose.connection.readyState === 1) return true;
    if (model && !model.db) return true;
    return false;
}

function getBotId(client) {
    return String(client?.user?.id || client?.application?.id || "").trim();
}

function ensureClientAuto247State(client) {
    if (!client._auto247Cache || !(client._auto247Cache instanceof Map)) {
        client._auto247Cache = new Map();
    }
    if (!client._auto247Timers || !(client._auto247Timers instanceof Map)) {
        client._auto247Timers = new Map();
    }
    if (!client._auto247Attempts || !(client._auto247Attempts instanceof Map)) {
        client._auto247Attempts = new Map();
    }
    if (!client._auto247Locks || !(client._auto247Locks instanceof Set)) {
        client._auto247Locks = new Set();
    }
    return {
        cache: client._auto247Cache,
        timers: client._auto247Timers,
        attempts: client._auto247Attempts,
        locks: client._auto247Locks,
    };
}

function verifyVoiceChannelPermissions(guild, voiceChannel) {
    if (!guild || !voiceChannel) {
        return { valid: false, reason: "Voice channel tidak ditemukan di server." };
    }
    const isVoiceType = voiceChannel.type === ChannelType.GuildVoice || voiceChannel.type === ChannelType.GuildStageVoice;
    if (!isVoiceType) {
        return { valid: false, reason: "Channel yang dipilih bukan Voice Channel atau Stage Channel." };
    }

    const me = guild.members?.me;
    if (me && typeof voiceChannel.permissionsFor === "function") {
        const perms = voiceChannel.permissionsFor(me);
        if (!perms) {
            return { valid: false, reason: "Tidak dapat memeriksa izin bot pada voice channel tersebut." };
        }
        const missing = [];
        if (!perms.has(PermissionsBitField.Flags.ViewChannel)) missing.push("ViewChannel");
        if (!perms.has(PermissionsBitField.Flags.Connect)) missing.push("Connect");
        if (!perms.has(PermissionsBitField.Flags.Speak)) missing.push("Speak");
        if (missing.length > 0) {
            return { valid: false, reason: `Bot kekurangan izin voice channel: ${missing.join(", ")}` };
        }
    }

    return { valid: true, reason: "ok" };
}

function pickFallbackTextChannelId(guild, voiceChannel) {
    if (voiceChannel && typeof voiceChannel.send === "function") {
        return voiceChannel.id;
    }
    if (guild?.systemChannelId) return guild.systemChannelId;
    const firstText = guild?.channels?.cache?.find?.((ch) => ch.type === ChannelType.GuildText);
    return firstText?.id || voiceChannel?.id || null;
}

async function getAuto247Config(client, guildId) {
    const botApplicationId = getBotId(client);
    const gId = String(guildId || "");
    if (!botApplicationId || !gId) return null;

    const { cache } = ensureClientAuto247State(client);
    if (cache.has(gId)) {
        return cache.get(gId);
    }

    const model = client?.auto247ConfigData;
    if (!model || !isDbReady(model)) return null;

    const doc = await model
        .findOne({
            botApplicationId,
            guildId: gId,
        })
        .catch(() => null);

    const plain = doc ? (typeof doc.toObject === "function" ? doc.toObject() : { ...doc }) : null;
    cache.set(gId, plain);
    return plain;
}

function isAuto247EnabledCached(client, guildId) {
    const gId = String(guildId || "");
    if (!gId) return false;
    const { cache } = ensureClientAuto247State(client);
    const cfg = cache.get(gId);
    return Boolean(cfg && cfg.enabled && cfg.botApplicationId === getBotId(client));
}

function cancelAuto247Timer(client, guildId) {
    const gId = String(guildId || "");
    if (!gId) return;
    const { timers } = ensureClientAuto247State(client);
    const existing = timers.get(gId);
    if (existing) {
        clearTimeout(existing);
        timers.delete(gId);
    }
}

async function upsertAuto247Config(client, { guildId, voiceChannelId, enabled = true, autoReconnect = true, updatedBy = null }) {
    const botApplicationId = getBotId(client);
    const gId = String(guildId || "");
    if (!botApplicationId || !gId || !voiceChannelId) return null;

    const payload = {
        botApplicationId,
        guildId: gId,
        voiceChannelId: String(voiceChannelId),
        enabled: Boolean(enabled),
        autoReconnect: Boolean(autoReconnect),
        updatedBy: updatedBy ? String(updatedBy) : null,
    };

    const { cache, attempts } = ensureClientAuto247State(client);
    cache.set(gId, payload);
    attempts.delete(gId);

    if (!payload.enabled) {
        cancelAuto247Timer(client, gId);
    }

    const model = client?.auto247ConfigData;
    if (model && isDbReady(model)) {
        await model
            .findOneAndUpdate({ botApplicationId, guildId: gId }, { $set: payload }, { upsert: true, returnDocument: "after" })
            .catch((err) => {
                Logger.warn(`[Auto247] Gagal menyimpan Auto247Config (${botApplicationId}/${gId}): ${err?.message || err}`);
            });
    }

    return payload;
}

/**
 * Connects THIS bot (`client.user.id`) to its configured 24/7 voice channel in `guildId`.
 * - Never interrupts an already-playing Rainlink player.
 * - Never creates duplicate voice connections.
 * - Strictly isolated per `(botApplicationId, guildId)`.
 */
async function connectAuto247Unlocked(client, guildId, { explicitNode = null, forceMove = false } = {}) {
    const botApplicationId = getBotId(client);
    const gId = String(guildId || "");
    if (!botApplicationId || !gId) {
        return { connected: false, reason: "invalid_identity" };
    }

    const { attempts } = ensureClientAuto247State(client);

    const config = await getAuto247Config(client, gId);
    if (!config || !config.enabled) {
        return { connected: false, reason: "disabled_or_unconfigured" };
    }

    // Strict bot ownership check: never connect using another bot's config!
    if (String(config.botApplicationId) !== botApplicationId || String(config.guildId) !== gId) {
        return { connected: false, reason: "ownership_mismatch" };
    }

    if (isGuildLeavingInProgress(gId, client)) {
        return { connected: false, reason: "manual_leave_in_progress" };
    }

    const guild = client?.guilds?.cache?.get?.(gId);
    if (!guild) {
        return { connected: false, reason: "guild_not_cached" };
    }

    const voiceChannel = guild.channels?.cache?.get?.(String(config.voiceChannelId));
    const permCheck = verifyVoiceChannelPermissions(guild, voiceChannel);
    if (!permCheck.valid) {
        Logger.warn(`[Auto247] Bot ${botApplicationId} batal join 24/7 di guild ${gId}: ${permCheck.reason}`);
        return { connected: false, reason: permCheck.reason };
    }

    // Protect active playback & prevent duplicate connections!
    const existingPlayer = client?.rainlink?.players?.get?.(gId) || null;
    if (existingPlayer && hasActiveGuildPlayer(client, gId)) {
        if (String(existingPlayer.voiceId) === String(voiceChannel.id)) {
            attempts.delete(gId);
            await openOrSyncVoiceSession666(client, existingPlayer);
            return { connected: true, alreadyConnected: true, player: existingPlayer, voiceChannelId: voiceChannel.id };
        }
        // Never disrupt an actively playing track unless explicitly forced while idle
        if (existingPlayer.playing || existingPlayer.queue?.current || !forceMove) {
            return { connected: true, alreadyConnected: true, reason: "active_player_protected", player: existingPlayer };
        }
    }

    try {
        if (forceMove && existingPlayer && String(existingPlayer.voiceId) !== String(voiceChannel.id)) {
            await Promise.resolve(existingPlayer.destroy()).catch(() => {});
            client?.rainlink?.players?.delete?.(gId);
        }

        const readyToCreate = await prepareGuildForReconnect(client, gId);
        if (!readyToCreate) {
            const activeNow = client?.rainlink?.players?.get?.(gId);
            return { connected: true, alreadyConnected: true, player: activeNow };
        }

        // Verify Lavalink node readiness (if nodes are configured)
        const nodes = client?.rainlink?.nodes?.all?.() || [];
        const targetNode = explicitNode || (await selectHealthyNode(nodes)) || getAnyConnectedNode(client) || null;
        if (targetNode) {
            const nodeReady = await waitForNodeSessionReady(targetNode, 4000);
            if (!nodeReady) {
                return { connected: false, reason: "lavalink_node_not_ready" };
            }
        } else if (typeof client?.rainlink?.nodes?.all === "function" && client.rainlink.nodes.all().length > 0) {
            // Real Rainlink instance whose Lavalink node hasn't connected yet -> nodeConnect will trigger join
            return { connected: false, reason: "waiting_for_lavalink_node" };
        }

        const musicSettings = getGuildMusicSettings(client, guild);
        const textChannelId = pickFallbackTextChannelId(guild, voiceChannel);

        const createdPlayer = await client.rainlink.create({
            guildId: guild.id,
            voiceId: voiceChannel.id,
            textId: textChannelId,
            shardId: guild.shardId ?? client?.ws?.shards?.first?.()?.id ?? 0,
            volume: musicSettings?.defaultVolume || client.config?.defaultVolume || 100,
            deaf: true,
        });

        if (!createdPlayer) return { connected: false, reason: "create_player_failed" };
        attempts.delete(gId);
        cancelAuto247Timer(client, gId);
        await openOrSyncVoiceSession666(client, createdPlayer);

        Logger.info(
            `[Auto247] Bot ${client.user?.username || botApplicationId} terhubung otomatis ke VC ${voiceChannel.name} (${voiceChannel.id}) di ${guild.name}`,
        );
        return {
            connected: true,
            alreadyConnected: false,
            player: createdPlayer,
            voiceChannelId: voiceChannel.id,
        };
    } catch (err) {
        Logger.warn(`[Auto247] Gagal menyambungkan bot ${botApplicationId} ke VC ${voiceChannel.id} (${gId}): ${err?.message || err}`);
        return { connected: false, reason: err?.message || "create_player_failed" };
    }
}

async function ensureBotAuto247Connected(client, guildId, options = {}) {
    const { locks } = ensureClientAuto247State(client);
    const key = String(guildId || "");
    if (locks.has(key)) return { connected: false, reason: "connect_in_progress" };
    locks.add(key);
    try {
        return await connectAuto247Unlocked(client, guildId, options);
    } finally {
        locks.delete(key);
    }
}

// Optional per-process provisioning. Existing database configs remain untouched when unset.
async function provisionAuto247FromEnvironment(client) {
    const raw = process.env.AUTO247_CHANNELS;
    const botApplicationId = getBotId(client);
    if (!raw || !botApplicationId || !isDbReady(client?.auto247ConfigData)) return;
    let entries;
    try {
        entries = JSON.parse(raw);
    } catch {
        Logger.warn("[Auto247] AUTO247_CHANNELS must be a JSON object of guild IDs to voice channel IDs.");
        return;
    }
    if (!entries || Array.isArray(entries) || typeof entries !== "object") return;
    for (const [guildId, value] of Object.entries(entries)) {
        const voiceChannelId = typeof value === "string" ? value : value?.voiceChannelId;
        if (!/^\d{5,22}$/.test(guildId) || !/^\d{5,22}$/.test(String(voiceChannelId || ""))) {
            Logger.warn("[Auto247] Invalid guild or voice channel ID in AUTO247_CHANNELS; entry skipped.");
            continue;
        }
        // A shard may only operate on guilds it owns.
        if (!client.guilds?.cache?.has?.(guildId)) continue;
        await upsertAuto247Config(client, { guildId, voiceChannelId, enabled: true, autoReconnect: true });
    }
}

/**
 * Automatically loads all enabled 24/7 voice channel configs for THIS `botApplicationId` on startup
 * or Lavalink node connect, connecting each configured guild cleanly without waiting for user commands.
 */
async function syncAllAuto247OnStartup(client, explicitNode = null) {
    const botApplicationId = getBotId(client);
    const model = client?.auto247ConfigData;
    if (!botApplicationId || !model || !isDbReady(model)) return [];

    await provisionAuto247FromEnvironment(client);

    const docs =
        (await model
            .find({
                botApplicationId,
                enabled: true,
            })
            .catch(() => [])) || [];

    const { cache } = ensureClientAuto247State(client);
    const results = [];

    for (let i = 0; i < docs.length; i++) {
        const plain = typeof docs[i].toObject === "function" ? docs[i].toObject() : { ...docs[i] };
        if (String(plain.botApplicationId) !== botApplicationId || !plain.guildId) continue;

        cache.set(String(plain.guildId), plain);
        await clearManualDisconnect(client, plain.guildId).catch(() => {});

        if (i > 0) {
            await new Promise((resolve) => setTimeout(resolve, 200));
        }

        const res = await ensureBotAuto247Connected(client, plain.guildId, { explicitNode });
        results.push({ guildId: plain.guildId, ...res });
        if (!res.connected && res.reason !== "waiting_for_lavalink_node" && res.reason !== "connect_in_progress") {
            await scheduleAuto247Reconnect(client, plain.guildId, "startup");
        }
    }

    return results;
}

/**
 * Schedules bounded, staged auto-reconnect when THIS bot is unexpectedly disconnected
 * from its configured 24/7 voice channel. Never loops infinitely!
 */
async function scheduleAuto247Reconnect(client, guildId, reason = "unexpected_disconnect", customBaseDelayMs = null) {
    const botApplicationId = getBotId(client);
    const gId = String(guildId || "");
    if (!botApplicationId || !gId) return { scheduled: false, reason: "invalid_identity" };

    if (isGuildManuallyDisconnected(client, gId) || isGuildLeavingInProgress(gId, client)) {
        return { scheduled: false, reason: "manual_disconnect" };
    }

    const config = await getAuto247Config(client, gId);
    if (!config || !config.enabled || config.autoReconnect === false) {
        return { scheduled: false, reason: "auto_reconnect_disabled" };
    }

    const { timers, attempts } = ensureClientAuto247State(client);
    if (timers.has(gId)) {
        return { scheduled: false, reason: "reconnect_already_scheduled" };
    }

    const attemptIndex = attempts.get(gId) || 0;
    if (attemptIndex >= MAX_BACKOFF_ATTEMPTS) {
        Logger.warn(
            `[Auto247] Batas maksimum percobaan reconnect (${MAX_BACKOFF_ATTEMPTS}x) tercapai untuk bot ${botApplicationId} di guild ${gId}.`,
        );
        return { scheduled: false, reason: "max_backoff_reached" };
    }

    const delayMs = typeof customBaseDelayMs === "number" && customBaseDelayMs >= 0 ? customBaseDelayMs : BACKOFF_DELAYS_MS[attemptIndex];

    attempts.set(gId, attemptIndex + 1);

    const timer = setTimeout(() => {
        timers.delete(gId);
        void (async () => {
            const latest = await getAuto247Config(client, gId);
            if (!latest || !latest.enabled || latest.autoReconnect === false) return;
            if (isGuildManuallyDisconnected(client, gId) || isGuildLeavingInProgress(gId, client)) return;

            const outcome = await ensureBotAuto247Connected(client, gId);
            if (!outcome.connected && outcome.reason !== "waiting_for_lavalink_node") {
                await scheduleAuto247Reconnect(client, gId, `retry_after_${reason}`);
            }
        })().catch((err) => {
            Logger.debug(`[Auto247] Error saat percobaan reconnect (${botApplicationId}/${gId}): ${err?.message || err}`);
        });
    }, delayMs);

    if (typeof timer.unref === "function") {
        timer.unref();
    }

    timers.set(gId, timer);
    return { scheduled: true, attempt: attemptIndex + 1, delayMs };
}

module.exports = {
    BACKOFF_DELAYS_MS,
    MAX_BACKOFF_ATTEMPTS,
    verifyVoiceChannelPermissions,
    getAuto247Config,
    isAuto247EnabledCached,
    upsertAuto247Config,
    cancelAuto247Timer,
    ensureBotAuto247Connected,
    syncAllAuto247OnStartup,
    scheduleAuto247Reconnect,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
