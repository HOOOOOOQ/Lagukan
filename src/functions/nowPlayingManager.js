const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require("discord.js");
const { convertTime } = require("./timeFormat.js");
const { formatTrackSourceLabel } = require("./musicSourceResolver.js");
const { checkDjAccess, isGuildAutoplayEnabled, addUserFavorite } = require("./musicPermissions.js");
const { safeReply, safeDeferUpdate, safeEditReply } = require("./interactionResponder.js");
const { PLAYER_STATE_DESTROYED, getGuildPlayer } = require("./voiceSessionManager.js");
const Logger = require("../utils/logger");

const PROGRESS_BAR_SEGMENTS = 14;
const PROGRESS_UPDATE_THROTTLE_MS = 20000;

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
        bar += i === indicatorIndex ? "🔘" : "▬";
    }

    return `\`${convertTime(clampedPos)}\` ${bar} \`${convertTime(durationMs)}\``;
}

function formatRepeatLabel(loopMode) {
    if (loopMode === "song") return "🔂 Track";
    if (loopMode === "queue") return "🔁 Queue";
    return "Off";
}

function buildNowPlayingEmbed(client, player, trackOverride = null) {
    const botName = client?.config?.botName || "Lagukan";
    const embedColor = client?.config?.embedColor || "#ff0051";
    const iconUrl = client?.user?.displayAvatarURL?.() || undefined;
    const track = trackOverride || player?.queue?.current;

    if (!player || !track) {
        return new EmbedBuilder().setColor(embedColor).setDescription("There is no song currently playing in this server.");
    }

    const title = truncateText(track.title || "Unknown Title", 58);
    const author = truncateText(track.author || "Unknown Artist", 42);
    const displayUrl = track.pluginInfo?.originalUri || track.uri || null;
    const durationText = track.isStream ? "LIVE" : convertTime(track.duration || 0);
    const progressLine = buildProgressBar(player.position || 0, track.duration || 0, Boolean(track.isStream));
    const sourceLabel = formatTrackSourceLabel(track);
    const requesterLabel = track.requester ? (track.requester.id ? `<@${track.requester.id}>` : String(track.requester)) : "Autoplay";

    const queueCount = Number(player.queue?.size || 0);
    const queueDurationMs = Number(player.queue?.duration || 0);
    const queueSummary = queueCount > 0 ? `\`${queueCount}\` track(s) • \`${convertTime(queueDurationMs)}\`` : "`Empty`";

    const isShuffled = Boolean(player.data?.get?.("shuffled"));
    const repeatLabel = formatRepeatLabel(player.loop);
    const autoplayEnabled = isGuildAutoplayEnabled(client, player.guildId);
    const activeFilter = player.data?.get?.("activeFilter") || null;

    const titleLine = displayUrl ? `**[${title}](${displayUrl})**` : `**${title}**`;

    const embed = new EmbedBuilder()
        .setAuthor({
            name: player.paused ? `${botName} • Playback Paused` : `${botName} • Now Playing`,
            iconURL: iconUrl,
        })
        .setColor(embedColor)
        .setDescription(`${titleLine}\nby **${author}**\n\n${progressLine}`)
        .addFields(
            { name: "Source", value: `\`${sourceLabel}\``, inline: true },
            { name: "Duration", value: `\`${durationText}\``, inline: true },
            { name: "Requested By", value: requesterLabel, inline: true },
            { name: "Queue", value: queueSummary, inline: true },
            { name: "Shuffle", value: isShuffled ? "`🔀 Active`" : "`Off`", inline: true },
            { name: "Repeat", value: `\`${repeatLabel}\``, inline: true },
            {
                name: "Player Status",
                value: `Vol: \`${player.volume}%\` • Autoplay: \`${autoplayEnabled ? "On" : "Off"}\`${activeFilter ? ` • Filter: \`${activeFilter}\`` : ""}`,
                inline: false,
            },
        )
        .setFooter({
            text: `${botName} Music Dashboard`,
            iconURL: iconUrl,
        });

    if (track.artworkUrl && /^https?:\/\//i.test(String(track.artworkUrl))) {
        embed.setThumbnail(track.artworkUrl);
    }

    return embed;
}

function safeEmoji(customEmoji, unicodeFallback) {
    if (customEmoji && typeof customEmoji === "string" && customEmoji.trim().length > 0) {
        return customEmoji;
    }
    return unicodeFallback;
}

function buildNowPlayingComponents(client, player) {
    const playerEmoji = client?.emoji?.player || {};
    const hasPrevious = Boolean(player?.queue?.previous?.length);
    const canShuffle = Number(player?.queue?.size || 0) >= 2;
    const isPaused = Boolean(player?.paused);
    const loopMode = player?.loop || "none";

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("np:pause")
            .setEmoji(safeEmoji(isPaused ? playerEmoji.resume : playerEmoji.pause, isPaused ? "▶️" : "⏸️"))
            .setLabel(isPaused ? "Resume" : "Pause")
            .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("np:prev")
            .setEmoji(safeEmoji(playerEmoji.previous, "⏮️"))
            .setLabel("Previous")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!hasPrevious),
        new ButtonBuilder()
            .setCustomId("np:skip")
            .setEmoji(safeEmoji(playerEmoji.skip, "⏭️"))
            .setLabel("Skip")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("np:stop")
            .setEmoji(safeEmoji(playerEmoji.stop, "⏹️"))
            .setLabel("Stop")
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId("np:loop")
            .setEmoji(safeEmoji(playerEmoji.loop, "🔁"))
            .setLabel(loopMode === "song" ? "Loop: Song" : loopMode === "queue" ? "Loop: Queue" : "Loop")
            .setStyle(loopMode !== "none" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("np:shuffle")
            .setEmoji(safeEmoji(playerEmoji.shuffle, "🔀"))
            .setLabel("Shuffle")
            .setStyle(player?.data?.get?.("shuffled") ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(!canShuffle),
        new ButtonBuilder()
            .setCustomId("np:queue")
            .setEmoji("📋")
            .setLabel(`Queue (${player?.queue?.size || 0})`)
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("np:volume")
            .setEmoji(safeEmoji(playerEmoji.volup, "🔊"))
            .setLabel(`${player?.volume ?? 100}%`)
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("np:fav").setEmoji("❤️").setLabel("Favorite").setStyle(ButtonStyle.Secondary),
    );

    return [row1, row2];
}

function buildQuickQueueEmbed(client, player) {
    const embedColor = client?.config?.embedColor || "#ff0051";
    const current = player.queue?.current;
    const upcoming = Array.isArray(player.queue) ? player.queue.slice(0, 10) : [];

    const lines = upcoming.map((t, idx) => {
        const dur = t.isStream ? "LIVE" : convertTime(t.duration || 0);
        const title = truncateText(t.title, 42);
        const url = t.pluginInfo?.originalUri || t.uri;
        return `\`${idx + 1}.\` ${url ? `[${title}](${url})` : title} — \`${dur}\``;
    });

    const moreCount = Math.max(0, (player.queue?.size || 0) - upcoming.length);
    if (moreCount > 0) {
        lines.push(`\n*...and \`${moreCount}\` more track(s). Use \`/queue\` for full pages.*`);
    }

    return new EmbedBuilder()
        .setColor(embedColor)
        .setTitle(`📋 Server Queue (${player.queue?.size || 0} Upcoming)`)
        .setDescription(
            `**Now Playing:** ${current ? `**${truncateText(current.title, 48)}** (\`${current.isStream ? "LIVE" : convertTime(current.duration || 0)}\`)` : "None"}\n\n` +
                (lines.length ? lines.join("\n") : "*No upcoming songs in queue.*"),
        )
        .setFooter({
            text: `Total Queue Duration: ${convertTime(player.queue?.duration || 0)} • Loop: ${formatRepeatLabel(player.loop)}`,
        });
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
            `Current Volume: **\`${currentVol}%\`**\nAllowed Range: \`${minVol}% — ${maxVol}%\`\n\nUse the buttons below or \`/volume <number>\` for exact control.`,
        );

    const row = new ActionRowBuilder().addComponents(
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

    return { embeds: [embed], components: [row] };
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
 * Edits the active Now Playing message in-place when state changes (pause, loop, shuffle, volume, progress).
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
                const livePlayer = getGuildPlayer(client, player.guildId);
                const replyEmbed = new EmbedBuilder().setColor(embedColor);

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

                // Read-only actions (Queue & Favorite) do not require DJ role or even same VC for Favorite
                if (customId === "np:queue") {
                    const qEmbed = buildQuickQueueEmbed(client, player);
                    await safeReply(btnInteraction, { embeds: [qEmbed], flags: MessageFlags.Ephemeral });
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
                        if (!player.queue.previous?.length) {
                            replyEmbed.setDescription("No previous song found in session history.");
                            await safeReply(btnInteraction, { embeds: [replyEmbed], flags: MessageFlags.Ephemeral });
                            return;
                        }

                        const ack = await safeDeferUpdate(btnInteraction);
                        if (!ack) return;

                        await Promise.resolve(player.previous()).catch(() => {});
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

                        collector.stop("stopped");
                        player.queue.clear();
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
                                const ack = await safeDeferUpdate(volBtn);
                                if (!ack) return;

                                const currentLive = getGuildPlayer(client, player.guildId);
                                if (!currentLive || currentLive !== player) {
                                    volCollector.stop();
                                    return;
                                }

                                const minVol = client?.config?.minVolume ?? 1;
                                const maxVol = client?.config?.maxVolume ?? 150;
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

/**
 * Sends a fresh Now Playing Dashboard to the player's text channel and attaches its interactive collector.
 */
async function sendOrReplaceNowPlayingDashboard(client, player, track = null) {
    if (!player || player.state === PLAYER_STATE_DESTROYED || player.sudoDestroy) return null;

    const currentTrack = track || player.queue?.current;
    if (!currentTrack) return null;

    await cleanupNowPlayingMessage(player, true);

    const textChannel = client.channels?.cache?.get?.(player.textId);
    if (!textChannel || typeof textChannel.send !== "function") return null;

    const embed = buildNowPlayingEmbed(client, player, currentTrack);
    const components = buildNowPlayingComponents(client, player);

    const sent = await textChannel.send({ embeds: [embed], components }).catch((err) => {
        Logger.debug(`[NowPlayingDashboard] Gagal mengirim pesan dashboard: ${err?.message || err}`);
        return null;
    });

    if (!sent) return null;

    // Re-check player state in case player was destroyed while sending
    if (player.state === PLAYER_STATE_DESTROYED || player.sudoDestroy) {
        await sent.delete().catch(() => {});
        return null;
    }

    player.message = sent;
    player._lastProgressEditAt = Date.now();
    attachDashboardCollector(client, player, sent);
    return sent;
}

module.exports = {
    truncateText,
    buildProgressBar,
    formatRepeatLabel,
    buildNowPlayingEmbed,
    buildNowPlayingComponents,
    buildQuickQueueEmbed,
    cleanupNowPlayingMessage,
    refreshNowPlayingDashboard,
    sendOrReplaceNowPlayingDashboard,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
