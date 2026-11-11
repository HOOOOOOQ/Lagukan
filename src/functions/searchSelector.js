const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, StringSelectMenuBuilder } = require("discord.js");
const { convertTime } = require("./timeFormat.js");
const { formatTrackSourceLabel, enqueueTracksStaged } = require("./musicSourceResolver.js");
const { getOrCreateGuildPlayer, isPlayerActivelyPlayingOrPausedTrack, startPlayerIfIdle } = require("./musicPermissions.js");
const { refreshNowPlayingDashboard, ensureNowPlayingDashboardVisible, truncateText } = require("./nowPlayingManager.js");
const { safeEditReply, safeDeferUpdate, safeReply } = require("./interactionResponder.js");
const Logger = require("../utils/logger");

async function enqueueSingleTrackAndRespond(client, interaction, track) {
    const embedColor = client.config.embedColor;
    const botName = client.config.botName || "Lagukan";
    const voiceChannel = interaction.member?.voice?.channel;

    if (!voiceChannel) {
        const noVcEmbed = new EmbedBuilder().setColor(embedColor).setDescription("You need to join a voice channel first.");
        return safeEditReply(interaction, { embeds: [noVcEmbed], components: [] });
    }

    let player;
    try {
        player = await getOrCreateGuildPlayer(client, {
            guild: interaction.guild,
            voiceChannelId: voiceChannel.id,
            textChannelId: interaction.channelId,
        });
    } catch (err) {
        Logger.music("error", "Failed to create or join voice player", {
            guildId: interaction.guildId,
            userId: interaction.user?.id,
            command: "play",
            playerStatus: "voice_connect_failed",
            errorMessage: err,
        });
        const connErrEmbed = new EmbedBuilder()
            .setColor(0xff4757)
            .setAuthor({ name: `${botName} • Voice Connection Error`, iconURL: client.user?.displayAvatarURL?.() })
            .setDescription(`❌ ${err?.message || "Could not establish voice connection right now."}`);
        return safeEditReply(interaction, { embeds: [connErrEmbed], components: [] });
    }

    if (player.voiceId && player.voiceId !== voiceChannel.id) {
        const diffVcEmbed = new EmbedBuilder()
            .setColor(embedColor)
            .setDescription(`You need to be in <#${player.voiceId}> to add tracks to the active session.`);
        return safeEditReply(interaction, { embeds: [diffVcEmbed], components: [] });
    }

    const wasPlaying = isPlayerActivelyPlayingOrPausedTrack(player);
    player.queue.add(track);

    const dur = track.isStream ? "LIVE" : convertTime(track.duration || 0);
    const sourceLabel = formatTrackSourceLabel(track);
    const displayUrl = track.pluginInfo?.originalUri || track.uri;
    const title = truncateText(track.title || "Unknown Title", 60);
    const artist = truncateText(track.author || "Unknown Artist", 45);
    const titleLine = displayUrl ? `**[${title}](${displayUrl})**` : `**${title}**`;

    // Track queued while another track is already active -> update dashboard & reply "Added to Queue"
    if (wasPlaying) {
        await refreshNowPlayingDashboard(client, player).catch(() => {});

        const queuedEmbed = new EmbedBuilder()
            .setColor(embedColor)
            .setAuthor({
                name: "Added to Queue",
                iconURL: client.user?.displayAvatarURL?.(),
            })
            .setDescription(`${titleLine}\nby **${artist}**`)
            .addFields(
                { name: "Duration", value: `\`${dur}\``, inline: true },
                { name: "Source", value: `\`${sourceLabel}\``, inline: true },
                { name: "Queue Position", value: `\`#${player.queue.size}\``, inline: true },
            );

        if (track.artworkUrl && /^https?:\/\//i.test(String(track.artworkUrl))) {
            queuedEmbed.setThumbnail(track.artworkUrl);
        }

        return safeEditReply(interaction, { embeds: [queuedEmbed], components: [] });
    }

    // Player was idle -> show temporary "Loading Track..." ONLY while starting playback on Lavalink
    const loadingEmbed = new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({
            name: "⏳ Loading Track...",
            iconURL: client.user?.displayAvatarURL?.(),
        })
        .setDescription(`Preparing audio stream for ${titleLine}\nby **${artist}**...`);

    if (track.artworkUrl && /^https?:\/\//i.test(String(track.artworkUrl))) {
        loadingEmbed.setThumbnail(track.artworkUrl);
    }

    await safeEditReply(interaction, { embeds: [loadingEmbed], components: [] });

    const outcome = await startPlayerIfIdle(client, player, {
        guild: interaction.guild,
        userId: interaction.user?.id,
        command: "play",
        waitForTrackStart: true,
        timeoutMs: 9000,
    });

    if (!outcome.ok) {
        const failEmbed = new EmbedBuilder()
            .setColor(0xff4757)
            .setAuthor({
                name: `${botName} • Playback Failed`,
                iconURL: client.user?.displayAvatarURL?.(),
            })
            .setDescription(
                `❌ Could not play ${titleLine}.\n\n**Reason:** ${outcome.error || "Audio stream failed to initialize on Lavalink."}`,
            );
        return safeEditReply(interaction, { embeds: [failEmbed], components: [] });
    }

    const activeTrack = outcome.track || player.queue?.current || track;
    const dashboardMsg = await ensureNowPlayingDashboardVisible(client, player, activeTrack);
    const warningNote = Array.isArray(outcome.warnings) && outcome.warnings.length > 0 ? `\n\n⚠️ ${outcome.warnings.join("\n⚠️ ")}` : "";

    // If the live Now Playing Dashboard is visible in the same channel and there are no special warnings,
    // remove the temporary "Loading Track..." reply cleanly; otherwise replace it with "Started Playing".
    if (
        dashboardMsg &&
        String(player.textId) === String(interaction.channelId) &&
        !warningNote &&
        typeof interaction.deleteReply === "function"
    ) {
        const deleted = await interaction
            .deleteReply()
            .then(() => true)
            .catch(() => false);
        if (deleted) {
            return dashboardMsg;
        }
    }

    const startedEmbed = new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({
            name: "▶️ Started Playing",
            iconURL: client.user?.displayAvatarURL?.(),
        })
        .setDescription(`${titleLine}\nby **${artist}**${warningNote}`)
        .addFields(
            { name: "Duration", value: `\`${dur}\``, inline: true },
            { name: "Source", value: `\`${sourceLabel}\``, inline: true },
            { name: "Voice Channel", value: `<#${player.voiceId || voiceChannel.id}>`, inline: true },
        );

    if (track.artworkUrl && /^https?:\/\//i.test(String(track.artworkUrl))) {
        startedEmbed.setThumbnail(track.artworkUrl);
    }

    return safeEditReply(interaction, { embeds: [startedEmbed], components: [] });
}

async function enqueuePlaylistAndRespond(client, interaction, searchResult) {
    const embedColor = client.config.embedColor;
    const botName = client.config.botName || "Lagukan";
    const voiceChannel = interaction.member?.voice?.channel;

    if (!voiceChannel) {
        const noVcEmbed = new EmbedBuilder().setColor(embedColor).setDescription("You need to join a voice channel first.");
        return safeEditReply(interaction, { embeds: [noVcEmbed], components: [] });
    }

    let player;
    try {
        player = await getOrCreateGuildPlayer(client, {
            guild: interaction.guild,
            voiceChannelId: voiceChannel.id,
            textChannelId: interaction.channelId,
        });
    } catch (err) {
        const connErrEmbed = new EmbedBuilder()
            .setColor(0xff4757)
            .setAuthor({ name: `${botName} • Voice Connection Error`, iconURL: client.user?.displayAvatarURL?.() })
            .setDescription(`❌ ${err?.message || "Could not establish voice connection right now."}`);
        return safeEditReply(interaction, { embeds: [connErrEmbed], components: [] });
    }

    if (player.voiceId && player.voiceId !== voiceChannel.id) {
        const diffVcEmbed = new EmbedBuilder()
            .setColor(embedColor)
            .setDescription(`You need to be in <#${player.voiceId}> to add playlists to the active session.`);
        return safeEditReply(interaction, { embeds: [diffVcEmbed], components: [] });
    }

    const wasPlaying = isPlayerActivelyPlayingOrPausedTrack(player);
    const staged = enqueueTracksStaged(client, player, searchResult.tracks, { chunkSize: 50 });

    if (!wasPlaying) {
        const outcome = await startPlayerIfIdle(client, player, {
            guild: interaction.guild,
            userId: interaction.user?.id,
            command: "play_playlist",
            waitForTrackStart: true,
            timeoutMs: 9000,
        });

        if (!outcome.ok) {
            const failEmbed = new EmbedBuilder()
                .setColor(0xff4757)
                .setAuthor({ name: `${botName} • Playback Failed`, iconURL: client.user?.displayAvatarURL?.() })
                .setDescription(`❌ Could not start playlist playback.\n\n**Reason:** ${outcome.error || "Unknown error"}`);
            return safeEditReply(interaction, { embeds: [failEmbed], components: [] });
        }

        await ensureNowPlayingDashboardVisible(client, player, outcome.track || searchResult.tracks[0]);
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
