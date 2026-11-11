const { EmbedBuilder } = require("discord.js");
const {
    PLAYER_STATE_DESTROYED,
    isGuildManuallyDisconnected,
    isGuildLeavingInProgress,
} = require("../../../functions/voiceSessionManager.js");
const { cleanupNowPlayingMessage } = require("../../../functions/nowPlayingManager.js");
const Logger = require("../../../utils/logger");

const recentWsRecoveryByGuild = new Map();

module.exports = async (client, player, data) => {
    if (
        !player ||
        player.state === PLAYER_STATE_DESTROYED ||
        player.sudoDestroy ||
        isGuildManuallyDisconnected(client, player.guildId) ||
        isGuildLeavingInProgress(player.guildId)
    ) {
        return;
    }

    const code = Number(data?.code || 0);
    const reason = String(data?.reason || "Voice WebSocket closed");
    const guildId = String(player.guildId || "");

    Logger.music("warn", `Discord voice WebSocket closed (code=${code}, byRemote=${Boolean(data?.byRemote)})`, {
        guildId,
        playerStatus: `voice_ws_closed:${code}`,
        nodeStatus: player.node?.options?.name || "Lavalink",
        errorMessage: reason,
    });

    const channel = client.channels?.cache?.get?.(player.textId);

    // 4017 = Discord DAVE E2EE protocol required (Lavalink < 4.2.0 without libdave)
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

    // Transient voice session/server invalidation (4006, 4009, 4015) — refresh Gateway Op 4 once within cooldown
    if ([4006, 4009, 4015].includes(code) && player.voiceId) {
        const lastAttempt = Number(recentWsRecoveryByGuild.get(guildId) || 0);
        if (Date.now() - lastAttempt > 15000) {
            recentWsRecoveryByGuild.set(guildId, Date.now());
            try {
                player.voice?.sendVoiceUpdate?.();
                Logger.music("info", "Requested fresh Discord voice state handshake after transient WS close", {
                    guildId,
                    playerStatus: `recovering:${code}`,
                    nodeStatus: player.node?.options?.name || "Lavalink",
                });
                return;
            } catch (err) {
                Logger.debug(`[PlayerWebsocketClosed] Gagal memulihkan sesi voice (${guildId}): ${err?.message || err}`);
            }
        }
    }

    // 4014 = Disconnected from channel / permission revoked
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
