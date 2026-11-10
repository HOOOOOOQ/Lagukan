const { PermissionsBitField, EmbedBuilder } = require("discord.js");
const { handleVoiceStateLog } = require("../../../functions/voiceLogger.js");
const { handlePassiveMemberObservation } = require("../../../functions/serverTagLogger.js");
const { handleCrossGuildUserTagAutoRole } = require("../../../functions/serverTagAutoRole.js");
const {
    isGuildManuallyDisconnected,
    isGuildLeavingInProgress,
    cancelInactivityTimer,
    registerInactivityTimer,
    clearInactivityTimerRef,
} = require("../../../functions/voiceSessionManager.js");

module.exports = async (client, oldState, newState) => {
    handleVoiceStateLog(client, oldState, newState).catch(() => {});
    const activeVoiceMember = newState?.member || oldState?.member;
    if (activeVoiceMember?.guild && activeVoiceMember?.user && !activeVoiceMember.user.bot) {
        handlePassiveMemberObservation(client, activeVoiceMember.guild, activeVoiceMember.user, activeVoiceMember).catch(() => {});
        handleCrossGuildUserTagAutoRole(client, activeVoiceMember.user, {
            originGuildId: activeVoiceMember.guild.id,
            member: activeVoiceMember,
        }).catch(() => {});
    }

    const guildId = String(newState?.guildId || oldState?.guildId || "");
    if (!guildId) return;

    if (newState.channelId && newState.channel?.type == 13 && newState.guild?.members?.me?.voice?.suppress) {
        if (
            newState.guild.members.me.permissions.has(PermissionsBitField.Flags.Speak) ||
            newState.channel.permissionsFor(newState.guild.members.me)?.has(PermissionsBitField.Flags.Speak)
        ) {
            newState.guild.members.me.voice.setSuppressed(false).catch(() => {});
        }
    }

    // Handle the bot's own disconnect from a voice channel without double-destroying during /leave
    if (newState.channelId == null && newState.member?.user?.id === client.user?.id) {
        cancelInactivityTimer(guildId);

        if (isGuildLeavingInProgress(guildId)) {
            return;
        }

        const newStatePlayer = client.rainlink.players.get(guildId);
        if (newStatePlayer && newStatePlayer.state !== 2 && !newStatePlayer.sudoDestroy) {
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

    const oldStatePlayer = client.rainlink.players.get(guildId);

    if (!oldStatePlayer || oldStatePlayer.state === 2 || oldStatePlayer.sudoDestroy) {
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
            const timer = setTimeout(async () => {
                clearInactivityTimerRef(guildId, timer);

                if (isGuildManuallyDisconnected(client, guildId) || isGuildLeavingInProgress(guildId)) {
                    return;
                }

                const latestGuildData = client.data.get(`guildData_${guildId}`);
                if (latestGuildData && !latestGuildData.manualDisconnect && latestGuildData.reconnect?.status) {
                    return;
                }

                const currentPlayer = client.rainlink.players.get(guildId);
                if (!currentPlayer || currentPlayer !== oldStatePlayer || currentPlayer.state === 2 || currentPlayer.sudoDestroy) {
                    return;
                }

                const currentBotChannel = targetGuild?.members?.me?.voice?.channel;
                const stillBotAlone = Boolean(currentBotChannel && currentBotChannel.members.filter((m) => !m.user.bot).size === 0);
                const stillNotPlaying = !currentPlayer.playing && !currentPlayer.queue.current;

                if (stillBotAlone || stillNotPlaying) {
                    if (currentPlayer.message) {
                        const prevMsg = currentPlayer.message;
                        currentPlayer.message = null;
                        await prevMsg.delete().catch(() => {});
                    }

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
            }, client.config.leaveTimeout);

            if (typeof timer.unref === "function") timer.unref();
            registerInactivityTimer(guildId, timer);
        }
    }
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
