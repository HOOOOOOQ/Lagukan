const { EmbedBuilder, MessageFlags } = require("discord.js");
const { refreshNowPlayingDashboard, truncateText } = require("../../../functions/nowPlayingManager.js");
const { safeReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "remove",
    description: "Remove a song from the Lagukan queue",
    category: "music",
    options: [
        {
            name: "position",
            description: "Provide song position in queue",
            type: 4,
            min_value: 1,
            required: true,
        },
    ],
    permissions: {
        bot: [],
        user: [],
    },
    settings: {
        voice: true,
        player: true,
        current: true,
        dj: true,
    },
    devOnly: false,
    run: async (client, interaction, player) => {
        const embed = new EmbedBuilder().setColor(client.config.embedColor);

        if (player.queue.isEmpty) {
            embed.setDescription("The queue is empty.");
            return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        const position = interaction.options.getInteger("position");

        if (!position || position < 1 || position > player.queue.size) {
            embed.setDescription(`Position must be between \`1\` and \`${player.queue.size}\`.`);
            return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        const target = player.queue[position - 1];
        player.queue.remove(position - 1);
        await refreshNowPlayingDashboard(client, player);

        embed.setDescription(`Removed \`#${position}\` (**${truncateText(target?.title, 50)}**) from the queue.`);

        return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
