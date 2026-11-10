const { EmbedBuilder, MessageFlags } = require("discord.js");
const { safeReply } = require("../../../functions/interactionResponder.js");

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

            return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        await Promise.resolve(player.skip());

        embed.setDescription(`Skipped the current song.`);

        return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
