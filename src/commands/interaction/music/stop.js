const { EmbedBuilder, MessageFlags } = require("discord.js");

module.exports = {
    name: "stop",
    description: "Stop the Lagukan music player",
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
        player.stop();

        const embed = new EmbedBuilder().setColor(client.config.embedColor).setDescription(`Stopped the music player.`);

        return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
