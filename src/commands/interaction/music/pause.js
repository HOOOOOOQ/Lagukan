const { EmbedBuilder, MessageFlags } = require("discord.js");

module.exports = {
    name: "pause",
    description: "Pause the current song in Lagukan player",
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

        if (player.paused) {
            embed.setDescription(`Already paused.`);

            return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
        }

        player.pause();

        embed.setDescription(`Paused the current song.`);

        return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
