const { EmbedBuilder, MessageFlags, PermissionsBitField } = require("discord.js");
const lodash = require("lodash");
const { convertTime } = require("../../../functions/timeFormat.js");
const { createPage } = require("../../../functions/createPage.js");
const { hydrateStoredTrack } = require("../../../functions/musicSourceResolver.js");
const {
    getGuildTrackHistory,
    clearGuildTrackHistory,
    getOrCreateGuildPlayer,
    isPlayerActivelyPlayingOrPausedTrack,
    startPlayerIfIdle,
} = require("../../../functions/musicPermissions.js");
const { getUserListeningHistory, formatListeningDuration, recordTrackRequest } = require("../../../functions/musicStatsEngine.js");
const { refreshNowPlayingDashboard, ensureNowPlayingDashboardVisible, truncateText } = require("../../../functions/nowPlayingManager.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "history",
    description: "Lihat riwayat lagu yang baru diputar (Personal atau Server) dan putar ulang",
    category: "music",
    options: [
        {
            name: "scope",
            description: "Pilih riwayat mendengarkan Personal kamu atau riwayat Server",
            type: 3,
            required: false,
            choices: [
                { name: "Personal (Riwayat Mendengarkan Saya)", value: "personal" },
                { name: "Server (Recently Played Server)", value: "server" },
            ],
        },
        {
            name: "play_index",
            description: "Optional history number (1 = most recent) to replay immediately",
            type: 4,
            min_value: 1,
            max_value: 50,
            required: false,
        },
        {
            name: "clear",
            description: "Clear server playback history (Manage Server required)",
            type: 5,
            required: false,
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
        const botName = client.config.botName || "Lagukan";
        const embedColor = client.config.embedColor;
        const embed = new EmbedBuilder().setColor(embedColor);

        const scope = interaction.options.getString("scope") || "server";
        const playIndex = interaction.options.getInteger("play_index");
        const clearFlag = Boolean(interaction.options.getBoolean("clear"));

        if (clearFlag) {
            const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) return;

            if (!interaction.memberPermissions?.has?.(PermissionsBitField.Flags.ManageGuild)) {
                embed.setDescription("You need `Manage Server` permission to clear server playback history.");
                return safeEditReply(interaction, { embeds: [embed] });
            }

            await clearGuildTrackHistory(client, interaction.guild);
            embed.setDescription("Cleared server playback history.");
            return safeEditReply(interaction, { embeds: [embed] });
        }

        const history =
            scope === "personal"
                ? await getUserListeningHistory(client, interaction.user.id, 50)
                : await getGuildTrackHistory(client, interaction.guild);

        if (playIndex !== null) {
            const voiceChannel = interaction.member?.voice?.channel;
            if (!voiceChannel) {
                const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
                if (!deferred) return;
                embed.setDescription("You need to join a voice channel first.");
                return safeEditReply(interaction, { embeds: [embed] });
            }

            const deferred = await safeDeferReply(interaction);
            if (!deferred) return;

            if (!history.length || playIndex > history.length) {
                embed.setDescription(
                    history.length
                        ? `History position must be between \`1\` and \`${history.length}\`.`
                        : "Server playback history is empty.",
                );
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
                embed.setDescription(`You need to be in <#${player.voiceId}> to queue songs from history.`);
                return safeEditReply(interaction, { embeds: [embed] });
            }

            const target = history[playIndex - 1];
            const track = hydrateStoredTrack(client, target, interaction.user);
            const wasPlaying = isPlayerActivelyPlayingOrPausedTrack(player);
            player.queue.add(track);
            await recordTrackRequest(client, {
                guildId: interaction.guildId,
                userId: interaction.user.id,
                count: 1,
            });

            if (!wasPlaying) {
                const outcome = await startPlayerIfIdle(client, player, {
                    guild: interaction.guild,
                    userId: interaction.user?.id,
                    command: "history_play",
                    waitForTrackStart: true,
                    timeoutMs: 9000,
                });
                if (!outcome.ok) {
                    embed.setDescription(`❌ Could not start playback: ${outcome.error || "Unknown error"}`);
                    return safeEditReply(interaction, { embeds: [embed] });
                }
                await ensureNowPlayingDashboardVisible(client, player, outcome.track || track);
            } else {
                await refreshNowPlayingDashboard(client, player).catch(() => {});
            }

            embed.setDescription(`Queued from history \`#${playIndex}\`: **${truncateText(target.title, 50)}**.`);
            return safeEditReply(interaction, { embeds: [embed] });
        }

        if (!history.length) {
            const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) return;
            embed.setDescription(
                scope === "personal"
                    ? "Kamu belum memiliki riwayat lagu yang selesai diputar."
                    : "No songs have been played in this server yet.",
            );
            return safeEditReply(interaction, { embeds: [embed] });
        }

        const totalPersonalMs = scope === "personal" ? history.reduce((acc, h) => acc + Number(h.listenedMs || 0), 0) : 0;

        const lines = history.map((item, idx) => {
            const dur =
                scope === "personal"
                    ? formatListeningDuration(item.listenedMs || item.duration || 0)
                    : item.isStream
                      ? "LIVE"
                      : convertTime(item.duration || 0);
            const playedTs = item.playedAt ? `<t:${Math.floor(new Date(item.playedAt).getTime() / 1000)}:R>` : "";
            const title = truncateText(item.title, 38);
            const artist = truncateText(item.author, 22);
            return `\`${idx + 1}.\` ${item.uri ? `**[${title}](${item.uri})**` : `**${title}**`} — *${artist}* (\`${dur}\`) ${playedTs}`;
        });

        embed
            .setAuthor({
                name:
                    scope === "personal"
                        ? `${botName} • Personal Listening History (${interaction.user.username})`
                        : `${botName} • Server Playback History`,
                iconURL: client.user?.displayAvatarURL?.(),
            })
            .setFooter({
                text:
                    scope === "personal"
                        ? `${history.length} lagu terakhir • Total didengar di daftar ini: ${formatListeningDuration(totalPersonalMs)} • Replay: /history scope:personal play_index:<no>`
                        : `Showing ${history.length} recent track(s) • Replay with /history play_index:<number>`,
            });

        const pages = lodash.chunk(lines, 10).map((c) => c.join("\n"));
        return createPage(client, interaction, embed, pages);
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
