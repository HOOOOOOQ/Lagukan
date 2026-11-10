const { EmbedBuilder, MessageFlags } = require("discord.js");

module.exports = {
    name: "leave",
    description: "Make Lagukan leave the voice channel",
    category: "music",
    permissions: {
        bot: [],
        user: ["ManageGuild"],
    },
    settings: {
        voice: true,
        player: true,
        current: false,
    },
    devOnly: false,
    run: async (client, interaction, player) => {
        player.destroy();

        const embed = new EmbedBuilder().setColor(client.config.embedColor).setDescription(`Leaving voice channel...`);

        return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
