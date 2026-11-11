const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require("discord.js");
const { find, isNotFoundResponse } = require("llyrics");
const { getGuildPlayer } = require("./voiceSessionManager.js");
const { safeDeferReply, safeEditReply, safeDeferUpdate } = require("./interactionResponder.js");
const Logger = require("../utils/logger");

function cleanLyricsQueryTitle(rawTitle = "") {
    return String(rawTitle || "")
        .replace(/ - Topic$/i, "")
        .replace(/\((?:official|lyric|lyrics|audio|video|music video|visualizer|hd|hq|remastered|live)[^)]*\)/gi, "")
        .replace(/\[(?:official|lyric|lyrics|audio|video|music video|visualizer|hd|hq|remastered|live)[^\]]*\]/gi, "")
        .replace(/\b(?:ft\.?|feat\.?)\s+.+$/i, "")
        .replace(/\s+/g, " ")
        .trim();
}

async function fetchFromLrclib(title, artist = "") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    if (typeof timer.unref === "function") timer.unref();

    try {
        const q = [artist, title].filter(Boolean).join(" ").trim();
        if (!q) return null;

        const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, {
            signal: controller.signal,
            headers: {
                "User-Agent": "LagukanMusicBot/3.2 (https://github.com/HOOOOOOQ/Lagukan)",
            },
        });
        if (!res.ok) return null;

        const items = await res.json();
        if (!Array.isArray(items) || !items.length) return null;

        const match = items.find((item) => item?.plainLyrics && item.plainLyrics.trim().length > 20);
        if (!match) return null;

        return {
            title: match.trackName || title,
            artist: match.artistName || artist || "Unknown",
            lyrics: match.plainLyrics.trim(),
            artworkURL: null,
            provider: "LRCLIB",
        };
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function fetchFromLlyrics(title, artist = "") {
    try {
        const res = await find({
            song: title,
            artist: artist || undefined,
            engine: "musixmatch",
            forceSearch: true,
        });

        if (!res || isNotFoundResponse(res) || !res.lyrics || !String(res.lyrics).trim()) {
            return null;
        }

        return {
            title: res.title || title,
            artist: res.artist || artist || "Unknown",
            lyrics: String(res.lyrics).trim(),
            artworkURL: res.artworkURL || null,
            provider: res.engine ? `llyrics (${res.engine})` : "llyrics",
        };
    } catch (err) {
        Logger.debug(`[Lyrics] llyrics lookup failed: ${err?.message || err}`);
        return null;
    }
}

async function searchSongLyrics(title, artist = "") {
    const cleanTitle = cleanLyricsQueryTitle(title);
    const cleanArtist = String(artist || "")
        .replace(/ - Topic$/i, "")
        .trim();

    if (!cleanTitle) return null;

    const lrclib = await fetchFromLrclib(cleanTitle, cleanArtist);
    if (lrclib) return lrclib;

    const fallback = await fetchFromLlyrics(cleanTitle, cleanArtist);
    if (fallback) return fallback;

    return null;
}

function splitLyricsIntoPages(lyricsText, maxChars = 3500) {
    const lines = String(lyricsText || "").split("\n");
    const pages = [];
    let buffer = "";

    for (const line of lines) {
        const next = buffer ? `${buffer}\n${line}` : line;
        if (next.length > maxChars && buffer) {
            pages.push(buffer);
            buffer = line.slice(0, maxChars);
        } else {
            buffer = next.slice(0, maxChars);
        }
    }

    if (buffer) pages.push(buffer);
    return pages.length ? pages : ["No lyrics content."];
}

async function handleLyricsCommand(client, interaction) {
    const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    if (!deferred) return;

    const embedColor = client.config.embedColor;
    const botName = client.config.botName || "Lagukan";
    const queryOpt = interaction.options?.getString?.("song")?.trim() || "";
    const player = getGuildPlayer(client, interaction.guildId);
    const currentTrack = player?.queue?.current || null;

    let targetTitle = queryOpt;
    let targetArtist = "";
    let artwork = null;

    if (!targetTitle) {
        if (!currentTrack) {
            const noTrackEmbed = new EmbedBuilder()
                .setColor(embedColor)
                .setDescription("No song is currently playing. Play a track first or pass a `song` title to search lyrics.");
            return safeEditReply(interaction, { embeds: [noTrackEmbed] });
        }
        targetTitle = currentTrack.title || "";
        targetArtist = currentTrack.author || "";
        artwork = currentTrack.artworkUrl || null;
    }

    const result = await searchSongLyrics(targetTitle, targetArtist);
    if (!result) {
        const notFoundEmbed = new EmbedBuilder()
            .setColor(embedColor)
            .setDescription(`Could not find lyrics for **${cleanLyricsQueryTitle(targetTitle) || targetTitle}**.`);
        return safeEditReply(interaction, { embeds: [notFoundEmbed] });
    }

    const pages = splitLyricsIntoPages(result.lyrics, 3500);
    const thumb = result.artworkURL || artwork || null;

    const buildPageEmbed = (pageIdx) => {
        const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setAuthor({
                name: `${botName} • Lyrics`,
                iconURL: client.user?.displayAvatarURL?.(),
            })
            .setTitle(`${result.title} — ${result.artist}`.slice(0, 250))
            .setDescription(pages[pageIdx])
            .setFooter({
                text: `Source: ${result.provider}${pages.length > 1 ? ` • Page ${pageIdx + 1}/${pages.length}` : ""}`,
            });

        if (thumb && /^https?:\/\//i.test(thumb)) {
            embed.setThumbnail(thumb);
        }
        return embed;
    };

    if (pages.length === 1) {
        return safeEditReply(interaction, { embeds: [buildPageEmbed(0)] });
    }

    let currentPage = 0;
    const buildButtons = (pageIdx) => [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("lyrics:prev")
                .setLabel("Previous Page")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(pageIdx === 0),
            new ButtonBuilder()
                .setCustomId("lyrics:next")
                .setLabel("Next Page")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(pageIdx >= pages.length - 1),
        ),
    ];

    const message = await safeEditReply(interaction, {
        embeds: [buildPageEmbed(currentPage)],
        components: buildButtons(currentPage),
    });

    if (!message || typeof message.createMessageComponentCollector !== "function") return;

    const collector = message.createMessageComponentCollector({ time: 180000 });
    collector.on("collect", (btn) => {
        void (async () => {
            const ack = await safeDeferUpdate(btn);
            if (!ack) return;

            if (btn.customId === "lyrics:prev" && currentPage > 0) currentPage -= 1;
            if (btn.customId === "lyrics:next" && currentPage < pages.length - 1) currentPage += 1;

            await safeEditReply(interaction, {
                embeds: [buildPageEmbed(currentPage)],
                components: buildButtons(currentPage),
            });
        })().catch(() => {});
    });
}

module.exports = {
    cleanLyricsQueryTitle,
    searchSongLyrics,
    splitLyricsIntoPages,
    handleLyricsCommand,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
