const { EmbedBuilder, MessageFlags } = require("discord.js");
const { getGuildTrackHistory } = require("../../../functions/musicPermissions.js");
const { hydrateStoredTrack } = require("../../../functions/musicSourceResolver.js");
const { truncateText } = require("../../../functions/nowPlayingManager.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "previous",
    description: "Play the previous song from session or server history",
    category: "music",
    permissions: {
        bot: [],
        user: [],
    },
    settings: {
        voice: true,
        player: true,
        current: false,
        dj: true,
    },
    devOnly: false,
    run: async (client, interaction, player) => {
        const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const embed = new EmbedBuilder().setColor(client.config.embedColor);
        const prevList = Array.isArray(player.queue.previous) ? player.queue.previous : [];

        if (prevList.length > 0) {
            const target = prevList[prevList.length - 1];
            if (player.queue.current) {
                await Promise.resolve(player.previous());
            } else {
                prevList.pop();
                await Promise.resolve(player.play(target));
            }
            embed.setDescription(`⏮️ Playing previous track: **${truncateText(target?.title, 50)}**.`);
            return safeEditReply(interaction, { embeds: [embed] });
        }

        const history = await getGuildTrackHistory(client, interaction.guild);
        const fallbackEntry = player.queue.current ? history[1] : history[0];
        if (!fallbackEntry) {
            embed.setDescription("No previous song found in session or server history.");
            return safeEditReply(interaction, { embeds: [embed] });
        }

        const hydrated = hydrateStoredTrack(client, fallbackEntry, interaction.user);
        await Promise.resolve(player.play(hydrated));
        embed.setDescription(`⏮️ Playing from history: **${truncateText(fallbackEntry.title, 50)}**.`);

        return safeEditReply(interaction, { embeds: [embed] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
