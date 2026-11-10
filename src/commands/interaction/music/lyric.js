const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { find } = require("llyrics");
const gsearch = require("google-search-url");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "lyric",
    description: "Get the lyrics of the current song",
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
        const deferred = await safeDeferReply(interaction);
        if (!deferred) return;

        const botName = client.config.botName || "Lagukan";
        const embed = new EmbedBuilder().setColor(client.config.embedColor);
        const formatText = (text) =>
            String(text || "")
                .replace(/\(.*?\)/gi, "")
                .replace(/\s/g, "-")
                .replace(/['",]/g, "")
                .replace(/ - Topic$/, "")
                .toLowerCase();

        const track = player.queue.current;
        const trackTitle = formatText(track.title);
        const trackArtist = formatText(track.author);
        const lyricText = await lyricFind(trackTitle, trackArtist);

        if (!lyricText) {
            embed.setDescription(`No lyrics found. Please try again later.`);
            return safeEditReply(interaction, { embeds: [embed] });
        }

        if (lyricText.length <= 4096) {
            embed
                .setAuthor({
                    name: `${botName} Lyrics`,
                    iconURL: client.user.displayAvatarURL(),
                })
                .setThumbnail(track.artworkUrl)
                .setDescription(lyricText);

            return safeEditReply(interaction, { embeds: [embed] });
        }

        embed
            .setAuthor({
                name: `${botName} Lyrics`,
                iconURL: client.user.displayAvatarURL(),
            })
            .setThumbnail(track.artworkUrl)
            .setDescription(lyricText.substring(0, 4096));

        const lyricUrl = gsearch.craft({ query: `${trackTitle} ${trackArtist} lyrics` }).url;
        const lyricButton = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setURL(lyricUrl.replace("http:", "https:")).setLabel("Full Lyrics").setStyle(ButtonStyle.Link),
        );

        return safeEditReply(interaction, { embeds: [embed], components: [lyricButton] });
    },
};

async function lyricFind(title, author) {
    try {
        const response = await find({
            song: title,
            artist: author,
            engine: "youtube",
            forceSearch: true,
        });
        return response?.lyrics || null;
    } catch {
        return null;
    }
}

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
