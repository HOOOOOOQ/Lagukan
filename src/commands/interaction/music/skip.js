const { EmbedBuilder, MessageFlags } = require("discord.js");

module.exports = {
    name: "skip",
    description: "Skip the current song in Lagukan player",
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

        if (player.queue.isEmpty && !client.data.get("autoplay", player.guildId)) {
            embed.setDescription(`Queue is empty. Skip not possible.`);

            return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
        }

        player.skip();

        embed.setDescription(`Skipped the current song.`);

        return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
