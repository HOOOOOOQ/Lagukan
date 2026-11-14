const { EmbedBuilder, MessageFlags } = require("discord.js");
const { cleanupNowPlayingMessage } = require("../../../functions/nowPlayingManager.js");
const { safeReply, safeDeferReply } = require("../../../functions/interactionResponder.js");

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
        if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;
        const previousStopAt = player._manualStopAt;
        player._manualStopAt = Date.now();
        try {
            await Promise.resolve(player.stop());
        } catch (error) {
            player._manualStopAt = previousStopAt;
            throw error;
        }
        await cleanupNowPlayingMessage(player, true);
        player.data?.set?.("shuffled", false);

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
