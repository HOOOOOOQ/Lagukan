const { MessageFlags } = require("discord.js");
const {
    buildNowPlayingEmbed,
    sendOrReplaceNowPlayingDashboard,
    refreshNowPlayingDashboard,
} = require("../../../functions/nowPlayingManager.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "nowplaying",
    description: "Display the Lagukan Now Playing dashboard and song progress",
    category: "music",
    options: [
        {
            name: "resend",
            description: "Re-post the interactive Now Playing dashboard to the channel",
            type: 5,
            required: false,
        },
    ],
    permissions: {
        bot: [],
        user: [],
    },
    settings: {
        voice: false,
        player: false,
        current: true,
    },
    devOnly: false,
    run: async (client, interaction, player) => {
        const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const resend = Boolean(interaction.options.getBoolean("resend"));
        if (resend) {
            player.textId = interaction.channelId;
            await sendOrReplaceNowPlayingDashboard(client, player);
        } else {
            await refreshNowPlayingDashboard(client, player);
        }

        const embed = buildNowPlayingEmbed(client, player);
        return safeEditReply(interaction, { embeds: [embed] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
