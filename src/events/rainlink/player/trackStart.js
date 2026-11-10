const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require("discord.js");
const { convertTime } = require("../../../functions/timeFormat.js");
const { safeReply, safeDeferUpdate } = require("../../../functions/interactionResponder.js");
const { PLAYER_STATE_DESTROYED, getGuildPlayer } = require("../../../functions/voiceSessionManager.js");
const Logger = require("../../../utils/logger");

module.exports = async (client, player, track) => {
    if (!player || player.state === PLAYER_STATE_DESTROYED || player.sudoDestroy) return;

    const textChannel = client.channels.cache.get(player.textId);
    if (!textChannel?.send) return;

    const botName = client.config.botName || "Lagukan";
    const formatString = (str, maxLength) => (str.length > maxLength ? str.substr(0, maxLength - 3) + "..." : str);
    const trackTitle = formatString(track.title || "Unknown", 30).replace(/ - Topic$/, "");
    const trackAuthor = formatString(track.author || "Unknown", 25).replace(/ - Topic$/, "");
    const trackDuration = track.isStream ? "LIVE" : convertTime(track.duration);
    const playerEmoji = client.emoji.player;

    const trackMsg = new EmbedBuilder()
        .setAuthor({
            name: player.paused ? `${botName} • Song Paused` : `${botName} • Now Playing`,
            iconURL: client.user.displayAvatarURL(),
        })
        .setColor(client.config.embedColor)
        .setThumbnail(track.artworkUrl)
        .setDescription(`**[${trackTitle} - ${trackAuthor}](${track.uri})**`)
        .setFields(
            { name: "Source", value: `${capitalize(track.source || "music")}`, inline: true },
            { name: "Duration", value: `\`${trackDuration}\``, inline: true },
            { name: "Requested by", value: `${track.requester}`, inline: true },
        )
        .setFooter({ text: `${botName} Music Bot`, iconURL: client.user.displayAvatarURL() });

    const button = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("pause")
            .setEmoji(player.paused ? playerEmoji.resume : playerEmoji.pause)
            .setStyle(player.paused ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("voldown").setEmoji(playerEmoji.voldown).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("volup").setEmoji(playerEmoji.volup).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("loop").setEmoji(playerEmoji.loop).setStyle(ButtonStyle.Secondary),
    );

    const button2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("shuffle").setEmoji(playerEmoji.shuffle).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("prev").setEmoji(playerEmoji.previous).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("skip").setEmoji(playerEmoji.skip).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("stop").setEmoji(playerEmoji.stop).setStyle(ButtonStyle.Danger),
    );

    const nplaying = await textChannel.send({ embeds: [trackMsg], components: [button, button2] }).catch(() => null);
    if (!nplaying) return;

    player.message = nplaying;

    const embed = new EmbedBuilder().setColor(client.config.embedColor);
    const collector = nplaying.createMessageComponentCollector();

    collector.on("collect", (message) => {
        void (async () => {
            try {
                const livePlayer = getGuildPlayer(client, player.guildId);
                if (!livePlayer || livePlayer !== player || player.state === PLAYER_STATE_DESTROYED || player.sudoDestroy) {
                    collector.stop();
                    embed.setDescription(`There is no active player in this server.`);
                    await safeReply(message, { embeds: [embed], flags: MessageFlags.Ephemeral });
                    return;
                }

                if (!message.member?.voice?.channel || player.voiceId !== message.member.voice.channelId) {
                    embed.setDescription(`You must be in the same voice channel as ${botName}.`);

                    return safeReply(message, { embeds: [embed], flags: MessageFlags.Ephemeral });
                }

                if (message.user.id !== track.requester?.id) {
                    embed.setDescription(`Only the requester can use this button.`);

                    return safeReply(message, { embeds: [embed], flags: MessageFlags.Ephemeral });
                }

                switch (message.customId) {
                    case "pause": {
                        const ack = await safeDeferUpdate(message);
                        if (!ack) return;

                        if (!player.paused) {
                            await Promise.resolve(player.pause()).catch(() => {});

                            button.components[0].setEmoji(playerEmoji.resume).setStyle(ButtonStyle.Primary);
                            trackMsg.setAuthor({ name: `${botName} • Song Paused`, iconURL: client.user.displayAvatarURL() });
                        } else {
                            await Promise.resolve(player.resume()).catch(() => {});

                            button.components[0].setEmoji(playerEmoji.pause).setStyle(ButtonStyle.Secondary);
                            trackMsg.setAuthor({ name: `${botName} • Now Playing`, iconURL: client.user.displayAvatarURL() });
                        }

                        await nplaying.edit({ embeds: [trackMsg], components: [button, button2] }).catch(() => {});
                        break;
                    }
                    case "prev": {
                        if (!player.queue.previous?.length) {
                            embed.setDescription(`Previous song not found.`);

                            return safeReply(message, { embeds: [embed], flags: MessageFlags.Ephemeral });
                        }

                        const ack = await safeDeferUpdate(message);
                        if (!ack) return;

                        await Promise.resolve(player.previous()).catch(() => {});
                        break;
                    }
                    case "skip": {
                        if (player.queue.isEmpty && !client.data.get("autoplay", player.guildId)) {
                            embed.setDescription(`Queue is empty. Skip not possible.`);

                            return safeReply(message, { embeds: [embed], flags: MessageFlags.Ephemeral });
                        }

                        const ack = await safeDeferUpdate(message);
                        if (!ack) return;

                        await Promise.resolve(player.skip()).catch(() => {});
                        break;
                    }
                    case "loop": {
                        switch (player.loop) {
                            case "none":
                                embed.setDescription(`Loop mode has been set to \`song\`.`);
                                player.setLoop("song");
                                break;
                            case "song":
                                embed.setDescription(`Loop mode has been set to \`queue\`.`);
                                player.setLoop("queue");
                                break;
                            case "queue":
                                embed.setDescription(`Loop mode has been set to \`off\`.`);
                                player.setLoop("none");
                                break;
                        }

                        return safeReply(message, { embeds: [embed], flags: MessageFlags.Ephemeral });
                    }
                    case "shuffle": {
                        if (player.queue.isEmpty) {
                            embed.setDescription(`Queue is empty. Shuffle not possible.`);

                            return safeReply(message, { embeds: [embed], flags: MessageFlags.Ephemeral });
                        }

                        player.queue.shuffle();

                        embed.setDescription(`Queue has been shuffled.`);

                        return safeReply(message, { embeds: [embed], flags: MessageFlags.Ephemeral });
                    }
                    case "voldown": {
                        if (player.volume <= client.config.minVolume) {
                            embed.setDescription(`Volume cannot be set below \`${client.config.minVolume}%\`.`);

                            return safeReply(message, { embeds: [embed], flags: MessageFlags.Ephemeral });
                        }

                        const volumeDown = player.volume - 10;
                        await Promise.resolve(player.setVolume(volumeDown)).catch(() => {});
                        embed.setDescription(`Volume has been set to \`${volumeDown}%\`.`);

                        return safeReply(message, { embeds: [embed], flags: MessageFlags.Ephemeral });
                    }
                    case "volup": {
                        if (player.volume >= client.config.maxVolume) {
                            embed.setDescription(`Volume cannot be set above \`${client.config.maxVolume}%\`.`);

                            return safeReply(message, { embeds: [embed], flags: MessageFlags.Ephemeral });
                        }

                        const volumeUp = player.volume + 10;
                        await Promise.resolve(player.setVolume(volumeUp)).catch(() => {});
                        embed.setDescription(`Volume has been set to \`${volumeUp}%\`.`);

                        return safeReply(message, { embeds: [embed], flags: MessageFlags.Ephemeral });
                    }
                    case "stop": {
                        const ack = await safeDeferUpdate(message);
                        if (!ack) return;

                        collector.stop();
                        await Promise.resolve(player.stop()).catch(() => {});
                        break;
                    }
                }
            } catch (err) {
                Logger.debug(`[TrackStartCollector] Error saat memproses tombol player: ${err?.message || err}`);
            }
        })().catch((err) => {
            Logger.debug(`[TrackStartCollector] Penanganan error tombol player: ${err?.message || err}`);
        });
    });
};

function capitalize(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
