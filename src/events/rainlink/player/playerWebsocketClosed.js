const { EmbedBuilder } = require("discord.js");
const {
    PLAYER_STATE_DESTROYED,
    buildBotGuildKey,
    isGuildManuallyDisconnected,
    isGuildLeavingInProgress,
} = require("../../../functions/voiceSessionManager.js");
const { cleanupNowPlayingMessage } = require("../../../functions/nowPlayingManager.js");
const Logger = require("../../../utils/logger");

// Scoped by `${botApplicationId}:${guildId}` so 10 concurrent bots never share cooldowns
const recentWsRecoveryByBotGuild = new Map();

module.exports = async (client, player, data) => {
    if (
        !player ||
        player.state === PLAYER_STATE_DESTROYED ||
        player.sudoDestroy ||
        isGuildManuallyDisconnected(client, player.guildId) ||
        isGuildLeavingInProgress(player.guildId, client)
    ) {
        return;
    }

    const code = Number(data?.code || 0);
    const reason = String(data?.reason || "Voice WebSocket closed");
    const guildId = String(player.guildId || "");
    const scopeKey = buildBotGuildKey(client, guildId);

    Logger.music("warn", `Discord voice WebSocket closed (code=${code}, byRemote=${Boolean(data?.byRemote)})`, {
        guildId,
        playerStatus: `voice_ws_closed:${code}`,
        nodeStatus: player.node?.options?.name || "Lavalink",
        errorMessage: reason,
    });

    const channel = client.channels?.cache?.get?.(player.textId);

    if (code === 4017) {
        await cleanupNowPlayingMessage(player, true);
        if (channel?.send) {
            const daveEmbed = new EmbedBuilder()
                .setColor(0xff4757)
                .setDescription(
                    "❌ **Discord Voice Encryption Error (Code 4017 — DAVE E2EE):** Server Lavalink yang terhubung belum mendukung enkripsi suara Discord terbaru (`libdave`). Perbarui server Lavalink ke **v4.2.2+** agar audio dapat diputar.",
                );
            await channel.send({ embeds: [daveEmbed] }).catch(() => {});
        }
        return;
    }

    if ([4006, 4009, 4015].includes(code) && player.voiceId) {
        const lastAttempt = Number(recentWsRecoveryByBotGuild.get(scopeKey) || 0);
        if (Date.now() - lastAttempt > 15000) {
            recentWsRecoveryByBotGuild.set(scopeKey, Date.now());
            try {
                player.voice?.sendVoiceUpdate?.();
                Logger.music("info", "Requested fresh Discord voice state handshake after transient WS close", {
                    guildId,
                    playerStatus: `recovering:${code}`,
                    nodeStatus: player.node?.options?.name || "Lavalink",
                });
                return;
            } catch (err) {
                Logger.debug(`[PlayerWebsocketClosed] Gagal memulihkan sesi voice (${scopeKey}): ${err?.message || err}`);
            }
        }
    }

    if (code === 4014) {
        const guild = client.guilds?.cache?.get?.(guildId);
        const botChannelId = guild?.members?.me?.voice?.channelId;
        if (!botChannelId) {
            await cleanupNowPlayingMessage(player, true);
        }
    }
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
