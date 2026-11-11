const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } = require("discord.js");
const { convertTime } = require("./timeFormat.js");
const { formatTrackSourceLabel, enqueueTracksStaged } = require("./musicSourceResolver.js");
const { getOrCreateGuildPlayer } = require("./musicPermissions.js");
const { refreshNowPlayingDashboard, truncateText } = require("./nowPlayingManager.js");
const { safeEditReply, safeDeferUpdate, safeReply } = require("./interactionResponder.js");
const { MessageFlags } = require("discord.js");

async function enqueueSingleTrackAndRespond(client, interaction, track) {
    const embedColor = client.config.embedColor;
    const voiceChannel = interaction.member?.voice?.channel;

    if (!voiceChannel) {
        const noVcEmbed = new EmbedBuilder().setColor(embedColor).setDescription("You need to join a voice channel first.");
        return safeEditReply(interaction, { embeds: [noVcEmbed], components: [] });
    }

    const player = await getOrCreateGuildPlayer(client, {
        guild: interaction.guild,
        voiceChannelId: voiceChannel.id,
        textChannelId: interaction.channelId,
    });

    if (player.voiceId && player.voiceId !== voiceChannel.id) {
        const diffVcEmbed = new EmbedBuilder()
            .setColor(embedColor)
            .setDescription(`You need to be in <#${player.voiceId}> to add tracks to the active session.`);
        return safeEditReply(interaction, { embeds: [diffVcEmbed], components: [] });
    }

    const wasPlaying = Boolean(player.playing || (player.paused && player.queue.current));
    player.queue.add(track);

    if (!player.playing && !player.paused) {
        await Promise.resolve(player.play());
    } else if (wasPlaying) {
        await refreshNowPlayingDashboard(client, player).catch(() => {});
    }

    const dur = track.isStream ? "LIVE" : convertTime(track.duration || 0);
    const sourceLabel = formatTrackSourceLabel(track);
    const displayUrl = track.pluginInfo?.originalUri || track.uri;
    const title = truncateText(track.title || "Unknown Title", 60);
    const artist = truncateText(track.author || "Unknown Artist", 45);

    const addedEmbed = new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({
            name: wasPlaying ? "Added to Queue" : "Loading Track",
            iconURL: client.user?.displayAvatarURL?.(),
        })
        .setDescription(`${displayUrl ? `**[${title}](${displayUrl})**` : `**${title}**`}\nby **${artist}**`)
        .addFields(
            { name: "Duration", value: `\`${dur}\``, inline: true },
            { name: "Source", value: `\`${sourceLabel}\``, inline: true },
            {
                name: "Queue Position",
                value: wasPlaying ? `\`#${player.queue.size}\`` : "`Now Playing`",
                inline: true,
            },
        );

    if (track.artworkUrl && /^https?:\/\//i.test(String(track.artworkUrl))) {
        addedEmbed.setThumbnail(track.artworkUrl);
    }

    return safeEditReply(interaction, { embeds: [addedEmbed], components: [] });
}

async function enqueuePlaylistAndRespond(client, interaction, searchResult) {
    const embedColor = client.config.embedColor;
    const voiceChannel = interaction.member?.voice?.channel;

    if (!voiceChannel) {
        const noVcEmbed = new EmbedBuilder().setColor(embedColor).setDescription("You need to join a voice channel first.");
        return safeEditReply(interaction, { embeds: [noVcEmbed], components: [] });
    }

    const player = await getOrCreateGuildPlayer(client, {
        guild: interaction.guild,
        voiceChannelId: voiceChannel.id,
        textChannelId: interaction.channelId,
    });

    if (player.voiceId && player.voiceId !== voiceChannel.id) {
        const diffVcEmbed = new EmbedBuilder()
            .setColor(embedColor)
            .setDescription(`You need to be in <#${player.voiceId}> to add playlists to the active session.`);
        return safeEditReply(interaction, { embeds: [diffVcEmbed], components: [] });
    }

    const staged = enqueueTracksStaged(client, player, searchResult.tracks, { chunkSize: 50 });

    if (!player.playing && !player.paused) {
        await Promise.resolve(player.play());
    } else {
        await refreshNowPlayingDashboard(client, player).catch(() => {});
    }

    const totalDurationMs = searchResult.tracks.slice(0, staged.totalScheduled).reduce((acc, t) => acc + Number(t.duration || 0), 0);
    const firstTrack = searchResult.tracks[0];
    const sourceLabel = formatTrackSourceLabel(firstTrack);

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({
            name: "Playlist Queued",
            iconURL: client.user?.displayAvatarURL?.(),
        })
        .setTitle(truncateText(searchResult.playlistName || "Music Playlist", 80))
        .setDescription(
            `Queued **\`${staged.totalScheduled}\`** tracks${staged.truncatedCount > 0 ? ` *(capped from ${searchResult.tracks.length} tracks)*` : ""}.` +
                (searchResult.isMetadataMirrored
                    ? `\n*Metadata resolved from **${searchResult.sourcePlatform === "deezer" ? "Deezer" : "Spotify"}** — audio streamed via supported Lavalink sources.*`
                    : ""),
        )
        .addFields(
            { name: "Tracks Added", value: `\`${staged.totalScheduled}\``, inline: true },
            { name: "Total Duration", value: `\`${convertTime(totalDurationMs)}\``, inline: true },
            { name: "Source", value: `\`${sourceLabel}\``, inline: true },
        );

    if (firstTrack?.artworkUrl && /^https?:\/\//i.test(String(firstTrack.artworkUrl))) {
        embed.setThumbnail(firstTrack.artworkUrl);
    }

    return safeEditReply(interaction, { embeds: [embed], components: [] });
}

/**
 * Displays an interactive Select Menu for multi-result text searches, showing title, artist,
 * duration, thumbnail, and source, with instant 1-click Top Match play support.
 */
async function presentSearchSelectMenu(client, interaction, query, tracks) {
    const embedColor = client.config.embedColor;
    const botName = client.config.botName || "Lagukan";
    const candidates = tracks.slice(0, 10);
    const topTrack = candidates[0];

    const listLines = candidates.map((t, index) => {
        const dur = t.isStream ? "LIVE" : convertTime(t.duration || 0);
        const src = formatTrackSourceLabel(t);
        const title = truncateText(t.title, 44);
        const artist = truncateText(t.author, 28);
        return `\`${index + 1}.\` **${title}** — *${artist}* (\`${dur}\` • \`${src}\`)`;
    });

    const searchEmbed = new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({
            name: `${botName} • Search Results`,
            iconURL: client.user?.displayAvatarURL?.(),
        })
        .setTitle(`Results for "${truncateText(query, 60)}"`)
        .setDescription(listLines.join("\n"))
        .setFooter({
            text: "Select a song from the menu below or click Play #1 Now (expires in 60s)",
        });

    if (topTrack?.artworkUrl && /^https?:\/\//i.test(String(topTrack.artworkUrl))) {
        searchEmbed.setThumbnail(topTrack.artworkUrl);
    }

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("music_search:select")
        .setPlaceholder("Choose a track to play...")
        .addOptions(
            candidates.map((t, index) => {
                const dur = t.isStream ? "LIVE" : convertTime(t.duration || 0);
                const src = formatTrackSourceLabel(t);
                return {
                    label: `${index + 1}. ${truncateText(t.title, 85)}`.slice(0, 100),
                    description: `${truncateText(t.author, 45)} • ${dur} • ${src}`.slice(0, 100),
                    value: String(index),
                };
            }),
        );

    const rowSelect = new ActionRowBuilder().addComponents(selectMenu);
    const rowButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("music_search:first").setLabel("Play #1 Now").setEmoji("▶️").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("music_search:cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    );

    const msg = await safeEditReply(interaction, {
        embeds: [searchEmbed],
        components: [rowSelect, rowButtons],
    });

    if (!msg || typeof msg.createMessageComponentCollector !== "function") {
        return;
    }

    const collector = msg.createMessageComponentCollector({ time: 60000 });
    let resolved = false;

    collector.on("collect", (comp) => {
        void (async () => {
            if (comp.user.id !== interaction.user.id) {
                const warn = new EmbedBuilder()
                    .setColor(embedColor)
                    .setDescription("Only the user who ran this search can select a result.");
                await safeReply(comp, { embeds: [warn], flags: MessageFlags.Ephemeral });
                return;
            }

            const ack = await safeDeferUpdate(comp);
            if (!ack) return;

            if (comp.customId === "music_search:cancel") {
                resolved = true;
                collector.stop("cancelled");
                const cancelledEmbed = new EmbedBuilder().setColor(embedColor).setDescription("Search selection cancelled.");
                await safeEditReply(interaction, { embeds: [cancelledEmbed], components: [] });
                return;
            }

            const chosenIndex = comp.customId === "music_search:first" ? 0 : Number.parseInt(comp.values?.[0] ?? "0", 10);
            const selectedTrack = candidates[chosenIndex] || candidates[0];

            resolved = true;
            collector.stop("selected");
            await enqueueSingleTrackAndRespond(client, interaction, selectedTrack);
        })().catch(async (err) => {
            const errEmbed = new EmbedBuilder()
                .setColor(0xff4757)
                .setDescription(`Could not start playback: ${err?.message || "Unknown error"}`);
            await safeEditReply(interaction, { embeds: [errEmbed], components: [] });
        });
    });

    collector.on("end", () => {
        if (resolved) return;
        const expiredEmbed = new EmbedBuilder()
            .setColor(embedColor)
            .setDescription("Search selection timed out. Run `/play` or `/search` again.");
        safeEditReply(interaction, { embeds: [expiredEmbed], components: [] }).catch(() => {});
    });
}

module.exports = {
    enqueueSingleTrackAndRespond,
    enqueuePlaylistAndRespond,
    presentSearchSelectMenu,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
