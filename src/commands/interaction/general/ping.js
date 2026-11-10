const { EmbedBuilder, MessageFlags } = require("discord.js");

module.exports = {
    name: "ping",
    description: "Get Lagukan's ping",
    category: "general",
    permissions: {
        bot: [],
        user: [],
    },
    settings: {
        voice: false,
        player: false,
        current: false,
    },
    devOnly: false,
    run: async (client, interaction, player) => {
        const botName = client.config.botName || "Lagukan";
        const embed = new EmbedBuilder()
            .setColor(client.config.embedColor)
            .setDescription(`🏓 **${botName}** Pong! \`${Math.round(client.ws.ping)}ms\`.`);

        return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
