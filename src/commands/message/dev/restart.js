const { EmbedBuilder } = require("discord.js");

module.exports = {
    name: "restart",
    aliases: ["reboot"],
    description: "Restart Lagukan bot process",
    category: "dev",
    permissions: {
        bot: [],
        user: [],
    },
    settings: {
        voice: false,
        player: false,
        current: false,
    },
    devOnly: true,
    run: async (client, message, player, args) => {
        const botName = client.config.botName || "Lagukan";
        const embed = new EmbedBuilder().setColor(client.config.embedColor);

        embed.setDescription(`🔄 Restarting ${botName}...`);

        await message.reply({ embeds: [embed] });

        process.exit(0);
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
