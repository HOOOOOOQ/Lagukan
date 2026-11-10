const { EmbedBuilder, MessageFlags } = require("discord.js");
const { createPage } = require("../../../functions/createPage.js");
const { convertTime } = require("../../../functions/timeFormat.js");
const { safeReply } = require("../../../functions/interactionResponder.js");
const lodash = require("lodash");

module.exports = {
    name: "queue",
    description: "Show the Lagukan queue list",
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
        const botName = client.config.botName || "Lagukan";
        const embed = new EmbedBuilder().setColor(client.config.embedColor);
        const formatString = (str, maxLength) => (str.length > maxLength ? str.substr(0, maxLength - 3) + "..." : str);

        if (player.queue.isEmpty) {
            embed.setDescription(`The queue is empty.`);

            return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        const queueList = player.queue.map((track, index) => {
            const trackUrl = track.uri;
            const trackTitles = formatString(track.title || "Unknown Title", 30).replace(/ - Topic$/, "") || "Unknown Title";
            const trackArtists = formatString(track.author || "Unknown Author", 25).replace(/ - Topic$/, "") || "Unknown Author";
            const trackDuration = track.isStream ? "LIVE" : convertTime(track.duration);

            return `\`${index + 1}.\` **[${trackTitles} - ${trackArtists}](${trackUrl})**  •  \`${trackDuration}\``;
        });

        embed
            .setAuthor({ name: `${botName} Queue List`, iconURL: client.user.displayAvatarURL() })
            .setColor(client.config.embedColor)
            .setThumbnail(interaction.guild.iconURL())
            .setFooter({
                text: `${botName} Music Bot  •  Total Songs: ${player.queue.size}  •  Total Duration: ${convertTime(player.queue.duration)}`,
                iconURL: client.user.displayAvatarURL(),
            });

        const pages = lodash.chunk(queueList, 10).map((s) => s.join("\n"));

        return createPage(client, interaction, embed, pages);
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
