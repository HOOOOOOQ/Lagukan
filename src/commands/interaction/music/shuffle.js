const { EmbedBuilder, MessageFlags } = require("discord.js");
const { refreshNowPlayingDashboard } = require("../../../functions/nowPlayingManager.js");
const { safeReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "shuffle",
    description: "Shuffle the Lagukan music queue",
    category: "music",
    permissions: {
        bot: [],
        user: [],
    },
    settings: {
        voice: true,
        player: true,
        current: true,
        dj: true,
    },
    devOnly: false,
    run: async (client, interaction, player) => {
        const embed = new EmbedBuilder().setColor(client.config.embedColor);

        if (player.queue.isEmpty) {
            embed.setDescription("Queue is empty. Shuffle not possible.");
            return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        if (player.queue.length <= 1) {
            embed.setDescription("Only one song in queue. Shuffle not possible.");
            return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        player.queue.shuffle();
        player.data?.set?.("shuffled", true);
        await refreshNowPlayingDashboard(client, player);

        embed.setDescription(`🔀 Shuffled \`${player.queue.size}\` tracks in the queue.`);

        return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
