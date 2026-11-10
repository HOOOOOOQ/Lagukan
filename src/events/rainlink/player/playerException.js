const { EmbedBuilder } = require("discord.js");
const Logger = require("../../../utils/logger");

module.exports = async (client, player, data) => {
    if (!player) return;

    const guild = await client.guilds.cache.get(player.guildId);

    Logger.error(`Player got an exception from ${guild.name} (${guild.id})`, data);

    if (player.message) player.message.delete().catch((e) => {});

    const channel = await client.channels.cache.get(player.textId);
    const embed = new EmbedBuilder().setColor(client.config.embedColor);

    if (!player.queue.isEmpty) {
        embed.setDescription(`Error while playing. Skipping to the next song...`);

        if (channel) await channel.send({ embeds: [embed] });
    } else {
        embed.setDescription(`Error while playing and the queue is empty. Stopping the player...`);

        if (channel) await channel.send({ embeds: [embed] });
    }

    return player.skip();
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
