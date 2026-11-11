const { EmbedBuilder, MessageFlags } = require("discord.js");
const { refreshNowPlayingDashboard } = require("../../../functions/nowPlayingManager.js");
const { safeReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "pause",
    description: "Pause the current song in Lagukan player",
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
        allowRequester: true,
    },
    devOnly: false,
    run: async (client, interaction, player) => {
        const embed = new EmbedBuilder().setColor(client.config.embedColor);

        if (player.paused) {
            embed.setDescription("Playback is already paused.");
            return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        await Promise.resolve(player.pause());
        await refreshNowPlayingDashboard(client, player);

        embed.setDescription("Paused the current song.");

        return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
