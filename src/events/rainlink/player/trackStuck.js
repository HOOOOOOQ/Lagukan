const { EmbedBuilder } = require("discord.js");
const {
    PLAYER_STATE_DESTROYED,
    isGuildManuallyDisconnected,
    isGuildLeavingInProgress,
} = require("../../../functions/voiceSessionManager.js");
const { recordPlaybackFailure } = require("../../../functions/nodeHealthManager.js");
const { cleanupNowPlayingMessage } = require("../../../functions/nowPlayingManager.js");
const Logger = require("../../../utils/logger");

module.exports = async (client, player) => {
    if (
        !player ||
        player.state === PLAYER_STATE_DESTROYED ||
        player.sudoDestroy ||
        isGuildManuallyDisconnected(client, player.guildId) ||
        isGuildLeavingInProgress(player.guildId)
    ) {
        return;
    }

    const guild = client.guilds.cache.get(player.guildId);
    Logger.error(`Song got stuck from ${guild?.name || "Unknown"} (${player.guildId})`);

    await cleanupNowPlayingMessage(player, true);

    const breaker = recordPlaybackFailure(player.guildId);
    const channel = client.channels.cache.get(player.textId);
    const embed = new EmbedBuilder().setColor(client.data.get(`color_${player.guildId}`) || client.config.embedColor);

    if (breaker.tripped) {
        player.queue.clear();
        embed.setDescription("Multiple consecutive tracks became stuck. Stopping playback safely.");
        if (channel) await channel.send({ embeds: [embed] }).catch(() => {});
        if (player.state !== PLAYER_STATE_DESTROYED && !player.sudoDestroy) {
            await Promise.resolve(player.stop()).catch(() => {});
        }
        return;
    }

    if (!player.queue.isEmpty) {
        embed.setDescription(`Song got stuck. Skipping to the next song...`);
        if (channel) await channel.send({ embeds: [embed] }).catch(() => {});
    } else {
        embed.setDescription(`Song got stuck and the queue is empty. Stopping the player...`);
        if (channel) await channel.send({ embeds: [embed] }).catch(() => {});
    }

    if (player.state !== PLAYER_STATE_DESTROYED && !player.sudoDestroy) {
        await Promise.resolve(player.skip()).catch(() => {});
    }
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
