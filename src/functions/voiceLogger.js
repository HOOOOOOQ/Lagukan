const { ChannelType, EmbedBuilder, PermissionsBitField, escapeMarkdown } = require("discord.js");
const { createDataGuild } = require("./createData.js");
const Logger = require("../utils/logger");

const COLORS = {
    JOINED: 0x22c55e, // Green
    LEAVING: 0xef4444, // Red
    SYSTEM: 0x4f46e5, // Lagukan Electric Indigo
};

const DEDUP_WINDOW_MS = 2000;
const UNSENDABLE_CHANNEL_COOLDOWN_MS = 60000;

const voiceDedupCache = new Map();
const unsendableVoiceChannelCache = new Map();
const warnedChannelKeys = new Set();

function isValidTimezone(tz) {
    if (!tz || typeof tz !== "string") return false;

    try {
        Intl.DateTimeFormat("en-GB", { timeZone: tz.trim() });
        return true;
    } catch {
        return false;
    }
}

function getTimezoneLabel(tz, date = new Date()) {
    const normalized = String(tz || "").trim();
    const indoLabels = {
        "Asia/Jakarta": "WIB",
        "Asia/Pontianak": "WIB",
        "Asia/Makassar": "WITA",
        "Asia/Ujung_Pandang": "WITA",
        "Asia/Jayapura": "WIT",
    };

    if (indoLabels[normalized]) return indoLabels[normalized];

    try {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: normalized,
            timeZoneName: "short",
        }).formatToParts(date);
        const tzPart = parts.find((p) => p.type === "timeZoneName");

        return tzPart?.value || normalized;
    } catch {
        return "WIB";
    }
}

function formatVoiceTime(date = new Date(), timezone = "Asia/Jakarta") {
    const safeTz = isValidTimezone(timezone) ? timezone.trim() : "Asia/Jakarta";

    try {
        const timeStr = new Intl.DateTimeFormat("en-GB", {
            timeZone: safeTz,
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
        }).format(date);

        return `${timeStr} ${getTimezoneLabel(safeTz, date)}`;
    } catch {
        const fallbackStr = new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Jakarta",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
        }).format(date);

        return `${fallbackStr} WIB`;
    }
}

function isDuplicateTransition(guildId, userId, oldChannelId, newChannelId) {
    const now = Date.now();

    if (voiceDedupCache.size > 500) {
        for (const [key, timestamp] of voiceDedupCache) {
            if (now - timestamp > DEDUP_WINDOW_MS) voiceDedupCache.delete(key);
        }
    }

    const dedupKey = `${guildId}:${userId}:${oldChannelId || "none"}->${newChannelId || "none"}`;
    const lastSeen = voiceDedupCache.get(dedupKey);

    if (lastSeen && now - lastSeen < DEDUP_WINDOW_MS) {
        return true;
    }

    voiceDedupCache.set(dedupKey, now);
    return false;
}

function warnOnce(key, message) {
    if (warnedChannelKeys.has(key)) return;
    warnedChannelKeys.add(key);
    Logger.debug(message);
}

/**
 * Returns the Voice Channel ID currently occupied by Lagukan in this guild, or null if not in voice.
 */
function getBotVoiceChannelId(client, guild) {
    const meVoice = guild?.members?.me?.voice;
    if (meVoice && "channelId" in meVoice) {
        return meVoice.channelId || null;
    }

    const player = client.rainlink?.players?.get?.(guild?.id);
    return player?.voiceId || null;
}

async function resolveGuildVoiceConfig(client, guild) {
    const guildData = (await createDataGuild(client, guild)) || client.data.get(`guildData_${guild.id}`);
    const envVoice = client.config.voiceLog || { enabled: true };
    const defaultTz = client.config.timezone || "Asia/Jakarta";

    const voiceConfig = guildData?.voiceLog || {
        enabled: Boolean(envVoice.enabled),
        timezone: defaultTz,
        source: "env",
    };

    const isCommandOverride = voiceConfig.source === "command";
    const enabled = isCommandOverride ? Boolean(voiceConfig.enabled) : Boolean(envVoice.enabled);
    const timezone = isValidTimezone(voiceConfig.timezone) ? voiceConfig.timezone : defaultTz;

    return {
        enabled,
        timezone,
        isCommandOverride,
        guildData,
    };
}

/**
 * Resolves a Voice/Stage channel and verifies that its Discord Voice Channel Text Chat
 * is supported and accessible by the bot.
 */
async function resolveSendableVoiceChat(client, guild, stateChannel, channelId) {
    if (!guild?.id || !channelId) return null;

    const cacheKey = `${guild.id}:${channelId}`;
    const blockedAt = unsendableVoiceChannelCache.get(cacheKey);
    if (blockedAt && Date.now() - blockedAt < UNSENDABLE_CHANNEL_COOLDOWN_MS) {
        return null;
    }

    let channel = stateChannel && typeof stateChannel.send === "function" ? stateChannel : guild.channels?.cache?.get(channelId) || null;

    if (!channel && typeof guild.channels?.fetch === "function") {
        channel = await guild.channels.fetch(channelId).catch(() => null);
    }

    if (!channel || channel.guildId !== guild.id) {
        unsendableVoiceChannelCache.set(cacheKey, Date.now());
        return null;
    }

    const isVoiceOrStage =
        channel.type === ChannelType.GuildVoice ||
        channel.type === ChannelType.GuildStageVoice ||
        channel.type === 2 ||
        channel.type === 13;

    if (!isVoiceOrStage) {
        return null;
    }

    // Verify Discord.js v14 Text-in-Voice support on this channel object
    if (typeof channel.send !== "function") {
        return null;
    }
    if (typeof channel.isTextBased === "function" && !channel.isTextBased()) {
        return null;
    }
    if (typeof channel.isSendable === "function" && !channel.isSendable()) {
        return null;
    }
    if (channel.viewable === false) {
        return null;
    }

    // Check required permissions for Discord Voice Channel Text Chat
    const me = guild.members?.me || client.user?.id;
    if (me && typeof channel.permissionsFor === "function") {
        const perms = channel.permissionsFor(me);
        const requiredPerms = [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.EmbedLinks,
            PermissionsBitField.Flags.ReadMessageHistory,
        ];

        if (perms && !requiredPerms.every((flag) => perms.has(flag))) {
            warnOnce(
                `missing_vc_chat_perms_${guild.id}_${channelId}`,
                `[VoiceLogger] Missing Text-in-Voice permissions (ViewChannel/SendMessages/EmbedLinks/ReadMessageHistory) in voice channel "${channel.name}" (${guild.name}).`,
            );
            return null;
        }
    }

    unsendableVoiceChannelCache.delete(cacheKey);
    return channel;
}

/**
 * Builds the original Lagukan dark-modern Voice Activity Embed for JOINED or LEAVING.
 */
function buildVoiceActivityEmbed(client, { type, member, user, channelName, timeString }) {
    const avatarUrl =
        member?.displayAvatarURL?.({ size: 256, forceStatic: false }) ||
        user?.displayAvatarURL?.({ size: 256, forceStatic: false }) ||
        client.user?.displayAvatarURL?.({ size: 256 }) ||
        null;

    const botIconUrl = client.user?.displayAvatarURL?.({ size: 128 }) || avatarUrl;
    const mention = user?.id ? `<@${user.id}>` : `@${escapeMarkdown(user?.username || "unknown")}`;
    const usernameTag = user?.username ? `\`@${user.username}\`` : "";
    const safeChannel = escapeMarkdown(channelName || "Voice Channel");

    const isJoined = type === "JOINED";

    const embed = new EmbedBuilder()
        .setColor(isJoined ? COLORS.JOINED : COLORS.LEAVING)
        .setTitle(isJoined ? "🎙️ Joined" : "🎙️ Leaving")
        .setDescription(
            [
                usernameTag ? `${mention} · ${usernameTag}` : `${mention}`,
                isJoined ? `Joined **🔊 ${safeChannel}**` : `Leaving **🔊 ${safeChannel}**`,
                `🕒 \`${timeString}\``,
            ].join("\n"),
        )
        .setFooter({
            text: "LAGUKAN VOICE SYSTEM",
            iconURL: botIconUrl || undefined,
        })
        .setTimestamp();

    if (avatarUrl) {
        embed.setThumbnail(avatarUrl);
    }

    return embed;
}

async function sendLogToVoiceChannel(client, guild, stateChannel, channelId, payload) {
    const voiceChannel = await resolveSendableVoiceChat(client, guild, stateChannel, channelId);
    if (!voiceChannel) return false;

    try {
        const embed = buildVoiceActivityEmbed(client, {
            ...payload,
            channelName: voiceChannel.name || stateChannel?.name || "Voice Channel",
        });

        await voiceChannel.send({
            embeds: [embed],
            allowedMentions: { parse: [] },
        });

        return true;
    } catch (error) {
        // Handle channels where Text-in-Voice is disabled/restricted or deleted
        if ([10003, 50001, 50013, 50024].includes(error?.code)) {
            unsendableVoiceChannelCache.set(`${guild.id}:${channelId}`, Date.now());
        }
        Logger.debug(`[VoiceLogger] Could not send voice chat log in channel ${channelId}: ${error?.message || error}`);
        return false;
    }
}

async function handleVoiceStateLog(client, oldState, newState) {
    try {
        const guild = newState?.guild || oldState?.guild;
        if (!guild?.id) return;

        const oldChannelId = oldState?.channelId || null;
        const newChannelId = newState?.channelId || null;

        // Ignore mute, deafen, stream, camera, or stage state updates in the same channel
        if (oldChannelId === newChannelId) return;

        const member = newState?.member || oldState?.member || null;
        const userId = newState?.id || oldState?.id || member?.id || member?.user?.id;
        if (!userId || userId === client.user?.id) return;

        let user = member?.user || client.users?.cache?.get(userId) || null;
        if (!user && typeof client.users?.fetch === "function") {
            user = await client.users.fetch(userId).catch(() => null);
        }

        // Ignore bot accounts
        if (user?.bot) return;

        // Only log for the voice channel currently occupied by Lagukan
        const botVoiceChannelId = getBotVoiceChannelId(client, guild);
        if (!botVoiceChannelId) return;

        const leftBotChannel = Boolean(oldChannelId && oldChannelId === botVoiceChannelId);
        const joinedBotChannel = Boolean(newChannelId && newChannelId === botVoiceChannelId);

        // Ignore activity in other voice channels not occupied by Lagukan
        if (!leftBotChannel && !joinedBotChannel) return;

        // Prevent duplicate logs from rapid gateway state replays
        if (isDuplicateTransition(guild.id, userId, oldChannelId, newChannelId)) return;

        const config = await resolveGuildVoiceConfig(client, guild);
        if (!config.enabled) return;

        const timeString = formatVoiceTime(new Date(), config.timezone);

        // 1. Member LEFT the bot's voice channel (either disconnected or moved out to another channel)
        if (leftBotChannel) {
            await sendLogToVoiceChannel(client, guild, oldState?.channel, oldChannelId, {
                type: "LEAVING",
                member,
                user,
                timeString,
            });
        }

        // 2. Member JOINED the bot's voice channel (either connected directly or moved in from another channel)
        if (joinedBotChannel) {
            await sendLogToVoiceChannel(client, guild, newState?.channel, newChannelId, {
                type: "JOINED",
                member,
                user,
                timeString,
            });
        }
    } catch (error) {
        Logger.debug(`[VoiceLogger] Handled unexpected voice log error: ${error?.message || error}`);
    }
}

module.exports = {
    COLORS,
    isValidTimezone,
    formatVoiceTime,
    getBotVoiceChannelId,
    resolveGuildVoiceConfig,
    resolveSendableVoiceChat,
    buildVoiceActivityEmbed,
    handleVoiceStateLog,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
