const { ActionRowBuilder, ApplicationCommandOptionType, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require("discord.js");
const lodash = require("lodash");
const { convertTime } = require("../../../functions/timeFormat.js");
const { createPage } = require("../../../functions/createPage.js");
const { checkSearchRateLimit, smartSearch, hydrateStoredTrack, enqueueTracksStaged } = require("../../../functions/musicSourceResolver.js");
const {
    canManageServerPlaylist,
    createSavedPlaylist,
    renameSavedPlaylist,
    listSavedPlaylists,
    getSavedPlaylist,
    addTracksToPlaylist,
    removeTrackFromPlaylist,
    deleteSavedPlaylist,
    getOrCreateGuildPlayer,
    isPlayerActivelyPlayingOrPausedTrack,
    startPlayerIfIdle,
} = require("../../../functions/musicPermissions.js");
const { refreshNowPlayingDashboard, ensureNowPlayingDashboardVisible, truncateText } = require("../../../functions/nowPlayingManager.js");
const { getGuildPlayer } = require("../../../functions/voiceSessionManager.js");
const { recordTrackRequest } = require("../../../functions/musicStatsEngine.js");
const { safeDeferReply, safeEditReply, safeDeferUpdate } = require("../../../functions/interactionResponder.js");

const SCOPE_OPTION = {
    name: "scope",
    description: "Personal playlist (yours across servers) or Server playlist (shared in this server)",
    type: ApplicationCommandOptionType.String,
    required: false,
    choices: [
        { name: "Personal Playlist", value: "personal" },
        { name: "Server Playlist", value: "server" },
    ],
};

module.exports = {
    name: "playlist",
    description: "Manage and play Personal or Server playlists",
    category: "music",
    options: [
        {
            name: "create",
            description: "Create a new Personal or Server playlist",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "name",
                    description: "Playlist name (1-50 characters)",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
                SCOPE_OPTION,
                {
                    name: "description",
                    description: "Optional short playlist description",
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
            ],
        },
        {
            name: "add",
            description: "Add the currently playing song or a searched song/link to a playlist",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "name",
                    description: "Target playlist name",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
                {
                    name: "query",
                    description: "Song title or URL (omit to add the currently playing track)",
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
                SCOPE_OPTION,
            ],
        },
        {
            name: "savequeue",
            description: "Save the active song and upcoming queue into an existing or new playlist",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "name",
                    description: "Target playlist name",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
                SCOPE_OPTION,
            ],
        },
        {
            name: "load",
            description: "Load and play a saved Personal or Server playlist",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "name",
                    description: "Playlist name to play",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
                SCOPE_OPTION,
                {
                    name: "shuffle",
                    description: "Shuffle tracks before playing",
                    type: ApplicationCommandOptionType.Boolean,
                    required: false,
                },
            ],
        },
        {
            name: "play",
            description: "Play a saved Personal or Server playlist",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "name",
                    description: "Playlist name to play",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
                SCOPE_OPTION,
                {
                    name: "shuffle",
                    description: "Shuffle tracks before playing",
                    type: ApplicationCommandOptionType.Boolean,
                    required: false,
                },
            ],
        },
        {
            name: "view",
            description: "View all tracks inside a saved playlist",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "name",
                    description: "Playlist name",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
                SCOPE_OPTION,
            ],
        },
        {
            name: "list",
            description: "List all saved Personal or Server playlists",
            type: ApplicationCommandOptionType.Subcommand,
            options: [SCOPE_OPTION],
        },
        {
            name: "remove",
            description: "Remove a track by position from a playlist",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "name",
                    description: "Playlist name",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
                {
                    name: "position",
                    description: "Track number in playlist (1, 2, 3...)",
                    type: ApplicationCommandOptionType.Integer,
                    min_value: 1,
                    required: true,
                },
                SCOPE_OPTION,
            ],
        },
        {
            name: "delete",
            description: "Delete a saved playlist (with confirmation)",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "name",
                    description: "Playlist name to delete",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
                SCOPE_OPTION,
            ],
        },
        {
            name: "rename",
            description: "Rename an existing Personal or Server playlist",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "name",
                    description: "Current playlist name",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
                {
                    name: "new_name",
                    description: "New playlist name (1-50 characters)",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
                SCOPE_OPTION,
            ],
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
        const scope = interaction.options.getString("scope") || "personal";
        const embedColor = client.config.embedColor;
        const botName = client.config.botName || "Lagukan";
        const embed = new EmbedBuilder().setColor(embedColor);

        const isWriteAction = ["create", "rename", "add", "savequeue", "remove", "delete"].includes(sub);
        if (
            scope === "server" &&
            isWriteAction &&
            !canManageServerPlaylist(client, interaction.guild, interaction.member, interaction.user, interaction)
        ) {
            const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) return;
            embed.setDescription("Managing **Server Playlists** requires `Manage Server` permission or the configured Server DJ Role.");
            return safeEditReply(interaction, { embeds: [embed] });
        }

        if (sub === "rename") {
            const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) return;

            const oldName = interaction.options.getString("name");
            const newName = interaction.options.getString("new_name");
            const res = await renameSavedPlaylist(client, {
                scope,
                oldName,
                newName,
                userId: interaction.user.id,
                guildId: interaction.guildId,
            });

            if (!res.ok) {
                embed.setDescription(res.error);
                return safeEditReply(interaction, { embeds: [embed] });
            }

            embed.setDescription(`Renamed **${scope}** playlist **\`${res.previousName}\`** ➔ **\`${res.playlist.name}\`**.`);
            return safeEditReply(interaction, { embeds: [embed] });
        }

        if (sub === "create") {
            const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) return;

            const name = interaction.options.getString("name");
            const description = interaction.options.getString("description") || "";
            const res = await createSavedPlaylist(client, {
                scope,
                name,
                description,
                userId: interaction.user.id,
                guildId: interaction.guildId,
            });

            if (!res.ok) {
                embed.setDescription(res.error);
                return safeEditReply(interaction, { embeds: [embed] });
            }

            embed.setDescription(`Created **${scope}** playlist **\`${res.playlist.name}\`**. Add songs using \`/playlist add\`.`);
            return safeEditReply(interaction, { embeds: [embed] });
        }

        if (sub === "add") {
            const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) return;

            const name = interaction.options.getString("name");
            const query = interaction.options.getString("query")?.trim() || "";
            let tracksToAdd = [];

            if (!query) {
                const activePlayer = getGuildPlayer(client, interaction.guildId);
                if (!activePlayer?.queue?.current) {
                    embed.setDescription("No track is currently playing. Provide a `query` (song title or URL) or start playback first.");
                    return safeEditReply(interaction, { embeds: [embed] });
                }
                tracksToAdd = [activePlayer.queue.current];
            } else {
                const rate = checkSearchRateLimit(interaction.user.id);
                if (!rate.allowed) {
                    embed.setDescription(`Please wait \`${Math.ceil(rate.retryAfterMs / 1000)}s\` before searching again.`);
                    return safeEditReply(interaction, { embeds: [embed] });
                }
                const searchRes = await smartSearch(client, query, { requester: interaction.user });
                if (!searchRes?.tracks?.length) {
                    embed.setDescription(searchRes?.error || "No tracks found for that query.");
                    return safeEditReply(interaction, { embeds: [embed] });
                }
                tracksToAdd = searchRes.type === "PLAYLIST" ? searchRes.tracks : [searchRes.tracks[0]];
            }

            const addRes = await addTracksToPlaylist(client, {
                scope,
                name,
                tracks: tracksToAdd,
                userId: interaction.user.id,
                guildId: interaction.guildId,
            });

            if (!addRes.ok) {
                embed.setDescription(addRes.error);
                return safeEditReply(interaction, { embeds: [embed] });
            }

            embed.setDescription(
                addRes.addedCount === 1
                    ? `Added **${truncateText(tracksToAdd[0].title, 50)}** to ${scope} playlist **\`${addRes.playlist.name}\`** (\`${addRes.playlist.tracks.length}\` total tracks).`
                    : `Added **\`${addRes.addedCount}\`** tracks to ${scope} playlist **\`${addRes.playlist.name}\`** (\`${addRes.playlist.tracks.length}\` total tracks).`,
            );
            return safeEditReply(interaction, { embeds: [embed] });
        }

        if (sub === "savequeue") {
            const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) return;

            const activePlayer = getGuildPlayer(client, interaction.guildId);
            if (!activePlayer || (!activePlayer.queue.current && activePlayer.queue.isEmpty)) {
                embed.setDescription("There is no active queue to save right now.");
                return safeEditReply(interaction, { embeds: [embed] });
            }

            const name = interaction.options.getString("name");
            let existing = await getSavedPlaylist(client, {
                scope,
                name,
                userId: interaction.user.id,
                guildId: interaction.guildId,
            });

            if (!existing) {
                const created = await createSavedPlaylist(client, {
                    scope,
                    name,
                    description: "Saved from server queue",
                    userId: interaction.user.id,
                    guildId: interaction.guildId,
                });
                if (!created.ok) {
                    embed.setDescription(created.error);
                    return safeEditReply(interaction, { embeds: [embed] });
                }
                existing = created.playlist;
            }

            const allQueueTracks = [...(activePlayer.queue.current ? [activePlayer.queue.current] : []), ...activePlayer.queue];

            const saved = await addTracksToPlaylist(client, {
                scope,
                name: existing.name,
                tracks: allQueueTracks,
                userId: interaction.user.id,
                guildId: interaction.guildId,
            });

            if (!saved.ok) {
                embed.setDescription(saved.error);
                return safeEditReply(interaction, { embeds: [embed] });
            }

            embed.setDescription(`Saved **\`${saved.addedCount}\`** track(s) from the active queue into **\`${saved.playlist.name}\`**.`);
            return safeEditReply(interaction, { embeds: [embed] });
        }

        if (sub === "load" || sub === "play") {
            const voiceChannel = interaction.member?.voice?.channel;
            if (!voiceChannel) {
                const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
                if (!deferred) return;
                embed.setDescription("You need to join a voice channel first.");
                return safeEditReply(interaction, { embeds: [embed] });
            }

            const deferred = await safeDeferReply(interaction);
            if (!deferred) return;

            const name = interaction.options.getString("name");
            const shouldShuffle = Boolean(interaction.options.getBoolean("shuffle"));

            const playlist = await getSavedPlaylist(client, {
                scope,
                name,
                userId: interaction.user.id,
                guildId: interaction.guildId,
            });

            if (!playlist) {
                embed.setDescription(`Playlist \`${name}\` was not found in ${scope} playlists.`);
                return safeEditReply(interaction, { embeds: [embed] });
            }

            if (!playlist.tracks?.length) {
                embed.setDescription(`Playlist **\`${playlist.name}\`** has no tracks yet.`);
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
                embed.setDescription(`You need to be in <#${player.voiceId}> to load playlists.`);
                return safeEditReply(interaction, { embeds: [embed] });
            }

            let hydrated = playlist.tracks.map((item) => hydrateStoredTrack(client, item, interaction.user));
            if (shouldShuffle && hydrated.length > 1) {
                hydrated = lodash.shuffle(hydrated);
                player.data?.set?.("shuffled", true);
            }

            const wasPlaying = isPlayerActivelyPlayingOrPausedTrack(player);
            const staged = enqueueTracksStaged(client, player, hydrated, { chunkSize: 50 });
            if (hydrated[0] && interaction.user?.id) {
                void recordTrackRequest(client, {
                    userId: interaction.user.id,
                    guildId: interaction.guildId,
                    track: hydrated[0],
                    requestOrigin: "playlist",
                }).catch(() => {});
            }

            if (!wasPlaying) {
                const outcome = await startPlayerIfIdle(client, player, {
                    guild: interaction.guild,
                    userId: interaction.user?.id,
                    command: "playlist_load",
                    waitForTrackStart: true,
                    timeoutMs: 9000,
                });
                if (!outcome.ok) {
                    embed.setDescription(`❌ Could not start playlist playback: ${outcome.error || "Unknown error"}`);
                    return safeEditReply(interaction, { embeds: [embed] });
                }
                await ensureNowPlayingDashboardVisible(client, player, outcome.track || hydrated[0]);
            } else {
                await refreshNowPlayingDashboard(client, player).catch(() => {});
            }

            const totalDur = playlist.tracks.reduce((acc, t) => acc + Number(t.duration || 0), 0);
            embed
                .setAuthor({ name: `${botName} • Playlist Loaded`, iconURL: client.user?.displayAvatarURL?.() })
                .setTitle(`${playlist.name} (${scope === "server" ? "Server" : "Personal"})`)
                .setDescription(
                    `Loaded **\`${staged.totalScheduled}\`** track(s)${shouldShuffle ? " *(shuffled)*" : ""} • Total Duration: \`${convertTime(totalDur)}\``,
                );

            return safeEditReply(interaction, { embeds: [embed] });
        }

        if (sub === "list") {
            const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) return;

            const playlists = await listSavedPlaylists(client, {
                scope,
                userId: interaction.user.id,
                guildId: interaction.guildId,
            });

            if (!playlists.length) {
                embed.setDescription(`No **${scope}** playlists saved yet. Create one with \`/playlist create\`.`);
                return safeEditReply(interaction, { embeds: [embed] });
            }

            const lines = playlists.map((pl, idx) => {
                const dur = pl.tracks.reduce((a, t) => a + Number(t.duration || 0), 0);
                return `\`${idx + 1}.\` **${pl.name}** — \`${pl.tracks.length}\` track(s) • \`${convertTime(dur)}\``;
            });

            embed
                .setAuthor({
                    name: `${botName} • ${scope === "server" ? "Server" : "Personal"} Playlists`,
                    iconURL: client.user?.displayAvatarURL?.(),
                })
                .setDescription(lines.join("\n"));

            return safeEditReply(interaction, { embeds: [embed] });
        }

        if (sub === "view") {
            const name = interaction.options.getString("name");
            const playlist = await getSavedPlaylist(client, {
                scope,
                name,
                userId: interaction.user.id,
                guildId: interaction.guildId,
            });

            if (!playlist) {
                const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
                if (!deferred) return;
                embed.setDescription(`Playlist \`${name}\` was not found in ${scope} playlists.`);
                return safeEditReply(interaction, { embeds: [embed] });
            }

            if (!playlist.tracks.length) {
                const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
                if (!deferred) return;
                embed.setTitle(playlist.name).setDescription("This playlist is empty. Add songs with `/playlist add`.");
                return safeEditReply(interaction, { embeds: [embed] });
            }

            const totalDur = playlist.tracks.reduce((a, t) => a + Number(t.duration || 0), 0);
            const lines = playlist.tracks.map((t, i) => {
                const dur = t.isStream ? "LIVE" : convertTime(t.duration || 0);
                return `\`${i + 1}.\` **[${truncateText(t.title, 40)}](${t.uri})** — *${truncateText(t.author, 25)}* • \`${dur}\``;
            });

            embed
                .setAuthor({
                    name: `${botName} • ${playlist.name} (${scope})`,
                    iconURL: client.user?.displayAvatarURL?.(),
                })
                .setFooter({
                    text: `Total Tracks: ${playlist.tracks.length} • Total Duration: ${convertTime(totalDur)}`,
                });

            const pages = lodash.chunk(lines, 10).map((chunkLines) => chunkLines.join("\n"));
            return createPage(client, interaction, embed, pages);
        }

        if (sub === "remove") {
            const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) return;

            const name = interaction.options.getString("name");
            const position = interaction.options.getInteger("position");
            const res = await removeTrackFromPlaylist(client, {
                scope,
                name,
                position,
                userId: interaction.user.id,
                guildId: interaction.guildId,
            });

            if (!res.ok) {
                embed.setDescription(res.error);
                return safeEditReply(interaction, { embeds: [embed] });
            }

            embed.setDescription(
                `Removed \`#${position}\` (**${truncateText(res.removed?.title, 50)}**) from **\`${res.playlist.name}\`**.`,
            );
            return safeEditReply(interaction, { embeds: [embed] });
        }

        if (sub === "delete") {
            const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) return;

            const name = interaction.options.getString("name");
            const existing = await getSavedPlaylist(client, {
                scope,
                name,
                userId: interaction.user.id,
                guildId: interaction.guildId,
            });

            if (!existing) {
                embed.setDescription(`Playlist \`${name}\` was not found in ${scope} playlists.`);
                return safeEditReply(interaction, { embeds: [embed] });
            }

            embed.setDescription(`Delete ${scope} playlist **\`${existing.name}\`** (\`${existing.tracks.length}\` track(s)) permanently?`);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("pl_del:confirm").setLabel("Delete Playlist").setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId("pl_del:cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
            );

            const msg = await safeEditReply(interaction, { embeds: [embed], components: [row] });
            if (!msg || typeof msg.createMessageComponentCollector !== "function") return;

            const collector = msg.createMessageComponentCollector({ time: 30000 });
            let finished = false;

            collector.on("collect", (btn) => {
                void (async () => {
                    if (btn.user.id !== interaction.user.id) return;
                    const ack = await safeDeferUpdate(btn);
                    if (!ack) return;
                    finished = true;
                    collector.stop();

                    if (btn.customId === "pl_del:cancel") {
                        embed.setDescription("Playlist deletion cancelled.");
                        await safeEditReply(interaction, { embeds: [embed], components: [] });
                        return;
                    }

                    await deleteSavedPlaylist(client, {
                        scope,
                        name: existing.name,
                        userId: interaction.user.id,
                        guildId: interaction.guildId,
                    });
                    embed.setDescription(`Deleted ${scope} playlist **\`${existing.name}\`**.`);
                    await safeEditReply(interaction, { embeds: [embed], components: [] });
                })().catch(() => {});
            });

            collector.on("end", () => {
                if (finished) return;
                embed.setDescription("Playlist deletion confirmation timed out.");
                safeEditReply(interaction, { embeds: [embed], components: [] }).catch(() => {});
            });
        }
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
