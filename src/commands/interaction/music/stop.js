const { EmbedBuilder, MessageFlags } = require("discord.js");
const { cleanupNowPlayingMessage } = require("../../../functions/nowPlayingManager.js");
const { safeReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "stop",
    description: "Stop the Lagukan music player and clear upcoming queue",
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
        player._manualStopAt = Date.now();
        await cleanupNowPlayingMessage(player, true);
        player.queue.clear();
        player.data?.set?.("shuffled", false);
        await Promise.resolve(player.stop());

        const embed = new EmbedBuilder()
            .setColor(client.config.embedColor)
            .setDescription("Stopped the music player and cleared the queue.");

        return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
