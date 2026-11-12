const { PermissionsBitField, EmbedBuilder } = require("discord.js");
const { handleVoiceStateLog } = require("../../../functions/voiceLogger.js");
const {
    PLAYER_STATE_DESTROYED,
    getGuildPlayer,
    isGuildManuallyDisconnected,
    isGuildLeavingInProgress,
    cancelInactivityTimer,
    registerInactivityTimer,
    clearInactivityTimerRef,
} = require("../../../functions/voiceSessionManager.js");
const { getGuildMusicSettings } = require("../../../functions/musicPermissions.js");
const { cleanupNowPlayingMessage, refreshNowPlayingDashboard } = require("../../../functions/nowPlayingManager.js");
const Logger = require("../../../utils/logger");

module.exports = async (client, oldState, newState) => {
    handleVoiceStateLog(client, oldState, newState).catch(() => {});

    const guildId = String(newState?.guildId || oldState?.guildId || "");
    if (!guildId) return;

    if (newState.channelId && newState.channel?.type == 13 && newState.guild?.members?.me?.voice?.suppress) {
        const botVoice = newState.guild.members.me.voice;
        botVoice.setSuppressed(false).catch(() => {
            if (typeof botVoice.setRequestToSpeak === "function") {
                return botVoice.setRequestToSpeak(true).catch(() => {});
            }
        });
    }

    // Track real-time Server Mute toggles on the bot so the dashboard warns immediately
    if (newState.channelId && newState.member?.user?.id === client.user?.id && oldState?.serverMute !== newState?.serverMute) {
        const activeBotPlayer = getGuildPlayer(client, guildId);
        if (activeBotPlayer) {
            activeBotPlayer.data?.set?.("serverMuted", Boolean(newState.serverMute));
            refreshNowPlayingDashboard(client, activeBotPlayer).catch(() => {});
        }
    }

    // Handle the bot's own disconnect from a voice channel without double-destroying during /leave
    if (newState.channelId == null && newState.member?.user?.id === client.user?.id) {
        cancelInactivityTimer(guildId);

        if (isGuildLeavingInProgress(guildId)) {
            return;
        }

        const newStatePlayer = getGuildPlayer(client, guildId);
        if (newStatePlayer && newStatePlayer.state !== PLAYER_STATE_DESTROYED && !newStatePlayer.sudoDestroy) {
            await Promise.resolve(newStatePlayer.destroy()).catch(() => {});
        }
        return;
    }

    if (isGuildManuallyDisconnected(client, guildId) || isGuildLeavingInProgress(guildId)) {
        cancelInactivityTimer(guildId);
        return;
    }

    const guildData = client.data.get(`guildData_${guildId}`);

    if (guildData && !guildData.manualDisconnect && guildData.reconnect?.status) {
        cancelInactivityTimer(guildId);
        return;
    }

    const musicSettings = getGuildMusicSettings(client, guildId);
    if (musicSettings?.autoLeave?.enabled === false) {
        cancelInactivityTimer(guildId);
        return;
    }

    const autoLeaveTimeoutMs = Number(musicSettings?.autoLeave?.timeout) || client.config.leaveTimeout || 60000;

    const oldStatePlayer = getGuildPlayer(client, guildId);

    if (!oldStatePlayer || oldStatePlayer.state === PLAYER_STATE_DESTROYED || oldStatePlayer.sudoDestroy) {
        cancelInactivityTimer(guildId);
        return;
    }

    const targetGuild = oldState?.guild || newState?.guild;
    const botVoiceChannel = targetGuild?.members?.me?.voice?.channel;
    const isBotAlone = Boolean(botVoiceChannel && botVoiceChannel.members.filter((m) => !m.user.bot).size === 0);
    const isNotPlaying = !oldStatePlayer.playing && !oldStatePlayer.queue.current;

    if (!isBotAlone && !isNotPlaying) {
        cancelInactivityTimer(guildId);
        return;
    }

    if (oldStatePlayer.voiceId || targetGuild?.members?.me?.voice?.channelId === oldState?.channelId) {
        if (isBotAlone || isNotPlaying) {
            const timer = setTimeout(() => {
                void (async () => {
                    try {
                        clearInactivityTimerRef(guildId, timer);

                        if (isGuildManuallyDisconnected(client, guildId) || isGuildLeavingInProgress(guildId)) {
                            return;
                        }

                        const latestGuildData = client.data.get(`guildData_${guildId}`);
                        if (latestGuildData && !latestGuildData.manualDisconnect && latestGuildData.reconnect?.status) {
                            return;
                        }

                        const latestMusicSettings = getGuildMusicSettings(client, guildId);
                        if (latestMusicSettings?.autoLeave?.enabled === false) {
                            return;
                        }

                        const currentPlayer = getGuildPlayer(client, guildId);
                        if (
                            !currentPlayer ||
                            currentPlayer !== oldStatePlayer ||
                            currentPlayer.state === PLAYER_STATE_DESTROYED ||
                            currentPlayer.sudoDestroy
                        ) {
                            return;
                        }

                        const currentBotChannel = targetGuild?.members?.me?.voice?.channel;
                        const stillBotAlone = Boolean(currentBotChannel && currentBotChannel.members.filter((m) => !m.user.bot).size === 0);
                        const stillNotPlaying = !currentPlayer.playing && !currentPlayer.queue.current;

                        if (stillBotAlone || stillNotPlaying) {
                            await cleanupNowPlayingMessage(currentPlayer, true);

                            await Promise.resolve(currentPlayer.destroy()).catch(() => {});

                            const leaveChannel = client.channels.cache.get(currentPlayer.textId);
                            if (!leaveChannel?.send) return;

                            const timeoutEmbed = new EmbedBuilder()
                                .setColor(client.config.embedColor)
                                .setDescription(
                                    `Disconnecting from the voice channel due to inactivity. You can disable this by using \`247\` command.`,
                                );

                            const msg = await leaveChannel.send({ embeds: [timeoutEmbed] }).catch(() => null);
                            if (msg) {
                                const delTimer = setTimeout(() => {
                                    msg.delete().catch(() => {});
                                }, 10000);
                                if (typeof delTimer.unref === "function") delTimer.unref();
                            }
                        }
                    } catch (err) {
                        Logger.debug(`[VoiceStateUpdate] Gagal memproses timer inaktivitas (${guildId}): ${err?.message || err}`);
                    }
                })().catch((err) => {
                    Logger.debug(`[VoiceStateUpdate] Penanganan error timer inaktivitas (${guildId}): ${err?.message || err}`);
                });
            }, autoLeaveTimeoutMs);

            if (typeof timer.unref === "function") timer.unref();
            registerInactivityTimer(guildId, timer);
        }
    }
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
