const { EmbedBuilder, MessageFlags } = require("discord.js");
const { safeReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "previous",
    description: "Play the previous song in Lagukan player",
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
        const hasPrevious = Array.isArray(player.queue.previous) ? player.queue.previous.length > 0 : Boolean(player.queue.previous);

        if (!hasPrevious) {
            embed.setDescription(`Previous song not found.`);

            return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        await Promise.resolve(player.previous());

        embed.setDescription(`Playing the previous song.`);

        return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
