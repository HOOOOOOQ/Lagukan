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
    name: "search",
    description: "Search songs by title or artist and choose from an interactive menu",
    category: "music",
    options: [
        {
            name: "query",
            description: "Song title or artist name (e.g., Teh Hijau, Hivi Remaja, Sheila On 7 Dan)",
            type: 3,
            required: true,
        },
        {
            name: "source",
            description: "Preferred music search source",
            type: 3,
            required: false,
            choices: [
                { name: "Auto (Smart Fallback)", value: "auto" },
                { name: "YouTube Music", value: "youtubeMusic" },
                { name: "YouTube", value: "youtube" },
                { name: "SoundCloud", value: "soundcloud" },
            ],
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

        const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const query = interaction.options.getString("query");
        const preferredEngine = interaction.options.getString("source") || "auto";

        const result = await smartSearch(client, query, {
            requester: interaction.user,
            preferredEngine,
        });

        if (!result || !Array.isArray(result.tracks) || result.tracks.length === 0) {
            embed.setDescription(result?.error || "No matching songs found.");
            return safeEditReply(interaction, { embeds: [embed] });
        }

        if (result.type === "PLAYLIST") {
            return enqueuePlaylistAndRespond(client, interaction, result);
        }

        if (result.tracks.length === 1) {
            return enqueueSingleTrackAndRespond(client, interaction, result.tracks[0]);
        }

        return presentSearchSelectMenu(client, interaction, query, result.tracks);
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
