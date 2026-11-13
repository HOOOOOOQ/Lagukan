const { EmbedBuilder } = require("discord.js");
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
const { openOrSyncVoiceSession666, closeVoiceSession666 } = require("../../../functions/profileNotificationManager.js");
const { getAuto247Config, isAuto247EnabledCached, scheduleAuto247Reconnect } = require("../../../functions/auto247Manager.js");
const { THEME_666 } = require("../../../functions/cardRenderer666.js");
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

    const isSelfEvent =
        String(newState.member?.user?.id || oldState?.member?.user?.id || newState.id || "") === String(client.user?.id || "");

    // Track real-time Server Mute toggles on this bot
    if (isSelfEvent && newState.channelId && oldState?.serverMute !== newState?.serverMute) {
        const activeBotPlayer = getGuildPlayer(client, guildId);
        if (activeBotPlayer) {
            activeBotPlayer.data?.set?.("serverMuted", Boolean(newState.serverMute));
            refreshNowPlayingDashboard(client, activeBotPlayer).catch(() => {});
        }
    }

    // Track bot moving between Voice Channels (e.g. moved by Admin from VC 1 to VC 2) -> re-sync isolated session!
    if (isSelfEvent && oldState?.channelId && newState?.channelId && oldState.channelId !== newState.channelId) {
        const movedPlayer = getGuildPlayer(client, guildId);
        if (movedPlayer) {
            movedPlayer.voiceId = newState.channelId;
            await openOrSyncVoiceSession666(client, movedPlayer).catch(() => {});
        }
    }

    // Handle THIS bot's disconnect from a voice channel + Auto 24/7 recovery
    if (isSelfEvent && newState.channelId == null) {
        cancelInactivityTimer(guildId, client);
        await closeVoiceSession666(client, guildId, "voice_disconnected");

        if (isGuildLeavingInProgress(guildId, client) || isGuildManuallyDisconnected(client, guildId)) {
            return;
        }

        const stalePlayer = getGuildPlayer(client, guildId);
        if (stalePlayer && stalePlayer.state !== PLAYER_STATE_DESTROYED && !stalePlayer.sudoDestroy) {
            await Promise.resolve(stalePlayer.destroy()).catch(() => {});
        } else {
            await scheduleAuto247Reconnect(client, guildId, "voice_disconnected");
        }
        return;
    }

    if (isGuildManuallyDisconnected(client, guildId) || isGuildLeavingInProgress(guildId, client)) {
        cancelInactivityTimer(guildId, client);
        return;
    }

    // Never auto-disconnect on inactivity when Auto 24/7 is active for THIS bot!
    if (isAuto247EnabledCached(client, guildId)) {
        cancelInactivityTimer(guildId, client);
        return;
    }
    const auto247Cfg = await getAuto247Config(client, guildId);
    if (auto247Cfg?.enabled) {
        cancelInactivityTimer(guildId, client);
        return;
    }

    const musicSettings = getGuildMusicSettings(client, guildId);
    if (musicSettings?.autoLeave?.enabled === false) {
        cancelInactivityTimer(guildId, client);
        return;
    }

    const autoLeaveTimeoutMs = Number(musicSettings?.autoLeave?.timeout) || client.config.leaveTimeout || 60000;
    const oldStatePlayer = getGuildPlayer(client, guildId);

    if (!oldStatePlayer || oldStatePlayer.state === PLAYER_STATE_DESTROYED || oldStatePlayer.sudoDestroy) {
        cancelInactivityTimer(guildId, client);
        return;
    }

    const targetGuild = oldState?.guild || newState?.guild;
    const botVoiceChannel = targetGuild?.members?.me?.voice?.channel;
    const isBotAlone = Boolean(botVoiceChannel && botVoiceChannel.members.filter((m) => !m.user.bot).size === 0);
    const isNotPlaying = !oldStatePlayer.playing && !oldStatePlayer.queue.current;

    if (!isBotAlone && !isNotPlaying) {
        cancelInactivityTimer(guildId, client);
        return;
    }

    if (oldStatePlayer.voiceId || targetGuild?.members?.me?.voice?.channelId === oldState?.channelId) {
        if (isBotAlone || isNotPlaying) {
            const timer = setTimeout(() => {
                void (async () => {
                    try {
                        clearInactivityTimerRef(guildId, timer, client);

                        if (isGuildManuallyDisconnected(client, guildId) || isGuildLeavingInProgress(guildId, client)) {
                            return;
                        }

                        const latestAuto247 = await getAuto247Config(client, guildId);
                        if (latestAuto247?.enabled) {
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
                                .setColor(THEME_666.embedColor)
                                .setDescription(
                                    "Disconnecting from the voice channel due to inactivity. You can keep this bot connected 24/7 using `/247-setup`.",
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
            registerInactivityTimer(guildId, timer, client);
        }
    }
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
