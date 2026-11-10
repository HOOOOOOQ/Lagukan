const { EmbedBuilder } = require("discord.js");

module.exports = {
    name: "maintenance",
    aliases: ["devmode"],
    description: "Toggle Lagukan maintenance mode",
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
        const embed = new EmbedBuilder().setColor(client.config.embedColor);
        const maintenance = client.data.get("maintenance");

        if (maintenance) {
            client.data.set("maintenance", false);

            embed.setDescription(`Maintenance mode is now \`disabled\`.`);
        } else {
            client.data.set("maintenance", true);

            embed.setDescription(`Maintenance mode is now \`enabled\`.`);
        }

        return message.reply({ embeds: [embed] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
