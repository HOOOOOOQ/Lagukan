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
const { getAuto247Config } = require("../../../functions/auto247Manager.js");
const { THEME_666 } = require("../../../functions/cardRenderer666.js");
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
        isGuildLeavingInProgress(player.guildId, client)
    ) {
        return;
    }

    if (Number(player.queue?.size || 0) > 0 || player.queue?.current) {
        return;
    }

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
            isGuildLeavingInProgress(player.guildId, client) ||
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

        stopGuildRadioMode(player.guildId);
    }

    const autoplayEnabled = isGuildAutoplayEnabled(client, player.guildId);

    if (autoplayEnabled) {
        const nextTrack = await findAutoplayRecommendation(client, player);

        if (
            isGuildManuallyDisconnected(client, player.guildId) ||
            isGuildLeavingInProgress(player.guildId, client) ||
            player.state === PLAYER_STATE_DESTROYED ||
            player.sudoDestroy
        ) {
            return;
        }

        if (!nextTrack) {
            await setGuildAutoplay(client, player.guildId, false);
            const auto247 = await getAuto247Config(client, player.guildId);
            if (auto247?.enabled) return;

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

    // Stay connected automatically when per-bot Auto 24/7 is enabled!
    const auto247Cfg = await getAuto247Config(client, player.guildId);
    if (auto247Cfg?.enabled) {
        return;
    }

    const musicSettings = getGuildMusicSettings(client, player.guildId);
    if (musicSettings?.autoLeave?.enabled === false) {
        const stayEmbed = new EmbedBuilder()
            .setColor(THEME_666.embedColor)
            .setDescription("Queue has finished. Staying in voice channel because Auto-Leave is disabled.");
        if (channel) await channel.send({ embeds: [stayEmbed] }).catch(() => {});
        return;
    }

    const embed = new EmbedBuilder().setColor(THEME_666.embedColor).setDescription("The queue is empty. Leaving voice channel.");

    if (channel) await channel.send({ embeds: [embed] }).catch(() => {});

    if (player.state !== PLAYER_STATE_DESTROYED && !player.sudoDestroy) {
        await Promise.resolve(player.destroy()).catch(() => {});
    }
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
