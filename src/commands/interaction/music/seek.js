const { EmbedBuilder, MessageFlags } = require("discord.js");
const { refreshNowPlayingDashboard } = require("../../../functions/nowPlayingManager.js");
const { safeDeferReply, safeEditReply, safeReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "seek",
    description: "Seek the current song in Lagukan player",
    category: "music",
    options: [
        {
            name: "time",
            description: "Provide time in seconds",
            type: 4,
            min_value: 0,
            required: true,
        },
    ],
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
        const time = interaction.options.getInteger("time");

        if (!player.queue.current.isSeekable || player.queue.current.isStream) {
            embed.setDescription("The current song is not seekable.");
            return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        if (time * 1000 > player.queue.current.duration) {
            embed.setDescription("Time exceeds the duration of the current song.");
            return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        await Promise.resolve(player.seek(time * 1000));
        player.position = time * 1000;
        await refreshNowPlayingDashboard(client, player);

        embed.setDescription(`Seeked to: \`${time}s\``);

        return safeEditReply(interaction, { embeds: [embed] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
