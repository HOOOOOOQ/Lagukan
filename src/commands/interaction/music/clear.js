const { EmbedBuilder, MessageFlags } = require("discord.js");
const { safeReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "clear",
    description: "Clear the Lagukan music queue",
    category: "music",
    permissions: {
        bot: [],
        user: [],
    },
    settings: {
        voice: true,
        player: true,
        current: true,
    },
    devOnly: false,
    run: async (client, interaction, player) => {
        const embed = new EmbedBuilder().setColor(client.config.embedColor);

        if (player.queue.isEmpty) {
            embed.setDescription(`The queue is already empty.`);

            return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        player.queue.clear();

        embed.setDescription(`Cleared the queue.`);

        return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
