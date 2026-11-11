const { EmbedBuilder, MessageFlags } = require("discord.js");
const { cleanupStalePlayerIfDisconnected } = require("../../../functions/voiceSessionManager.js");
const { checkSearchRateLimit, smartSearch } = require("../../../functions/musicSourceResolver.js");
const {
    enqueueSingleTrackAndRespond,
    enqueuePlaylistAndRespond,
    presentSearchSelectMenu,
} = require("../../../functions/searchSelector.js");
const { safeDeferReply, safeEditReply, safeReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "play",
    description: "Play a song, playlist, or multi-platform link with Lagukan",
    category: "music",
    options: [
        {
            name: "query",
            description: "Song title, artist, or URL (YouTube, Spotify, SoundCloud, Deezer, Bandcamp, Direct Audio)",
            type: 3,
            required: true,
        },
        {
            name: "direct",
            description: "Play the top search match immediately without showing the selection menu",
            type: 5,
            required: false,
        },
    ],
    permissions: {
        bot: ["Speak", "Connect"],
        user: ["Speak", "Connect"],
    },
    settings: {
        voice: true,
        player: false,
        current: false,
    },
    devOnly: false,
    run: async (client, interaction, player) => {
        const botName = client.config.botName || "Lagukan";
        const embed = new EmbedBuilder().setColor(client.config.embedColor);

        const rateCheck = checkSearchRateLimit(interaction.user?.id);
        if (!rateCheck.allowed) {
            embed.setDescription(
                `You are searching too fast. Please wait \`${Math.ceil(rateCheck.retryAfterMs / 1000)}s\` before trying again.`,
            );
            return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        player = (await cleanupStalePlayerIfDisconnected(client, interaction.guild)) || null;

        if (player && player.voiceId !== interaction.member.voice.channelId) {
            embed.setDescription(`You must be in the same voice channel as ${botName}.`);
            return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        const deferred = await safeDeferReply(interaction);
        if (!deferred) return;

        const query = interaction.options.getString("query");
        const directPlay = Boolean(interaction.options.getBoolean("direct"));

        const result = await smartSearch(client, query, {
            requester: interaction.user,
        });

        if (!result || !Array.isArray(result.tracks) || result.tracks.length === 0) {
            embed.setDescription(result?.error || "No results found for your query.");
            return safeEditReply(interaction, { embeds: [embed] });
        }

        if (result.type === "PLAYLIST") {
            return enqueuePlaylistAndRespond(client, interaction, result);
        }

        if (result.detectedType === "text" && result.tracks.length > 1 && !directPlay) {
            return presentSearchSelectMenu(client, interaction, query, result.tracks);
        }

        return enqueueSingleTrackAndRespond(client, interaction, result.tracks[0]);
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
