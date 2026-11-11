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

    await cleanupNowPlayingMessage(player, true);

    const channel = client.channels.cache.get(player.textId);
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
