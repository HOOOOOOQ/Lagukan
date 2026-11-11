const { EmbedBuilder } = require("discord.js");
const {
    PLAYER_STATE_DESTROYED,
    isGuildManuallyDisconnected,
    isGuildLeavingInProgress,
} = require("../../../functions/voiceSessionManager.js");
const {
    isGuildAutoplayEnabled,
    setGuildAutoplay,
    findAutoplayRecommendation,
    getGuildMusicSettings,
} = require("../../../functions/musicPermissions.js");
const { cleanupNowPlayingMessage } = require("../../../functions/nowPlayingManager.js");
const {
    getGuildRadioState,
    stopGuildRadioMode,
    pickNextRadioOrAutoDjTrack,
    clearAutoResumeSnapshot,
} = require("../../../functions/radioAndSleepManager.js");

module.exports = async (client, player) => {
    if (
        !player ||
        player.state === PLAYER_STATE_DESTROYED ||
        player.sudoDestroy ||
        isGuildManuallyDisconnected(client, player.guildId) ||
        isGuildLeavingInProgress(player.guildId)
    ) {
        return;
    }

    // Guard against Rainlink 1.2.9 emitting queueEmpty during loadFailed/cleanup when tracks remain in queue
    if (Number(player.queue?.size || 0) > 0 || player.queue?.current) {
        return;
    }

    // Honor explicit user Stop (/stop or [Stop] button): do not auto-restart Autoplay/Radio or auto-leave immediately
    if (player._manualStopAt && Date.now() - player._manualStopAt < 5000) {
        player._manualStopAt = 0;
        clearAutoResumeSnapshot(player.guildId);
        await cleanupNowPlayingMessage(player, true);
        return;
    }

    await cleanupNowPlayingMessage(player, true);

    const channel = client.channels.cache.get(player.textId);

    // 1. Radio Mode & Auto DJ continuous verified feed
    const radioState = getGuildRadioState(player.guildId);
    if (radioState?.enabled) {
        const nextRadioTrack = await pickNextRadioOrAutoDjTrack(client, player);
        if (
            isGuildManuallyDisconnected(client, player.guildId) ||
            isGuildLeavingInProgress(player.guildId) ||
            player.state === PLAYER_STATE_DESTROYED ||
            player.sudoDestroy
        ) {
            return;
        }

        if (nextRadioTrack) {
            player.queue.add(nextRadioTrack);
            if (!player.playing && player.state !== PLAYER_STATE_DESTROYED && !player.sudoDestroy) {
                player.paused = false;
                await Promise.resolve(player.play()).catch(() => {});
            }
            return;
        }

        // Cleanly stop Radio Mode if no valid replacement source could be verified
        stopGuildRadioMode(player.guildId);
    }

    const autoplayEnabled = isGuildAutoplayEnabled(client, player.guildId);

    if (autoplayEnabled) {
        const nextTrack = await findAutoplayRecommendation(client, player);

        if (
            isGuildManuallyDisconnected(client, player.guildId) ||
            isGuildLeavingInProgress(player.guildId) ||
            player.state === PLAYER_STATE_DESTROYED ||
            player.sudoDestroy
        ) {
            return;
        }

        if (!nextTrack) {
            await setGuildAutoplay(client, player.guildId, false);
            const guildData = client.data.get(`guildData_${player.guildId}`);
            if (guildData && !guildData.manualDisconnect && guildData.reconnect?.status) return;

            if (player.state !== PLAYER_STATE_DESTROYED && !player.sudoDestroy) {
                await Promise.resolve(player.destroy()).catch(() => {});
            }
            return;
        }

        player.queue.add(nextTrack);

        if (!player.playing && player.state !== PLAYER_STATE_DESTROYED && !player.sudoDestroy) {
            player.paused = false;
            await Promise.resolve(player.play()).catch(() => {});
        }
        return;
    }

    const guildData = client.data.get(`guildData_${player.guildId}`);
    if (guildData && !guildData.manualDisconnect && guildData.reconnect?.status) {
        return;
    }

    const musicSettings = getGuildMusicSettings(client, player.guildId);
    if (musicSettings?.autoLeave?.enabled === false) {
        const stayEmbed = new EmbedBuilder()
            .setColor(client.config.embedColor)
            .setDescription("Queue has finished. Staying in voice channel because Auto-Leave is disabled.");
        if (channel) await channel.send({ embeds: [stayEmbed] }).catch(() => {});
        return;
    }

    const embed = new EmbedBuilder()
        .setColor(client.config.embedColor)
        .setDescription("The queue is empty. Leaving voice channel (use `/247` or `/musicconfig` to stay connected).");

    if (channel) await channel.send({ embeds: [embed] }).catch(() => {});

    if (player.state !== PLAYER_STATE_DESTROYED && !player.sudoDestroy) {
        await Promise.resolve(player.destroy()).catch(() => {});
    }
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
