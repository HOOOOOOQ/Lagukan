const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { ChannelType, PermissionsBitField } = require("discord.js");
const { isCloudDatabaseReady } = require("../databases/cloudAdapter.js");
const Logger = require("../utils/logger");

function isDbReady(model) {
    if (isCloudDatabaseReady()) return true;
    if (model?.db && typeof model.db.readyState === "number") {
        return model.db.readyState === 1;
    }
    if (mongoose.connection.readyState === 1) return true;
    if (model && !model.db) return true;
    return false;
}

function getBotAppId(client) {
    return String(client?.user?.id || client?.application?.id || "").trim();
}

function ensureClientSessionStore(client) {
    if (!client._voiceSessions666 || !(client._voiceSessions666 instanceof Map)) {
        client._voiceSessions666 = new Map();
    }
    if (!client._notifConfigCache666 || !(client._notifConfigCache666 instanceof Map)) {
        client._notifConfigCache666 = new Map();
    }
    return {
        sessions: client._voiceSessions666,
        configCache: client._notifConfigCache666,
    };
}

function notifCacheKey(botApplicationId, guildId, voiceChannelId) {
    return `${botApplicationId}:${guildId}:${voiceChannelId}`;
}

/**
 * Checks whether a Discord Voice/Stage channel natively supports sending text messages
 * (Discord Text-in-Voice feature in discord.js v14).
 */
function isVoiceChannelDirectSendable(channel) {
    if (!channel || typeof channel.send !== "function") return false;
    if (typeof channel.isSendable === "function") {
        return Boolean(channel.isSendable());
    }
    if (typeof channel.isTextBased === "function") {
        return Boolean(channel.isTextBased());
    }
    return channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice;
}

function hasChannelSendPermissions(guild, channel) {
    if (!channel || typeof channel.send !== "function") return false;
    const me = guild?.members?.me;
    if (!me || typeof channel.permissionsFor !== "function") {
        return true;
    }
    const perms = channel.permissionsFor(me);
    if (!perms) return false;
    const required = [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.EmbedLinks];
    return required.every((flag) => perms.has(flag));
}

async function getNotificationConfig(client, guildId, voiceChannelId) {
    const botApplicationId = getBotAppId(client);
    if (!botApplicationId || !guildId || !voiceChannelId) return null;

    const gId = String(guildId);
    const vId = String(voiceChannelId);
    const { configCache } = ensureClientSessionStore(client);
    const cKey = notifCacheKey(botApplicationId, gId, vId);

    if (configCache.has(cKey)) {
        return configCache.get(cKey);
    }

    const model = client?.profileNotificationConfigData;
    if (!model || !isDbReady(model)) {
        return null;
    }

    const doc = await model
        .findOne({
            botApplicationId,
            guildId: gId,
            voiceChannelId: vId,
        })
        .catch(() => null);

    const plain = doc ? (typeof doc.toObject === "function" ? doc.toObject() : { ...doc }) : null;
    configCache.set(cKey, plain);
    return plain;
}

async function upsertNotificationConfig(
    client,
    { guildId, voiceChannelId, notificationChannelId = null, useVoiceChannelChat = true, enabled = true, updatedBy = null },
) {
    const botApplicationId = getBotAppId(client);
    if (!botApplicationId || !guildId || !voiceChannelId) return null;

    const gId = String(guildId);
    const vId = String(voiceChannelId);
    const payload = {
        botApplicationId,
        guildId: gId,
        voiceChannelId: vId,
        notificationChannelId: notificationChannelId ? String(notificationChannelId) : null,
        useVoiceChannelChat: Boolean(useVoiceChannelChat),
        enabled: Boolean(enabled),
        updatedBy: updatedBy ? String(updatedBy) : null,
    };

    const { configCache, sessions } = ensureClientSessionStore(client);
    configCache.set(notifCacheKey(botApplicationId, gId, vId), payload);

    const model = client?.profileNotificationConfigData;
    if (model && isDbReady(model)) {
        await model
            .findOneAndUpdate(
                { botApplicationId, guildId: gId, voiceChannelId: vId },
                { $set: payload },
                { upsert: true, returnDocument: "after" },
            )
            .catch((err) => {
                Logger.warn(
                    `[ProfileNotif666] Gagal menyimpan konfigurasi notifikasi (${botApplicationId}/${gId}): ${err?.message || err}`,
                );
            });
    }

    // Sync active session if this bot is currently in that voice channel
    const activeSession = sessions.get(gId);
    if (activeSession && activeSession.voiceChannelId === vId) {
        const resolved = await resolveNotificationTargetChannel(client, gId, vId);
        activeSession.notificationChannelId = resolved?.channel?.id || null;
        if (client?.musicSession666Data && isDbReady(client.musicSession666Data)) {
            await client.musicSession666Data
                .findOneAndUpdate(
                    { sessionId: activeSession.sessionId },
                    { $set: { notificationChannelId: activeSession.notificationChannelId } },
                )
                .catch(() => {});
        }
    }

    return payload;
}

/**
 * Strictly resolves the notification channel for `(client.user.id, guildId, voiceChannelId)`.
 * - Never falls back to global/random channels or another bot's configuration.
 * - Prefers native Voice Channel text chat when `useVoiceChannelChat` is enabled and supported;
 *   otherwise uses the configured `notificationChannelId`.
 * - Cancels sending if configuration does not exist, is disabled, or lacks permissions.
 */
async function resolveNotificationTargetChannel(client, guildId, voiceChannelId) {
    const botApplicationId = getBotAppId(client);
    if (!botApplicationId || !guildId || !voiceChannelId) {
        return { channel: null, reason: "invalid_identity" };
    }

    const gId = String(guildId);
    const vId = String(voiceChannelId);
    const guild = client?.guilds?.cache?.get?.(gId);
    if (!guild) {
        return { channel: null, reason: "guild_not_found" };
    }

    const config = await getNotificationConfig(client, gId, vId);
    if (!config || config.enabled === false) {
        return { channel: null, reason: "config_unavailable_or_disabled" };
    }

    // Strict ownership verification: never use a config owned by a different botApplicationId
    if (String(config.botApplicationId) !== botApplicationId || String(config.guildId) !== gId || String(config.voiceChannelId) !== vId) {
        return { channel: null, reason: "ownership_mismatch" };
    }

    const voiceChannel = guild.channels?.cache?.get?.(vId) || client?.channels?.cache?.get?.(vId) || null;

    // 1. Direct Voice Channel Chat when enabled and no explicit separate text override (or override === voiceChannelId)
    const wantsDirectVoiceChat =
        Boolean(config.useVoiceChannelChat) && (!config.notificationChannelId || String(config.notificationChannelId) === vId);

    if (wantsDirectVoiceChat && voiceChannel && isVoiceChannelDirectSendable(voiceChannel)) {
        if (!hasChannelSendPermissions(guild, voiceChannel)) {
            return { channel: null, reason: "missing_voice_chat_permissions" };
        }
        return { channel: voiceChannel, mode: "voice_chat", reason: "ok" };
    }

    // 2. Fallback / Explicit Dedicated Text Channel configured for this Voice Channel
    if (config.notificationChannelId) {
        const targetId = String(config.notificationChannelId);
        const textChannel = guild.channels?.cache?.get?.(targetId) || client?.channels?.cache?.get?.(targetId) || null;
        if (!textChannel) {
            return { channel: null, reason: "configured_channel_missing" };
        }
        const channelGuildId = String(textChannel.guildId || textChannel.guild?.id || "");
        if (channelGuildId && channelGuildId !== gId) {
            return { channel: null, reason: "cross_guild_rejected" };
        }
        if (typeof textChannel.send !== "function" || !hasChannelSendPermissions(guild, textChannel)) {
            return { channel: null, reason: "missing_text_channel_permissions" };
        }
        return { channel: textChannel, mode: "configured_text_channel", reason: "ok" };
    }

    return { channel: null, reason: "voice_chat_unsupported_and_no_fallback" };
}

/**
 * Opens or updates the isolated active voice session for `(botApplicationId, guildId)`.
 */
async function openOrSyncVoiceSession666(client, player) {
    const botApplicationId = getBotAppId(client);
    const guildId = String(player?.guildId || "");
    const voiceChannelId = String(player?.voiceId || "");
    if (!botApplicationId || !guildId || !voiceChannelId) return null;

    const { sessions } = ensureClientSessionStore(client);
    const existing = sessions.get(guildId);

    // Reuse existing session if connected to the exact same voice channel
    if (existing && existing.active && existing.voiceChannelId === voiceChannelId && existing.botApplicationId === botApplicationId) {
        return existing;
    }

    // If bot moved to a different voice channel, close previous session cleanly first
    if (existing && existing.active) {
        await closeVoiceSession666(client, guildId, "voice_channel_changed");
    }

    const sessionId = `s666_${botApplicationId}_${guildId}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const playerId = `player_${botApplicationId}_${guildId}_${voiceChannelId}`;
    const resolved = await resolveNotificationTargetChannel(client, guildId, voiceChannelId);

    const sessionRecord = {
        botApplicationId,
        guildId,
        voiceChannelId,
        playerId,
        sessionId,
        notificationChannelId: resolved?.channel?.id || null,
        nowPlayingMessageId: player?.data?.get?.("nowPlayingMessageId") || null,
        active: true,
        startedAt: new Date(),
        endedAt: null,
    };

    sessions.set(guildId, sessionRecord);
    if (player?.data?.set) {
        player.data.set("sessionId666", sessionId);
        player.data.set("botApplicationId", botApplicationId);
    }

    const model = client?.musicSession666Data;
    if (model && isDbReady(model)) {
        // Mark any stale active sessions for this bot+guild as closed before inserting new session
        await model
            .updateMany({ botApplicationId, guildId, active: true }, { $set: { active: false, endedAt: new Date() } })
            .catch(() => {});

        await model.findOneAndUpdate({ sessionId }, { $set: sessionRecord }, { upsert: true, returnDocument: "after" }).catch(() => {});
    }

    return sessionRecord;
}

function getActiveVoiceSession666(client, guildId) {
    const botApplicationId = getBotAppId(client);
    if (!botApplicationId || !guildId) return null;
    const { sessions } = ensureClientSessionStore(client);
    const session = sessions.get(String(guildId));
    if (!session || !session.active || session.botApplicationId !== botApplicationId) {
        return null;
    }
    return session;
}

async function updateSessionNowPlayingMessageId(client, guildId, messageId) {
    const session = getActiveVoiceSession666(client, guildId);
    if (!session) return;
    session.nowPlayingMessageId = messageId ? String(messageId) : null;

    const model = client?.musicSession666Data;
    if (model && isDbReady(model)) {
        await model
            .findOneAndUpdate({ sessionId: session.sessionId }, { $set: { nowPlayingMessageId: session.nowPlayingMessageId } })
            .catch(() => {});
    }
}

async function closeVoiceSession666(client, guildId, _reason = "destroyed") {
    const botApplicationId = getBotAppId(client);
    if (!botApplicationId || !guildId) return;

    const gId = String(guildId);
    const { sessions } = ensureClientSessionStore(client);
    const existing = sessions.get(gId);
    sessions.delete(gId);

    const model = client?.musicSession666Data;
    if (model && isDbReady(model)) {
        if (existing?.sessionId) {
            await model
                .findOneAndUpdate({ sessionId: existing.sessionId }, { $set: { active: false, endedAt: new Date() } })
                .catch(() => {});
        } else {
            await model
                .updateMany({ botApplicationId, guildId: gId, active: true }, { $set: { active: false, endedAt: new Date() } })
                .catch(() => {});
        }
    }
}

/**
 * Sends a profile/achievement notification strictly to the channel bound to THIS bot's
 * currently active voice session. Aborts safely if session ended, bot changed channel,
 * config is missing/disabled, or permissions are insufficient.
 */
async function sendSessionNotification666(client, guildId, messagePayload, expectedSessionId = null) {
    const botApplicationId = getBotAppId(client);
    if (!botApplicationId || !guildId || !messagePayload) {
        return { sent: false, reason: "invalid_arguments" };
    }

    const gId = String(guildId);
    const session = getActiveVoiceSession666(client, gId);
    if (!session || !session.active) {
        return { sent: false, reason: "session_inactive" };
    }

    if (expectedSessionId && session.sessionId !== expectedSessionId) {
        return { sent: false, reason: "session_mismatch" };
    }

    // Verify player / voice connection is still live in that exact voice channel
    const livePlayer = client?.rainlink?.players?.get?.(gId) || null;
    const liveVoiceId = String(livePlayer?.voiceId || client?.guilds?.cache?.get?.(gId)?.members?.me?.voice?.channelId || "");
    if (!liveVoiceId || liveVoiceId !== session.voiceChannelId) {
        return { sent: false, reason: "voice_channel_disconnected" };
    }

    const resolved = await resolveNotificationTargetChannel(client, gId, session.voiceChannelId);
    if (!resolved?.channel) {
        return { sent: false, reason: resolved?.reason || "no_target_channel" };
    }

    try {
        const sentMsg = await resolved.channel.send(messagePayload);
        return {
            sent: true,
            channelId: resolved.channel.id,
            mode: resolved.mode,
            messageId: sentMsg?.id || null,
        };
    } catch (err) {
        Logger.warn(`[ProfileNotif666] Gagal mengirim notifikasi sesi (${botApplicationId}/${gId}): ${err?.message || err}`);
        return { sent: false, reason: "discord_send_error" };
    }
}

module.exports = {
    getBotAppId,
    isVoiceChannelDirectSendable,
    hasChannelSendPermissions,
    getNotificationConfig,
    upsertNotificationConfig,
    resolveNotificationTargetChannel,
    openOrSyncVoiceSession666,
    getActiveVoiceSession666,
    updateSessionNowPlayingMessageId,
    closeVoiceSession666,
    sendSessionNotification666,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
