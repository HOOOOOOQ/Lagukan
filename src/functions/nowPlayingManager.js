const {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");
const { convertTime } = require("./timeFormat.js");
const { formatTrackSourceLabel, hydrateStoredTrack } = require("./musicSourceResolver.js");
const {
    checkDjAccess,
    isGuildAutoplayEnabled,
    setGuildAutoplay,
    addUserFavorite,
    getGuildTrackHistory,
    ensureGuildDataSync,
} = require("./musicPermissions.js");
const { handleLyricsCommand } = require("./lyricsProvider.js");
const { safeReply, safeDeferUpdate, safeEditReply } = require("./interactionResponder.js");
const { PLAYER_STATE_DESTROYED, getGuildPlayer } = require("./voiceSessionManager.js");
const { peekCachedGuildPremiumTheme } = require("./premiumSystem.js");
const { THEME_666, renderNowPlayingCard666 } = require("./cardRenderer666.js");
const { updateSessionNowPlayingMessageId } = require("./profileNotificationManager.js");
const Logger = require("../utils/logger");

const PROGRESS_BAR_SEGMENTS = 14;
const PROGRESS_UPDATE_THROTTLE_MS = 15000;

function truncateText(text, maxLen = 48) {
    const clean = String(text || "Unknown")
        .replace(/ - Topic$/i, "")
        .trim();
    if (clean.length <= maxLen) return clean;
    return `${clean.slice(0, maxLen - 3)}...`;
}

function buildProgressBar(positionMs, durationMs, isStream = false) {
    if (isStream || !durationMs || durationMs <= 0) {
        return "`🔴 LIVE STREAM`";
    }

    const clampedPos = Math.max(0, Math.min(Number(positionMs || 0), Number(durationMs)));
    const ratio = durationMs > 0 ? clampedPos / durationMs : 0;
    const indicatorIndex = Math.min(PROGRESS_BAR_SEGMENTS - 1, Math.max(0, Math.round(ratio * (PROGRESS_BAR_SEGMENTS - 1))));

    let bar = "";
    for (let i = 0; i < PROGRESS_BAR_SEGMENTS; i++) {
        if (i < indicatorIndex) bar += "▰";
        else if (i === indicatorIndex) bar += "🟣";
        else bar += "▱";
    }

    return `\`${convertTime(clampedPos)}\` ${bar} \`${convertTime(durationMs)}\``;
}

function formatRepeatLabel(loopMode) {
    if (loopMode === "song") return "🔂 Track";
    if (loopMode === "queue") return "🔁 Queue";
    return "Off";
}

function hasAnyPreviousTrack(client, player) {
    if (!player) return false;
    if (Array.isArray(player.queue?.previous) && player.queue.previous.length > 0) {
        return true;
    }
    const guildData = ensureGuildDataSync(client, player.guildId);
    const history = Array.isArray(guildData?.history) ? guildData.history : [];
    return player.queue?.current ? history.length > 1 : history.length > 0;
}

/**
 * Builds the complete Now Playing Dashboard embed displaying all 14 required state metrics:
 * Thumbnail, Title, Artist/Channel, Total Duration, Progress Bar, Elapsed Time, Remaining Time,
 * Music Source, Requester, Queue Count, Playback Status, Repeat Status, Shuffle Status, Autoplay Status.
 */
function buildNowPlayingEmbed(client, player, trackOverride = null) {
    const premiumTheme = player?.guildId ? peekCachedGuildPremiumTheme(player.guildId) : null;
    const botName = premiumTheme?.customDashboardTitle || client?.user?.username || client?.config?.botName || "Lagukan";
    const embedColor = premiumTheme?.customAccentColor || THEME_666.embedColor;
    const iconUrl = client?.user?.displayAvatarURL?.({ extension: "png", size: 128 }) || undefined;
    const track = trackOverride || player?.queue?.current;

    if (!player || !track) {
        return new EmbedBuilder().setColor(embedColor).setDescription("There is no song currently playing in this server.");
    }

    const title = truncateText(track.title || "Unknown Title", 58);
    const author = truncateText(track.author || "Unknown Artist", 42);
    const rawAlbum = track.pluginInfo?.albumName || track.albumName || track.album || null;
    const albumLabel = rawAlbum ? truncateText(rawAlbum, 38) : "Single / N/A";
    const displayUrl = track.pluginInfo?.originalUri || track.uri || null;
    const isStream = Boolean(track.isStream);
    const totalDurationMs = Math.max(0, Number(track.duration || 0));
    const elapsedMs = isStream
        ? Math.max(0, Number(player.position || 0))
        : Math.max(0, Math.min(Number(player.position || 0), totalDurationMs));
    const remainingMs = isStream ? 0 : Math.max(0, totalDurationMs - elapsedMs);

    const durationText = isStream ? "LIVE" : convertTime(totalDurationMs);
    const elapsedText = convertTime(elapsedMs);
    const remainingText = isStream ? "LIVE" : `-${convertTime(remainingMs)}`;
    const progressLine = buildProgressBar(elapsedMs, totalDurationMs, isStream);

    const sourceLabel = formatTrackSourceLabel(track);
    const requesterLabel = track.requester ? (track.requester.id ? `<@${track.requester.id}>` : String(track.requester)) : "Autoplay";

    const queueCount = Number(player.queue?.size || 0);
    const queueDurationMs = Number(player.queue?.duration || 0);
    const queueSummary = queueCount > 0 ? `\`${queueCount}\` track(s) • \`${convertTime(queueDurationMs)}\`` : "`0` track(s)";

    const isPaused = Boolean(player.paused && !player.playing) || Boolean(player.paused);
    const isShuffled = Boolean(player.data?.get?.("shuffled"));
    const repeatLabel = formatRepeatLabel(player.loop);
    const autoplayEnabled = isGuildAutoplayEnabled(client, player.guildId);
    const activeFilter = player.data?.get?.("activeFilter") || null;
    const isServerMuted = Boolean(player.data?.get?.("serverMuted"));

    const playbackStateLabel = isPaused ? "⏸️ Paused" : "▶️ Playing";
    const volumeValue = `${player.volume ?? 100}%${activeFilter ? ` • ${activeFilter}` : ""}`;

    const titleLine = displayUrl ? `**[${title}](${displayUrl})**` : `**${title}**`;
    const serverMuteAlert = isServerMuted
        ? "\n⚠️ **Bot sedang di-Server Mute di Discord!** Lepas *Server Mute* pada bot agar suara terdengar."
        : "";

    const embed = new EmbedBuilder()
        .setAuthor({
            name: isPaused ? `666 • ${botName} • Playback Paused` : `666 • ${botName} • Now Playing`,
            iconURL: iconUrl,
        })
        .setColor(embedColor)
        .setDescription(
            `${titleLine}\n👤 **Artist:** ${author} • 💿 **Album:** ${albumLabel} • \`${playbackStateLabel}\`\n\n${progressLine}${serverMuteAlert}`,
        )
        .addFields(
            { name: "Requested By", value: requesterLabel, inline: true },
            { name: "Duration", value: `\`${durationText}\``, inline: true },
            { name: "Elapsed / Remaining", value: `\`${elapsedText}\` / \`${remainingText}\``, inline: true },
            { name: "Bot", value: `\`${botName}\``, inline: true },
            { name: "Source", value: `\`${sourceLabel}\``, inline: true },
            { name: "Queue", value: queueSummary, inline: true },
            { name: "Volume", value: `\`🔊 ${volumeValue}\``, inline: true },
            { name: "Loop", value: `\`${repeatLabel}\``, inline: true },
            { name: "Autoplay", value: autoplayEnabled ? "`✨ On`" : "`Off`", inline: true },
        )
        .setFooter({
            text: `666 Neon Music Engine • ${botName}`,
            iconURL: iconUrl,
        });

    if (track.artworkUrl && /^https?:\/\//i.test(String(track.artworkUrl))) {
        embed.setThumbnail(track.artworkUrl);
    }

    if (player?._has666CardAttachment) {
        embed.setImage("attachment://666-nowplaying.png");
    }

    return embed;
}

function safeEmoji(customEmoji, unicodeFallback) {
    if (customEmoji && typeof customEmoji === "string" && customEmoji.trim().length > 0) {
        return customEmoji;
    }
    return unicodeFallback;
}

/**
 * Builds the 3-row interactive button controller:
 * Row 1 (Primary 666 Controls): [Pause / Resume] [Skip] [Loop] [Queue]
 * Row 2: [Previous] [Stop] [Shuffle] [Volume]
 * Row 3: [Autoplay] [Lyrics] [Favorite]
 */
function buildNowPlayingComponents(client, player) {
    const playerEmoji = client?.emoji?.player || {};
    const hasPrevious = hasAnyPreviousTrack(client, player);
    const canShuffle = Number(player?.queue?.size || 0) >= 2;
    const isPaused = Boolean(player?.paused);
    const loopMode = player?.loop || "none";
    const autoplayEnabled = isGuildAutoplayEnabled(client, player?.guildId);

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("np:pause")
            .setEmoji(safeEmoji(isPaused ? playerEmoji.resume : playerEmoji.pause, isPaused ? "▶️" : "⏸️"))
            .setLabel(isPaused ? "Resume" : "Pause")
            .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("np:skip")
            .setEmoji(safeEmoji(playerEmoji.skip, "⏭️"))
            .setLabel("Skip")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("np:loop")
            .setEmoji(safeEmoji(playerEmoji.loop, "🔁"))
            .setLabel(loopMode === "song" ? "Loop: Song" : loopMode === "queue" ? "Loop: Queue" : "Loop")
            .setStyle(loopMode !== "none" ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("np:queue")
            .setEmoji("📋")
            .setLabel(`Queue (${player?.queue?.size || 0})`)
            .setStyle(ButtonStyle.Secondary),
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("np:prev")
            .setEmoji(safeEmoji(playerEmoji.previous, "⏮️"))
            .setLabel("Previous")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!hasPrevious),
        new ButtonBuilder()
            .setCustomId("np:stop")
            .setEmoji(safeEmoji(playerEmoji.stop, "⏹️"))
            .setLabel("Stop")
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId("np:shuffle")
            .setEmoji(safeEmoji(playerEmoji.shuffle, "🔀"))
            .setLabel("Shuffle")
            .setStyle(player?.data?.get?.("shuffled") ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(!canShuffle),
        new ButtonBuilder()
            .setCustomId("np:volume")
            .setEmoji(safeEmoji(playerEmoji.volup, "🔊"))
            .setLabel(`Volume (${player?.volume ?? 100}%)`)
            .setStyle(ButtonStyle.Secondary),
    );

    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("np:autoplay")
            .setEmoji("✨")
            .setLabel(autoplayEnabled ? "Autoplay: On" : "Autoplay")
            .setStyle(autoplayEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("np:lyrics").setEmoji("📜").setLabel("Lyrics").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("np:fav").setEmoji("❤️").setLabel("Favorite").setStyle(ButtonStyle.Secondary),
    );

    return [row1, row2, row3];
}

function buildPaginatedQueuePayload(client, player, pageIndex = 0) {
    const embedColor = client?.config?.embedColor || "#ff0051";
    const current = player.queue?.current;
    const allUpcoming = Array.isArray(player.queue) ? player.queue : [];
    const perPage = 10;
    const totalPages = Math.max(1, Math.ceil(allUpcoming.length / perPage));
    const safePage = Math.min(Math.max(0, pageIndex), totalPages - 1);
    const startIdx = safePage * perPage;
    const slice = allUpcoming.slice(startIdx, startIdx + perPage);

    const lines = slice.map((t, idx) => {
        const dur = t.isStream ? "LIVE" : convertTime(t.duration || 0);
        const title = truncateText(t.title, 42);
        const url = t.pluginInfo?.originalUri || t.uri;
        return `\`${startIdx + idx + 1}.\` ${url ? `[${title}](${url})` : title} — \`${dur}\``;
    });

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle(`📋 Server Queue (${player.queue?.size || 0} Upcoming)`)
        .setDescription(
            `**Now Playing:** ${current ? `**${truncateText(current.title, 48)}** (\`${current.isStream ? "LIVE" : convertTime(current.duration || 0)}\`)` : "None"}\n\n` +
                (lines.length ? lines.join("\n") : "*No upcoming songs in queue.*"),
        )
        .setFooter({
            text: `Page ${safePage + 1}/${totalPages} • Total Queue Duration: ${convertTime(player.queue?.duration || 0)} • Loop: ${formatRepeatLabel(player.loop)}`,
        });

    if (totalPages <= 1) {
        return { embeds: [embed], components: [] };
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("npq:prev")
            .setEmoji("◀️")
            .setLabel("Prev")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage <= 0),
        new ButtonBuilder()
            .setCustomId("npq:page")
            .setLabel(`Page ${safePage + 1} / ${totalPages}`)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId("npq:next")
            .setEmoji("▶️")
            .setLabel("Next")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage >= totalPages - 1),
    );

    return { embeds: [embed], components: [row], safePage, totalPages };
}

function buildVolumePanelPayload(client, player) {
    const embedColor = client?.config?.embedColor || "#ff0051";
    const minVol = client?.config?.minVolume ?? 1;
    const maxVol = client?.config?.maxVolume ?? 150;
    const currentVol = player.volume ?? 100;

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle("🔊 Volume Controller")
        .setDescription(
            `Current Volume: **\`${currentVol}%\`**\nAllowed Range: \`${minVol}% — ${maxVol}%\`\n\nChoose a quick step below or click **Custom Volume** to type an exact percentage.`,
        );

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("npvol:-10")
            .setLabel("-10%")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentVol <= minVol),
        new ButtonBuilder()
            .setCustomId("npvol:-5")
            .setLabel("-5%")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentVol <= minVol),
        new ButtonBuilder()
            .setCustomId("npvol:reset")
            .setLabel("100%")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentVol === 100),
        new ButtonBuilder()
            .setCustomId("npvol:+5")
            .setLabel("+5%")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentVol >= maxVol),
        new ButtonBuilder()
            .setCustomId("npvol:+10")
            .setLabel("+10%")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentVol >= maxVol),
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("npvol:modal").setEmoji("⌨️").setLabel("Custom Volume").setStyle(ButtonStyle.Primary),
    );

    return { embeds: [embed], components: [row1, row2] };
}

/**
 * Stops any active component collector on `player` and deletes the previous Now Playing message if requested.
 */
async function cleanupNowPlayingMessage(player, deleteMessage = true) {
    if (!player) return;

    if (player._npCollector) {
        try {
            player._npCollector.stop("cleanup");
        } catch {
            // Ignore collector stop error
        }
        player._npCollector = null;
    }

    if (deleteMessage && player.message) {
        const oldMsg = player.message;
        player.message = null;
        await oldMsg.delete().catch(() => {});
    }
}

/**
 * Edits the active Now Playing message in-place when state changes
 * (start, pause, resume, track change, queue change, volume change, repeat, shuffle, autoplay, progress).
 */
async function refreshNowPlayingDashboard(client, player, options = {}) {
    if (!player || player.state === PLAYER_STATE_DESTROYED || player.sudoDestroy) return false;
    if (!player.message || !player.queue?.current) return false;

    if (options.throttleProgress) {
        const lastUpdate = Number(player._lastProgressEditAt || 0);
        if (Date.now() - lastUpdate < PROGRESS_UPDATE_THROTTLE_MS) {
            return false;
        }
        player._lastProgressEditAt = Date.now();
    } else {
        player._lastProgressEditAt = Date.now();
    }

    try {
        const embed = buildNowPlayingEmbed(client, player);
        const components = buildNowPlayingComponents(client, player);
        await player.message.edit({ embeds: [embed], components });
        return true;
    } catch (err) {
        // Message was deleted manually in Discord channel — clear stale reference
        if (err?.code === 10008 || err?.rawError?.code === 10008) {
            player.message = null;
        }
        return false;
    }
}

function attachDashboardCollector(client, player, message) {
    const botName = client?.config?.botName || "Lagukan";
    const embedColor = client?.config?.embedColor || "#ff0051";
    const collector = message.createMessageComponentCollector();
    player._npCollector = collector;

    collector.on("collect", (btnInteraction) => {
        void (async () => {
            try {
                if (btnInteraction.applicationId && client?.user?.id && String(btnInteraction.applicationId) !== String(client.user.id)) {
                    return;
                }
                if (
                    btnInteraction.message?.author?.id &&
                    client?.user?.id &&
                    String(btnInteraction.message.author.id) !== String(client.user.id)
                ) {
                    return;
                }

                const livePlayer = getGuildPlayer(client, player.guildId);
                const replyEmbed = new EmbedBuilder().setColor(THEME_666.embedColor);

                if (
                    !livePlayer ||
                    livePlayer !== player ||
                    player.state === PLAYER_STATE_DESTROYED ||
                    player.sudoDestroy ||
                    !player.queue?.current
                ) {
                    collector.stop("inactive");
                    replyEmbed.setDescription("There is no active player in this server.");
                    await safeReply(btnInteraction, { embeds: [replyEmbed], flags: MessageFlags.Ephemeral });
                    return;
                }

                const customId = btnInteraction.customId;

                // Read-only / personal actions (Queue, Lyrics, Favorite) do not require DJ role or same VC
                if (customId === "np:queue") {
                    let currentPage = 0;
                    const initialPayload = buildPaginatedQueuePayload(client, player, currentPage);
                    const queueReply = await safeReply(btnInteraction, {
                        embeds: initialPayload.embeds,
                        components: initialPayload.components,
                        flags: MessageFlags.Ephemeral,
                        withResponse: true,
                    });
                    const queueMsg = queueReply?.resource?.message || queueReply;

                    if (
                        queueMsg &&
                        initialPayload.components.length > 0 &&
                        typeof queueMsg.createMessageComponentCollector === "function"
                    ) {
                        const qCollector = queueMsg.createMessageComponentCollector({ time: 120000 });
                        qCollector.on("collect", (qBtn) => {
                            void (async () => {
                                if (qBtn.user.id !== btnInteraction.user.id) return;
                                const ack = await safeDeferUpdate(qBtn);
                                if (!ack) return;
                                if (qBtn.customId === "npq:prev") currentPage = Math.max(0, currentPage - 1);
                                else if (qBtn.customId === "npq:next") currentPage += 1;
                                const updated = buildPaginatedQueuePayload(client, player, currentPage);
                                currentPage = updated.safePage ?? currentPage;
                                await safeEditReply(btnInteraction, {
                                    embeds: updated.embeds,
                                    components: updated.components,
                                });
                            })().catch(() => {});
                        });
                    }
                    return;
                }

                if (customId === "np:lyrics") {
                    await handleLyricsCommand(client, btnInteraction);
                    return;
                }

                if (customId === "np:fav") {
                    const currentTrack = player.queue.current;
                    const favRes = await addUserFavorite(client, btnInteraction.user, currentTrack);
                    if (favRes.status === "exists") {
                        replyEmbed.setDescription(`❤️ **${truncateText(currentTrack.title, 45)}** is already in your favorites.`);
                    } else if (favRes.status === "limit") {
                        replyEmbed.setDescription(`Your favorites list is full (max \`${favRes.max}\` songs).`);
                    } else {
                        replyEmbed.setDescription(`❤️ Saved **${truncateText(currentTrack.title, 45)}** to your \`/favorite\` list!`);
                    }
                    await safeReply(btnInteraction, { embeds: [replyEmbed], flags: MessageFlags.Ephemeral });
                    return;
                }

                // Playback controls require being in the same voice channel as Lagukan
                if (!btnInteraction.member?.voice?.channelId || btnInteraction.member.voice.channelId !== player.voiceId) {
                    replyEmbed.setDescription(`You must be in the same voice channel as ${botName}.`);
                    await safeReply(btnInteraction, { embeds: [replyEmbed], flags: MessageFlags.Ephemeral });
                    return;
                }

                const allowRequester = ["np:pause", "np:skip"].includes(customId);
                const djCheck = checkDjAccess(client, {
                    guild: btnInteraction.guild,
                    member: btnInteraction.member,
                    user: btnInteraction.user,
                    player,
                    track: player.queue.current,
                    allowRequester,
                    interaction: btnInteraction,
                });

                if (!djCheck.allowed) {
                    replyEmbed.setDescription(djCheck.reason);
                    await safeReply(btnInteraction, { embeds: [replyEmbed], flags: MessageFlags.Ephemeral });
                    return;
                }

                switch (customId) {
                    case "np:pause": {
                        const ack = await safeDeferUpdate(btnInteraction);
                        if (!ack) return;

                        if (!player.paused) {
                            await Promise.resolve(player.pause()).catch(() => {});
                        } else {
                            await Promise.resolve(player.resume()).catch(() => {});
                        }
                        await refreshNowPlayingDashboard(client, player);
                        break;
                    }
                    case "np:prev": {
                        const prevList = Array.isArray(player.queue.previous) ? player.queue.previous : [];
                        if (prevList.length > 0) {
                            const ack = await safeDeferUpdate(btnInteraction);
                            if (!ack) return;

                            if (player.queue.current) {
                                await Promise.resolve(player.previous()).catch(() => {});
                            } else {
                                const target = prevList.pop();
                                if (target) await Promise.resolve(player.play(target)).catch(() => {});
                            }
                            break;
                        }

                        const history = await getGuildTrackHistory(client, btnInteraction.guild || { id: player.guildId });
                        const fallbackEntry = player.queue.current ? history[1] : history[0];
                        if (!fallbackEntry) {
                            replyEmbed.setDescription("No previous song found in session or server history.");
                            await safeReply(btnInteraction, { embeds: [replyEmbed], flags: MessageFlags.Ephemeral });
                            return;
                        }

                        const ack = await safeDeferUpdate(btnInteraction);
                        if (!ack) return;

                        const hydrated = hydrateStoredTrack(client, fallbackEntry, btnInteraction.user);
                        await Promise.resolve(player.play(hydrated)).catch(() => {});
                        break;
                    }
                    case "np:skip": {
                        if (player.queue.isEmpty && !isGuildAutoplayEnabled(client, player.guildId)) {
                            replyEmbed.setDescription("Queue is empty. Add another track or enable `/autoplay` to skip.");
                            await safeReply(btnInteraction, { embeds: [replyEmbed], flags: MessageFlags.Ephemeral });
                            return;
                        }

                        const ack = await safeDeferUpdate(btnInteraction);
                        if (!ack) return;

                        await Promise.resolve(player.skip()).catch(() => {});
                        break;
                    }
                    case "np:stop": {
                        const ack = await safeDeferUpdate(btnInteraction);
                        if (!ack) return;

                        player._manualStopAt = Date.now();
                        collector.stop("stopped");
                        await cleanupNowPlayingMessage(player, true);
                        player.queue.clear();
                        player.data?.set?.("shuffled", false);
                        await Promise.resolve(player.stop()).catch(() => {});
                        break;
                    }
                    case "np:loop": {
                        const ack = await safeDeferUpdate(btnInteraction);
                        if (!ack) return;

                        const nextLoop = player.loop === "none" ? "song" : player.loop === "song" ? "queue" : "none";
                        player.setLoop(nextLoop);
                        await refreshNowPlayingDashboard(client, player);
                        break;
                    }
                    case "np:shuffle": {
                        if (player.queue.size < 2) {
                            replyEmbed.setDescription("Need at least 2 tracks in queue to shuffle.");
                            await safeReply(btnInteraction, { embeds: [replyEmbed], flags: MessageFlags.Ephemeral });
                            return;
                        }

                        const ack = await safeDeferUpdate(btnInteraction);
                        if (!ack) return;

                        player.queue.shuffle();
                        player.data?.set?.("shuffled", true);
                        await refreshNowPlayingDashboard(client, player);
                        break;
                    }
                    case "np:autoplay": {
                        const currentAuto = isGuildAutoplayEnabled(client, player.guildId);
                        const nextAuto = await setGuildAutoplay(client, btnInteraction.guild || player.guildId, !currentAuto);
                        await refreshNowPlayingDashboard(client, player);

                        replyEmbed.setDescription(
                            nextAuto
                                ? "✨ Smart Autoplay is now **enabled** for this server."
                                : "Smart Autoplay is now **disabled** for this server.",
                        );
                        await safeReply(btnInteraction, { embeds: [replyEmbed], flags: MessageFlags.Ephemeral });
                        break;
                    }
                    case "np:volume": {
                        const panel = buildVolumePanelPayload(client, player);
                        const volReply = await safeReply(btnInteraction, {
                            ...panel,
                            flags: MessageFlags.Ephemeral,
                            withResponse: true,
                        });
                        const volMsg = volReply?.resource?.message || volReply;
                        if (!volMsg || typeof volMsg.createMessageComponentCollector !== "function") return;

                        const volCollector = volMsg.createMessageComponentCollector({ time: 60000 });
                        volCollector.on("collect", (volBtn) => {
                            void (async () => {
                                const currentLive = getGuildPlayer(client, player.guildId);
                                if (!currentLive || currentLive !== player) {
                                    volCollector.stop();
                                    return;
                                }

                                const minVol = client?.config?.minVolume ?? 1;
                                const maxVol = client?.config?.maxVolume ?? 150;

                                if (volBtn.customId === "npvol:modal") {
                                    if (typeof volBtn.showModal !== "function") {
                                        await safeDeferUpdate(volBtn);
                                        return;
                                    }

                                    const modalCustomId = `npvol:submit:${player.guildId}:${Date.now()}`;
                                    const modal = new ModalBuilder()
                                        .setCustomId(modalCustomId)
                                        .setTitle("Set Player Volume")
                                        .addComponents(
                                            new ActionRowBuilder().addComponents(
                                                new TextInputBuilder()
                                                    .setCustomId("volume_value")
                                                    .setLabel(`Volume Percentage (${minVol} - ${maxVol})`)
                                                    .setStyle(TextInputStyle.Short)
                                                    .setMinLength(1)
                                                    .setMaxLength(3)
                                                    .setPlaceholder(String(player.volume ?? 100))
                                                    .setValue(String(player.volume ?? 100))
                                                    .setRequired(true),
                                            ),
                                        );

                                    await volBtn.showModal(modal).catch(() => {});
                                    if (typeof volBtn.awaitModalSubmit !== "function") return;

                                    const submitted = await volBtn
                                        .awaitModalSubmit({
                                            time: 45000,
                                            filter: (m) => m.customId === modalCustomId && m.user.id === volBtn.user.id,
                                        })
                                        .catch(() => null);

                                    if (!submitted) return;

                                    const rawVal = submitted.fields?.getTextInputValue?.("volume_value") || "";
                                    const parsed = Number.parseInt(String(rawVal).trim(), 10);

                                    if (!Number.isFinite(parsed) || parsed < minVol || parsed > maxVol) {
                                        const invalidEmbed = new EmbedBuilder()
                                            .setColor(embedColor)
                                            .setDescription(`Please enter a valid number between \`${minVol}\` and \`${maxVol}\`.`);
                                        await safeReply(submitted, { embeds: [invalidEmbed], flags: MessageFlags.Ephemeral });
                                        return;
                                    }

                                    if (typeof submitted.deferUpdate === "function") {
                                        await safeDeferUpdate(submitted);
                                    } else {
                                        const okEmbed = new EmbedBuilder()
                                            .setColor(embedColor)
                                            .setDescription(`🔊 Volume set to \`${parsed}%\`.`);
                                        await safeReply(submitted, { embeds: [okEmbed], flags: MessageFlags.Ephemeral });
                                    }

                                    await Promise.resolve(player.setVolume(parsed)).catch(() => {});
                                    await safeEditReply(btnInteraction, buildVolumePanelPayload(client, player));
                                    await refreshNowPlayingDashboard(client, player);
                                    return;
                                }

                                const ack = await safeDeferUpdate(volBtn);
                                if (!ack) return;

                                let targetVol = player.volume;

                                if (volBtn.customId === "npvol:reset") targetVol = 100;
                                else if (volBtn.customId === "npvol:-10") targetVol = player.volume - 10;
                                else if (volBtn.customId === "npvol:-5") targetVol = player.volume - 5;
                                else if (volBtn.customId === "npvol:+5") targetVol = player.volume + 5;
                                else if (volBtn.customId === "npvol:+10") targetVol = player.volume + 10;

                                targetVol = Math.min(Math.max(targetVol, minVol), maxVol);
                                await Promise.resolve(player.setVolume(targetVol)).catch(() => {});

                                await safeEditReply(btnInteraction, buildVolumePanelPayload(client, player));
                                await refreshNowPlayingDashboard(client, player);
                            })().catch(() => {});
                        });
                        break;
                    }
                }
            } catch (err) {
                Logger.debug(`[NowPlayingDashboard] Error saat memproses tombol kontrol: ${err?.message || err}`);
            }
        })().catch(() => {});
    });
}

const dashboardSendLocks = new Map();

function getDashboardLockKey(client, guildId) {
    return `${String(client?.user?.id || "bot")}:${String(guildId || "")}`;
}

/**
 * Sends or edits the Now Playing 666 Dashboard in-place when tracks change.
 * - Persists `nowPlayingMessageId` and edits the existing message when switching songs to prevent spam.
 * - Scoped by `${botApplicationId}:${guildId}` so 10 concurrent bots never collide.
 */
async function sendOrReplaceNowPlayingDashboard(client, player, track = null) {
    if (!player || player.state === PLAYER_STATE_DESTROYED || player.sudoDestroy) return null;
    if (player.data?.get?.("guessTheSongActive")) return null;

    const gId = String(player.guildId || "");
    const lockKey = getDashboardLockKey(client, gId);
    const previousOp = dashboardSendLocks.get(lockKey) || Promise.resolve();

    const task = previousOp
        .catch(() => {})
        .then(async () => {
            if (!player || player.state === PLAYER_STATE_DESTROYED || player.sudoDestroy) return null;
            if (player.data?.get?.("guessTheSongActive")) return null;

            const currentTrack = track || player.queue?.current;
            if (!currentTrack) return null;

            const textChannel = client.channels?.cache?.get?.(player.textId);
            if (!textChannel || typeof textChannel.send !== "function") return null;

            // Stop previous collector before updating or replacing message
            await cleanupNowPlayingMessage(player, false);

            const botName = client?.user?.username || client?.config?.botName || "Lagukan 666";
            const requesterName = currentTrack.requester
                ? currentTrack.requester.globalName || currentTrack.requester.username || String(currentTrack.requester.id || "Listener")
                : "Autoplay";
            const totalDurationMs = Math.max(0, Number(currentTrack.duration || 0));
            const elapsedMs = Math.max(0, Number(player.position || 0));
            const durationText = currentTrack.isStream ? "LIVE" : convertTime(totalDurationMs);
            const elapsedText = convertTime(elapsedMs);
            const progressRatio = totalDurationMs > 0 ? Math.min(1, elapsedMs / totalDurationMs) : 0.08;

            const pngCard = await renderNowPlayingCard666({
                botId: String(client?.user?.id || "bot"),
                botName,
                trackKey: String(currentTrack.identifier || currentTrack.uri || currentTrack.title || ""),
                title: currentTrack.title || "Unknown Title",
                author: currentTrack.author || "Unknown Artist",
                requester: requesterName,
                durationText,
                elapsedText,
                progressRatio,
                artworkUrl: currentTrack.artworkUrl || null,
                isPaused: Boolean(player.paused),
            });

            const files = [];
            if (pngCard) {
                player._has666CardAttachment = true;
                files.push(new AttachmentBuilder(pngCard, { name: "666-nowplaying.png" }));
            } else {
                player._has666CardAttachment = false;
            }

            const embed = buildNowPlayingEmbed(client, player, currentTrack);
            const components = buildNowPlayingComponents(client, player);

            let sent = null;
            const existingMsg = player.message;
            const existingChannelId = String(existingMsg?.channelId || existingMsg?.channel?.id || "");

            // Section 2: Edit existing Now Playing message when song changes instead of spamming new messages!
            if (
                existingMsg &&
                typeof existingMsg.edit === "function" &&
                (!existingChannelId || existingChannelId === String(player.textId))
            ) {
                sent = await existingMsg
                    .edit({
                        embeds: [embed],
                        components,
                        files,
                    })
                    .catch((err) => {
                        if (err?.code === 10008 || err?.rawError?.code === 10008) {
                            player.message = null;
                        }
                        return null;
                    });
            }

            if (!sent) {
                sent = await textChannel
                    .send({
                        embeds: [embed],
                        components,
                        files,
                    })
                    .catch((err) => {
                        Logger.debug(`[NowPlayingDashboard] Gagal mengirim pesan dashboard: ${err?.message || err}`);
                        return null;
                    });
            }

            if (!sent) return null;

            if (player.state === PLAYER_STATE_DESTROYED || player.sudoDestroy) {
                await sent.delete().catch(() => {});
                return null;
            }

            player.message = sent;
            player.data?.set?.("nowPlayingMessageId", sent.id);
            await updateSessionNowPlayingMessageId(client, gId, sent.id);
            player._lastProgressEditAt = Date.now();
            attachDashboardCollector(client, player, sent);
            return sent;
        });

    dashboardSendLocks.set(lockKey, task);
    try {
        return await task;
    } finally {
        if (dashboardSendLocks.get(lockKey) === task) {
            dashboardSendLocks.delete(lockKey);
        }
    }
}

/**
 * Waits for any in-flight dashboard post on `player.guildId`, or creates one if none exists yet.
 */
async function ensureNowPlayingDashboardVisible(client, player, fallbackTrack = null) {
    if (!player || player.state === PLAYER_STATE_DESTROYED || player.sudoDestroy) return null;
    const gId = String(player.guildId || "");
    const lockKey = getDashboardLockKey(client, gId);
    const pending = dashboardSendLocks.get(lockKey);
    if (pending) {
        const msg = await pending.catch(() => null);
        if (msg || player.message) return msg || player.message;
    }
    if (player.message) {
        await refreshNowPlayingDashboard(client, player).catch(() => {});
        return player.message;
    }
    return sendOrReplaceNowPlayingDashboard(client, player, fallbackTrack || player.queue?.current);
}

function buildQuickQueueEmbed(client, player) {
    return buildPaginatedQueuePayload(client, player, 0).embeds[0];
}

module.exports = {
    truncateText,
    buildProgressBar,
    formatRepeatLabel,
    buildNowPlayingEmbed,
    buildNowPlayingComponents,
    buildPaginatedQueuePayload,
    buildQuickQueueEmbed,
    buildVolumePanelPayload,
    cleanupNowPlayingMessage,
    refreshNowPlayingDashboard,
    sendOrReplaceNowPlayingDashboard,
    ensureNowPlayingDashboardVisible,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
