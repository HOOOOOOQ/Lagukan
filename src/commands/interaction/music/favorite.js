const { ActionRowBuilder, ApplicationCommandOptionType, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require("discord.js");
const lodash = require("lodash");
const { convertTime } = require("../../../functions/timeFormat.js");
const { createPage } = require("../../../functions/createPage.js");
const { checkSearchRateLimit, smartSearch, hydrateStoredTrack, enqueueTracksStaged } = require("../../../functions/musicSourceResolver.js");
const {
    getUserFavorites,
    addUserFavorite,
    removeUserFavorite,
    clearUserFavorites,
    getOrCreateGuildPlayer,
} = require("../../../functions/musicPermissions.js");
const { refreshNowPlayingDashboard, truncateText } = require("../../../functions/nowPlayingManager.js");
const { getGuildPlayer } = require("../../../functions/voiceSessionManager.js");
const { safeDeferReply, safeEditReply, safeDeferUpdate } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "favorite",
    description: "Save, view, and play your favorite songs across servers",
    category: "music",
    options: [
        {
            name: "add",
            description: "Save the currently playing song or a searched song to your favorites",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "query",
                    description: "Optional song title or URL (omit to save the currently playing track)",
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
            ],
        },
        {
            name: "list",
            description: "View all songs in your personal favorites list",
            type: ApplicationCommandOptionType.Subcommand,
        },
        {
            name: "play",
            description: "Play a specific favorite song or load all your favorites into queue",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "position",
                    description: "Optional favorite number to play (omit to load all favorites)",
                    type: ApplicationCommandOptionType.Integer,
                    min_value: 1,
                    required: false,
                },
                {
                    name: "shuffle",
                    description: "Shuffle your favorites when loading all",
                    type: ApplicationCommandOptionType.Boolean,
                    required: false,
                },
            ],
        },
        {
            name: "remove",
            description: "Remove a song from your favorites list",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "position",
                    description: "Track position in /favorite list",
                    type: ApplicationCommandOptionType.Integer,
                    min_value: 1,
                    required: true,
                },
            ],
        },
        {
            name: "clear",
            description: "Clear all songs from your favorites list (with confirmation)",
            type: ApplicationCommandOptionType.Subcommand,
        },
    ],
    permissions: {
        bot: [],
        user: [],
    },
    settings: {
        voice: false,
        player: false,
        current: false,
    },
    devOnly: false,
    run: async (client, interaction) => {
        const sub = interaction.options.getSubcommand();
        const embedColor = client.config.embedColor;
        const botName = client.config.botName || "Lagukan";
        const embed = new EmbedBuilder().setColor(embedColor);

        if (sub === "add") {
            const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) return;

            const query = interaction.options.getString("query")?.trim() || "";
            let targetTrack = null;

            if (!query) {
                const activePlayer = getGuildPlayer(client, interaction.guildId);
                if (!activePlayer?.queue?.current) {
                    embed.setDescription("No track is currently playing. Pass a `query` or start playing a song first.");
                    return safeEditReply(interaction, { embeds: [embed] });
                }
                targetTrack = activePlayer.queue.current;
            } else {
                const rate = checkSearchRateLimit(interaction.user.id);
                if (!rate.allowed) {
                    embed.setDescription(`Please wait \`${Math.ceil(rate.retryAfterMs / 1000)}s\` before searching again.`);
                    return safeEditReply(interaction, { embeds: [embed] });
                }
                const res = await smartSearch(client, query, { requester: interaction.user });
                if (!res?.tracks?.length) {
                    embed.setDescription(res?.error || "Could not find a matching track.");
                    return safeEditReply(interaction, { embeds: [embed] });
                }
                targetTrack = res.tracks[0];
            }

            const result = await addUserFavorite(client, interaction.user, targetTrack);
            if (result.status === "exists") {
                embed.setDescription(`❤️ **${truncateText(targetTrack.title, 50)}** is already in your favorites.`);
            } else if (result.status === "limit") {
                embed.setDescription(`Your favorites list is full (maximum \`${result.max}\` tracks).`);
            } else {
                embed.setDescription(
                    `❤️ Added **${truncateText(targetTrack.title, 50)}** — *${truncateText(targetTrack.author, 35)}* to your favorites (\`${result.favorites.length}\` saved).`,
                );
            }
            return safeEditReply(interaction, { embeds: [embed] });
        }

        if (sub === "list") {
            const favorites = await getUserFavorites(client, interaction.user);
            if (!favorites.length) {
                const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
                if (!deferred) return;
                embed.setDescription("Your favorites list is empty. Click ❤️ on the Now Playing dashboard or use `/favorite add`.");
                return safeEditReply(interaction, { embeds: [embed] });
            }

            const totalDur = favorites.reduce((a, t) => a + Number(t.duration || 0), 0);
            const lines = favorites.map((t, i) => {
                const dur = t.isStream ? "LIVE" : convertTime(t.duration || 0);
                return `\`${i + 1}.\` **[${truncateText(t.title, 40)}](${t.uri})** — *${truncateText(t.author, 25)}* • \`${dur}\``;
            });

            embed
                .setAuthor({
                    name: `${botName} • ${interaction.user.username}'s Favorites`,
                    iconURL: interaction.user.displayAvatarURL?.(),
                })
                .setFooter({
                    text: `Total Favorites: ${favorites.length} • Total Duration: ${convertTime(totalDur)}`,
                });

            const pages = lodash.chunk(lines, 10).map((c) => c.join("\n"));
            return createPage(client, interaction, embed, pages);
        }

        if (sub === "play") {
            const voiceChannel = interaction.member?.voice?.channel;
            if (!voiceChannel) {
                const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
                if (!deferred) return;
                embed.setDescription("You need to join a voice channel first.");
                return safeEditReply(interaction, { embeds: [embed] });
            }

            const deferred = await safeDeferReply(interaction);
            if (!deferred) return;

            const favorites = await getUserFavorites(client, interaction.user);
            if (!favorites.length) {
                embed.setDescription("You don't have any saved favorite songs yet.");
                return safeEditReply(interaction, { embeds: [embed] });
            }

            const pos = interaction.options.getInteger("position");
            const shouldShuffle = Boolean(interaction.options.getBoolean("shuffle"));

            if (pos !== null && (pos < 1 || pos > favorites.length)) {
                embed.setDescription(`Position must be between \`1\` and \`${favorites.length}\`.`);
                return safeEditReply(interaction, { embeds: [embed] });
            }

            let player;
            try {
                player = await getOrCreateGuildPlayer(client, {
                    guild: interaction.guild,
                    voiceChannelId: voiceChannel.id,
                    textChannelId: interaction.channelId,
                });
            } catch (err) {
                embed.setDescription(err?.message || "Could not connect to voice channel.");
                return safeEditReply(interaction, { embeds: [embed] });
            }

            if (player.voiceId && player.voiceId !== voiceChannel.id) {
                embed.setDescription(`You need to be in <#${player.voiceId}> to queue favorites.`);
                return safeEditReply(interaction, { embeds: [embed] });
            }

            if (pos !== null) {
                const selected = favorites[pos - 1];
                const track = hydrateStoredTrack(client, selected, interaction.user);
                player.queue.add(track);
                if (!player.playing && !player.paused) {
                    await Promise.resolve(player.play());
                } else {
                    await refreshNowPlayingDashboard(client, player).catch(() => {});
                }
                embed.setDescription(`❤️ Queued favorite \`#${pos}\`: **${truncateText(selected.title, 50)}**.`);
                return safeEditReply(interaction, { embeds: [embed] });
            }

            let tracks = favorites.map((item) => hydrateStoredTrack(client, item, interaction.user));
            if (shouldShuffle && tracks.length > 1) {
                tracks = lodash.shuffle(tracks);
                player.data?.set?.("shuffled", true);
            }

            const staged = enqueueTracksStaged(client, player, tracks, { chunkSize: 50 });
            if (!player.playing && !player.paused) {
                await Promise.resolve(player.play());
            } else {
                await refreshNowPlayingDashboard(client, player).catch(() => {});
            }

            embed.setDescription(`❤️ Queued **\`${staged.totalScheduled}\`** favorite track(s)${shouldShuffle ? " *(shuffled)*" : ""}.`);
            return safeEditReply(interaction, { embeds: [embed] });
        }

        if (sub === "remove") {
            const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) return;

            const pos = interaction.options.getInteger("position");
            const res = await removeUserFavorite(client, interaction.user, pos);
            if (res.status !== "removed") {
                embed.setDescription(
                    res.favorites.length
                        ? `Position must be between \`1\` and \`${res.favorites.length}\`.`
                        : "Your favorites list is empty.",
                );
                return safeEditReply(interaction, { embeds: [embed] });
            }

            embed.setDescription(`Removed **${truncateText(res.removed?.title, 50)}** from your favorites.`);
            return safeEditReply(interaction, { embeds: [embed] });
        }

        if (sub === "clear") {
            const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) return;

            const favorites = await getUserFavorites(client, interaction.user);
            if (!favorites.length) {
                embed.setDescription("Your favorites list is already empty.");
                return safeEditReply(interaction, { embeds: [embed] });
            }

            embed.setDescription(`Clear all **\`${favorites.length}\`** songs from your favorites permanently?`);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("fav_clear:confirm").setLabel("Clear All Favorites").setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId("fav_clear:cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
            );

            const msg = await safeEditReply(interaction, { embeds: [embed], components: [row] });
            if (!msg || typeof msg.createMessageComponentCollector !== "function") return;

            const collector = msg.createMessageComponentCollector({ time: 30000 });
            let done = false;

            collector.on("collect", (btn) => {
                void (async () => {
                    if (btn.user.id !== interaction.user.id) return;
                    const ack = await safeDeferUpdate(btn);
                    if (!ack) return;
                    done = true;
                    collector.stop();

                    if (btn.customId === "fav_clear:cancel") {
                        embed.setDescription("Favorites clear cancelled.");
                        await safeEditReply(interaction, { embeds: [embed], components: [] });
                        return;
                    }

                    await clearUserFavorites(client, interaction.user);
                    embed.setDescription("Cleared all songs from your favorites list.");
                    await safeEditReply(interaction, { embeds: [embed], components: [] });
                })().catch(() => {});
            });

            collector.on("end", () => {
                if (done) return;
                embed.setDescription("Favorites clear confirmation timed out.");
                safeEditReply(interaction, { embeds: [embed], components: [] }).catch(() => {});
            });
        }
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
