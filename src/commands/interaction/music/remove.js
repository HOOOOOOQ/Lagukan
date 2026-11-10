const { EmbedBuilder, MessageFlags } = require("discord.js");

module.exports = {
    name: "remove",
    description: "Remove a song from the Lagukan queue",
    category: "music",
    options: [
        {
            name: "position",
            description: "Provide song position",
            type: 4,
            min_value: 1,
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
    },
    devOnly: false,
    run: async (client, interaction, player) => {
        const embed = new EmbedBuilder().setColor(client.config.embedColor);

        if (player.queue.isEmpty) {
            embed.setDescription(`The queue is empty.`);

            return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
        }

        const position = interaction.options.getInteger("position");

        if (position > player.queue.size) {
            embed.setDescription(`Position is greater than the total songs in the queue.`);

            return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
        }

        player.queue.remove(position - 1);

        embed.setDescription(`Removed song position: \`${position}\``);

        return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
