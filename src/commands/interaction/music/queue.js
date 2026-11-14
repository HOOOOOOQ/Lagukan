const { EmbedBuilder, MessageFlags } = require("discord.js");
const { createPage } = require("../../../functions/createPage.js");
const { convertTime } = require("../../../functions/timeFormat.js");
const { formatTrackSourceLabel } = require("../../../functions/musicSourceResolver.js");
const { checkDjAccess, isGuildAutoplayEnabled } = require("../../../functions/musicPermissions.js");
const { refreshNowPlayingDashboard, formatRepeatLabel, truncateText } = require("../../../functions/nowPlayingManager.js");
const { safeReply, safeDeferReply } = require("../../../functions/interactionResponder.js");
const lodash = require("lodash");

module.exports = {
    name: "queue",
    description: "View or manage the Lagukan music queue (move or skip to position)",
    category: "music",
    options: [
        {
            name: "move_from",
            description: "Queue position of the song to move (1 = next up)",
            type: 4,
            min_value: 1,
            required: false,
        },
        {
            name: "move_to",
            description: "Target queue position to move the song to",
            type: 4,
            min_value: 1,
            required: false,
        },
        {
            name: "skipto",
            description: "Jump directly to a specific queue position",
            type: 4,
            min_value: 1,
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
        current: true,
    },
    devOnly: false,
    run: async (client, interaction, player) => {
        const botName = client.config.botName || "Lagukan";
        const embed = new EmbedBuilder().setColor(client.config.embedColor);

        const moveFrom = interaction.options.getInteger("move_from");
        const moveTo = interaction.options.getInteger("move_to");
        const skipTo = interaction.options.getInteger("skipto");

        // Handle Move / SkipTo queue mutations (requires same VC + DJ access)
        if (moveFrom !== null || moveTo !== null || skipTo !== null) {
            if (!interaction.member?.voice?.channelId || interaction.member.voice.channelId !== player.voiceId) {
                embed.setDescription(`You need to be in the same voice channel as ${botName} to modify the queue.`);
                return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
            }

            const djCheck = checkDjAccess(client, {
                guild: interaction.guild,
                member: interaction.member,
                user: interaction.user,
                player,
                track: player.queue.current,
                allowRequester: false,
                interaction,
            });
            if (!djCheck.allowed) {
                embed.setDescription(djCheck.reason);
                return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
            }

            if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;
            if (skipTo !== null) {
                if (player.queue.isEmpty || skipTo < 1 || skipTo > player.queue.size) {
                    embed.setDescription(
                        player.queue.isEmpty
                            ? "The queue is empty."
                            : `Invalid queue position. Choose between \`1\` and \`${player.queue.size}\`.`,
                    );
                    return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
                }

                const targetTrack = player.queue[skipTo - 1];
                const removedTracks = skipTo > 1 ? player.queue.splice(0, skipTo - 1) : [];
                try {
                    await Promise.resolve(player.skip());
                } catch (error) {
                    if (removedTracks.length) player.queue.unshift(...removedTracks);
                    throw error;
                }

                embed.setDescription(`⏭️ Skipped to position \`#${skipTo}\`: **${truncateText(targetTrack?.title, 50)}**.`);
                return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
            }

            if (moveFrom === null || moveTo === null) {
                embed.setDescription("Provide both `move_from` and `move_to` positions to move a track.");
                return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
            }

            if (player.queue.isEmpty || moveFrom < 1 || moveFrom > player.queue.size || moveTo < 1 || moveTo > player.queue.size) {
                embed.setDescription(
                    player.queue.isEmpty ? "The queue is empty." : `Positions must be between \`1\` and \`${player.queue.size}\`.`,
                );
                return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
            }

            if (moveFrom === moveTo) {
                embed.setDescription(`Track is already at position \`#${moveTo}\`.`);
                return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
            }

            const [movedTrack] = player.queue.splice(moveFrom - 1, 1);
            player.queue.splice(moveTo - 1, 0, movedTrack);
            await refreshNowPlayingDashboard(client, player);

            embed.setDescription(`Moved **${truncateText(movedTrack?.title, 50)}** from \`#${moveFrom}\` to \`#${moveTo}\`.`);
            return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // View Paginated Queue
        const current = player.queue.current;
        const currentDur = current.isStream ? "LIVE" : convertTime(current.duration || 0);
        const currentUrl = current.pluginInfo?.originalUri || current.uri;
        const headerBlock =
            `**Now Playing:**\n` +
            `${currentUrl ? `**[${truncateText(current.title, 48)}](${currentUrl})**` : `**${truncateText(current.title, 48)}**`} — *${truncateText(current.author, 30)}* (\`${currentDur}\` • \`${formatTrackSourceLabel(current)}\`)\n`;

        if (player.queue.isEmpty) {
            embed
                .setAuthor({ name: `${botName} • Server Queue`, iconURL: client.user.displayAvatarURL() })
                .setDescription(`${headerBlock}\n*No upcoming tracks in queue.*`)
                .setFooter({
                    text: `Loop: ${formatRepeatLabel(player.loop)} • Autoplay: ${isGuildAutoplayEnabled(client, player.guildId) ? "On" : "Off"}`,
                    iconURL: client.user.displayAvatarURL(),
                });

            if (interaction.guild?.iconURL?.()) embed.setThumbnail(interaction.guild.iconURL());
            return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        const queueList = player.queue.map((track, index) => {
            const trackUrl = track.pluginInfo?.originalUri || track.uri;
            const trackTitle = truncateText(track.title || "Unknown Title", 36);
            const trackArtist = truncateText(track.author || "Unknown Artist", 24);
            const trackDuration = track.isStream ? "LIVE" : convertTime(track.duration || 0);

            return `\`${index + 1}.\` ${trackUrl ? `**[${trackTitle}](${trackUrl})**` : `**${trackTitle}**`} — *${trackArtist}* • \`${trackDuration}\``;
        });

        const totalQueueDuration = convertTime(player.queue.duration || 0);

        embed
            .setAuthor({ name: `${botName} • Queue List`, iconURL: client.user.displayAvatarURL() })
            .setColor(client.config.embedColor)
            .setFooter({
                text: `Upcoming: ${player.queue.size} song(s) • Queue Duration: ${totalQueueDuration} • Loop: ${formatRepeatLabel(player.loop)}`,
                iconURL: client.user.displayAvatarURL(),
            });

        if (interaction.guild?.iconURL?.()) {
            embed.setThumbnail(interaction.guild.iconURL());
        }

        const pages = lodash.chunk(queueList, 10).map((chunkLines) => `${headerBlock}\n**Up Next:**\n${chunkLines.join("\n")}`);

        return createPage(client, interaction, embed, pages);
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
