const { EmbedBuilder } = require("discord.js");
const {
    PLAYER_STATE_DESTROYED,
    isGuildManuallyDisconnected,
    isGuildLeavingInProgress,
} = require("../../../functions/voiceSessionManager.js");
const Logger = require("../../../utils/logger");

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

    const guild = client.guilds.cache.get(player.guildId);

    Logger.error(`Player got an exception from ${guild?.name || "Unknown"} (${player.guildId})`, data);

    if (player.message) {
        player.message.delete().catch(() => {});
        player.message = null;
    }

    const channel = client.channels.cache.get(player.textId);
    const embed = new EmbedBuilder().setColor(client.config.embedColor);

    if (!player.queue.isEmpty) {
        embed.setDescription(`Error while playing. Skipping to the next song...`);

        if (channel) await channel.send({ embeds: [embed] }).catch(() => {});
    } else {
        embed.setDescription(`Error while playing and the queue is empty. Stopping the player...`);

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
