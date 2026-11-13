const { RainlinkPlayerState } = require("rainlink");
const { normalizeGuildData } = require("./createData.js");
const Logger = require("../utils/logger");

const PLAYER_STATE_CONNECTED = RainlinkPlayerState?.CONNECTED ?? 0;
const PLAYER_STATE_DISCONNECTED = RainlinkPlayerState?.DISCONNECTED ?? 1;
const PLAYER_STATE_DESTROYED = RainlinkPlayerState?.DESTROYED ?? 2;

// Scoped by `${botApplicationId}:${guildId}` so 10 concurrent bots never collide
const manualDisconnectGuilds = new Set();
const leavingInProgressGuilds = new Set();
const pendingNodeReconnectTimers = new Map();
const pendingInactivityTimers = new Map();

function buildBotGuildKey(clientOrBotId, guildId) {
    const gId = String(guildId || "");
    if (!gId) return "";
    const botId =
        typeof clientOrBotId === "string" ? clientOrBotId : String(clientOrBotId?.user?.id || clientOrBotId?.application?.id || "default");
    return `${botId}:${gId}`;
}

function syncGuildDisconnectMemory(guildId, guildData, client = null) {
    if (!guildId) return;
    const key = buildBotGuildKey(client, guildId);
    if (guildData?.manualDisconnect) {
        manualDisconnectGuilds.add(key);
    } else {
        manualDisconnectGuilds.delete(key);
    }
}

function isGuildManuallyDisconnected(client, guildId) {
    if (!guildId) return false;
    const gId = String(guildId);
    const key = buildBotGuildKey(client, gId);
    if (manualDisconnectGuilds.has(key)) return true;

    const cached = client?.data?.get?.(`guildData_${gId}`);
    return Boolean(cached?.manualDisconnect && (!cached?.manualDisconnectBotId || cached.manualDisconnectBotId === client?.user?.id));
}

function isGuildLeavingInProgress(guildId, client = null) {
    if (!guildId) return false;
    if (client) {
        return leavingInProgressGuilds.has(buildBotGuildKey(client, guildId));
    }
    const suffix = `:${String(guildId)}`;
    for (const k of leavingInProgressGuilds) {
        if (k.endsWith(suffix)) return true;
    }
    return false;
}

function cancelNodeReconnectTimer(guildId, client = null) {
    if (!guildId) return;
    const key = buildBotGuildKey(client, guildId);
    const existing = pendingNodeReconnectTimers.get(key);
    if (existing) {
        clearTimeout(existing);
        pendingNodeReconnectTimers.delete(key);
    }
}

function registerNodeReconnectTimer(guildId, timerHandle, client = null) {
    if (!guildId || !timerHandle) return;
    const key = buildBotGuildKey(client, guildId);
    cancelNodeReconnectTimer(guildId, client);
    pendingNodeReconnectTimers.set(key, timerHandle);
}

function clearNodeReconnectTimerRef(guildId, timerHandle, client = null) {
    if (!guildId) return;
    const key = buildBotGuildKey(client, guildId);
    if (pendingNodeReconnectTimers.get(key) === timerHandle) {
        pendingNodeReconnectTimers.delete(key);
    }
}

function cancelInactivityTimer(guildId, client = null) {
    if (!guildId) return;
    const key = buildBotGuildKey(client, guildId);
    const existing = pendingInactivityTimers.get(key);
    if (existing) {
        clearTimeout(existing);
        pendingInactivityTimers.delete(key);
    }
}

function registerInactivityTimer(guildId, timerHandle, client = null) {
    if (!guildId || !timerHandle) return;
    const key = buildBotGuildKey(client, guildId);
    cancelInactivityTimer(guildId, client);
    pendingInactivityTimers.set(key, timerHandle);
}

function clearInactivityTimerRef(guildId, timerHandle, client = null) {
    if (!guildId) return;
    const key = buildBotGuildKey(client, guildId);
    if (pendingInactivityTimers.get(key) === timerHandle) {
        pendingInactivityTimers.delete(key);
    }
}

/**
 * Safely retrieves the Rainlink player for `guildId` using RainlinkPlayerManager#get(guildId)
 * (RainlinkDatabase API in rainlink ^1.2.7). Handles unavailable or already-destroyed players.
 */
function getGuildPlayer(client, guildId) {
    if (!guildId || typeof client?.rainlink?.players?.get !== "function") {
        return null;
    }

    const gId = String(guildId);
    const player = client.rainlink.players.get(gId);
    if (!player) return null;

    if (player.state === PLAYER_STATE_DESTROYED) {
        if (!player.sudoDestroy && typeof client.rainlink.players.delete === "function") {
            client.rainlink.players.delete(gId);
        }
        return null;
    }

    if (player.sudoDestroy) {
        return null;
    }

    return player;
}

/**
 * Checks whether `guildId` currently has an active, non-destroyed, voice-connected Rainlink player.
 */
function hasActiveGuildPlayer(client, guildId) {
    const player = getGuildPlayer(client, guildId);
    if (!player) return false;

    if (player.state === PLAYER_STATE_DISCONNECTED || !player.voiceId) {
        return false;
    }

    return player.state === PLAYER_STATE_CONNECTED || Boolean(player.voiceId);
}

/**
 * Cleans up any disconnected/destroyed leftover player or voice handler before Auto Reconnect
 * calls `client.rainlink.create(...)`, since RainlinkPlayerManager#create returns `this.get(guildId)`
 * directly if an entry still exists in `RainlinkDatabase`.
 */
async function prepareGuildForReconnect(client, guildId) {
    if (!guildId || typeof client?.rainlink?.players?.get !== "function") {
        return false;
    }

    const gId = String(guildId);
    const existing = client.rainlink.players.get(gId);
    if (!existing) return true;

    if (
        existing.state !== PLAYER_STATE_DESTROYED &&
        existing.state !== PLAYER_STATE_DISCONNECTED &&
        !existing.sudoDestroy &&
        Boolean(existing.voiceId)
    ) {
        return false;
    }

    try {
        if (existing.state !== PLAYER_STATE_DESTROYED && !existing.sudoDestroy) {
            await Promise.resolve(existing.destroy()).catch(() => {});
        }
    } finally {
        if (typeof client.rainlink.players.delete === "function") {
            client.rainlink.players.delete(gId);
        }
        const staleVoice = client.rainlink.voices?.get?.(gId);
        if (staleVoice) {
            try {
                staleVoice.disconnect?.();
            } catch {
                // Ignore voice cleanup error
            }
            client.rainlink.voices?.delete?.(gId);
        }
    }

    return true;
}

/**
 * Cleans up any dead/zombie Rainlink player or voice handler when the bot is no longer
 * connected to a voice channel in that guild, ensuring `/play` and `/join` never get stuck.
 */
async function cleanupStalePlayerIfDisconnected(client, guild) {
    if (!client?.rainlink || !guild?.id || typeof client.rainlink.players?.get !== "function") {
        return null;
    }

    const gId = String(guild.id);
    const existingPlayer = client.rainlink.players.get(gId) || null;
    if (!existingPlayer) return null;

    const botVoiceChannelId = guild.members?.me?.voice?.channelId;
    const isDestroyedOrDead =
        existingPlayer.state === PLAYER_STATE_DESTROYED ||
        existingPlayer.state === PLAYER_STATE_DISCONNECTED ||
        existingPlayer.sudoDestroy ||
        !existingPlayer.voiceId ||
        (guild.members?.me?.voice && botVoiceChannelId === null);

    if (!isDestroyedOrDead) {
        return existingPlayer;
    }

    try {
        if (existingPlayer.state !== PLAYER_STATE_DESTROYED && !existingPlayer.sudoDestroy) {
            await Promise.resolve(existingPlayer.destroy()).catch(() => {});
        }
    } finally {
        client.rainlink.players?.delete?.(gId);
        const staleVoice = client.rainlink.voices?.get?.(gId);
        if (staleVoice) {
            try {
                staleVoice.disconnect?.();
            } catch {
                // Ignore voice cleanup error
            }
            client.rainlink.voices?.delete?.(gId);
        }
    }

    return null;
}

/**
 * Clears the manual-disconnect lock for a specific `(bot, guild)` when a user runs `/play`, `/join`,
 * `/247-setup`, or `/247-enable`, without affecting any other bot or server.
 */
async function clearManualDisconnect(client, guildId, guild = null) {
    if (!guildId) return;
    const gId = String(guildId);
    const key = buildBotGuildKey(client, gId);

    manualDisconnectGuilds.delete(key);
    leavingInProgressGuilds.delete(key);
    cancelNodeReconnectTimer(gId, client);
    cancelInactivityTimer(gId, client);

    const targetGuild = guild || client?.guilds?.cache?.get?.(gId) || { id: gId };
    const currentData = client?.data?.get?.(`guildData_${gId}`) || normalizeGuildData(client, targetGuild, { id: gId });

    if (currentData.manualDisconnect) {
        currentData.manualDisconnect = false;
        client?.data?.set?.(`guildData_${gId}`, currentData);
    }

    if (typeof client?.guildData?.findOneAndUpdate === "function" && (!client.guildData.db || client.guildData.db.readyState === 1)) {
        await client.guildData
            .findOneAndUpdate({ id: gId }, { $set: { manualDisconnect: false } }, { upsert: true, returnDocument: "after" })
            .catch((err) => {
                Logger.debug(`[VoiceSession] Gagal menghapus flag manualDisconnect di MongoDB (${gId}): ${err?.message || err}`);
            });
    }
}

/**
 * Performs a complete, authoritative manual disconnect for `/leave` on THIS bot in a single guild.
 */
async function performManualLeave(client, guild, player = null) {
    const gId = String(guild.id);
    const key = buildBotGuildKey(client, gId);

    manualDisconnectGuilds.add(key);
    leavingInProgressGuilds.add(key);
    cancelNodeReconnectTimer(gId, client);
    cancelInactivityTimer(gId, client);

    const currentGuildData = client?.data?.get?.(`guildData_${gId}`) || normalizeGuildData(client, guild, { id: gId });
    currentGuildData.manualDisconnect = true;
    currentGuildData.manualDisconnectBotId = client?.user?.id || null;
    client?.data?.set?.(`guildData_${gId}`, currentGuildData);

    try {
        const activePlayer = player || client?.rainlink?.players?.get?.(gId) || null;
        if (activePlayer) {
            if (activePlayer._npCollector) {
                try {
                    activePlayer._npCollector.stop("manual_leave");
                } catch {
                    // Ignore collector stop error
                }
                activePlayer._npCollector = null;
            }

            if (activePlayer.message) {
                const oldMsg = activePlayer.message;
                activePlayer.message = null;
                await oldMsg.delete().catch(() => {});
            }

            try {
                if (typeof activePlayer.setLoop === "function") {
                    activePlayer.setLoop("none");
                } else {
                    activePlayer.loop = "none";
                }
            } catch {
                // Ignore if player is already destroyed
            }

            try {
                activePlayer.queue?.clear?.();
                if (activePlayer.queue) {
                    activePlayer.queue.current = null;
                }
            } catch {
                // Ignore queue clear error
            }

            activePlayer.playing = false;
            activePlayer.paused = true;

            if (activePlayer.state !== PLAYER_STATE_DESTROYED) {
                await Promise.resolve(activePlayer.destroy()).catch((err) => {
                    Logger.debug(`[VoiceSession] Catatan saat menghancurkan player (${gId}): ${err?.message || err}`);
                });
            }

            client?.rainlink?.players?.delete?.(gId);
        }

        const voiceHandler = client?.rainlink?.voices?.get?.(gId);
        if (voiceHandler) {
            try {
                voiceHandler.disconnect?.();
            } catch {
                // Ignore voice handler disconnect error
            }
            client.rainlink.voices.delete(gId);
        }

        if (guild.members?.me?.voice?.channelId && typeof guild.members.me.voice.disconnect === "function") {
            await guild.members.me.voice.disconnect("Disconnected via /leave command").catch(() => {});
        }

        if (typeof client?.rainlink?.library?.sendPacket === "function") {
            try {
                client.rainlink.library.sendPacket(
                    guild.shardId ?? 0,
                    {
                        op: 4,
                        d: {
                            guild_id: gId,
                            channel_id: null,
                            self_mute: false,
                            self_deaf: false,
                        },
                    },
                    false,
                );
            } catch {
                // Ignore when shard websocket is unavailable
            }
        }
    } finally {
        leavingInProgressGuilds.delete(key);
    }
}

module.exports = {
    PLAYER_STATE_CONNECTED,
    PLAYER_STATE_DISCONNECTED,
    PLAYER_STATE_DESTROYED,
    buildBotGuildKey,
    syncGuildDisconnectMemory,
    isGuildManuallyDisconnected,
    isGuildLeavingInProgress,
    cancelNodeReconnectTimer,
    registerNodeReconnectTimer,
    clearNodeReconnectTimerRef,
    cancelInactivityTimer,
    registerInactivityTimer,
    clearInactivityTimerRef,
    getGuildPlayer,
    hasActiveGuildPlayer,
    prepareGuildForReconnect,
    cleanupStalePlayerIfDisconnected,
    clearManualDisconnect,
    performManualLeave,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
