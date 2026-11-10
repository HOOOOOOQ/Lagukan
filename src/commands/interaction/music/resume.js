const { EmbedBuilder, MessageFlags } = require("discord.js");

module.exports = {
    name: "resume",
    description: "Resume the current paused song in Lagukan player",
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

        if (!player.paused) {
            embed.setDescription(`Song is not paused.`);

            return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
        }

        player.resume();

        embed.setDescription(`Resumed the current song.`);

        return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
