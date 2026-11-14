const { EmbedBuilder } = require("discord.js");
const {
    PLAYER_STATE_DESTROYED,
    isGuildManuallyDisconnected,
    isGuildLeavingInProgress,
} = require("../../../functions/voiceSessionManager.js");
const { recordPlaybackFailure } = require("../../../functions/nodeHealthManager.js");
const { cleanupNowPlayingMessage } = require("../../../functions/nowPlayingManager.js");
const { onTrackSessionFailed } = require("../../../functions/musicStatsEngine.js");
const Logger = require("../../../utils/logger");

module.exports = async (client, player, track, message) => {
    if (
        !player ||
        player.state === PLAYER_STATE_DESTROYED ||
        player.sudoDestroy ||
        isGuildManuallyDisconnected(client, player.guildId) ||
        isGuildLeavingInProgress(player.guildId)
    ) {
        return;
    }

    const guild = client.guilds.cache.get(player.guildId);
    Logger.music("error", `Track resolve error in ${guild?.name || "Unknown"}`, {
        guildId: player.guildId,
        userId: track?.requester?.id,
        command: "trackResolveError",
        playerStatus: `playing=${player.playing},queue=${player.queue?.size || 0}`,
        nodeStatus: player.node?.options?.name || "Lavalink",
        errorMessage: message || "Track load/resolve failed",
    });

    await onTrackSessionFailed(client, player, track).catch(() => {});
    await cleanupNowPlayingMessage(player, true);

    const breaker = recordPlaybackFailure(player.guildId, client.user?.id);
    const channel = client.channels.cache.get(player.textId);
    const embed = new EmbedBuilder().setColor(client.config.embedColor);

    if (breaker.tripped) {
        player.queue.clear();
        embed.setDescription("Too many consecutive tracks failed to resolve. Queue has been stopped safely.");
        if (channel) await channel.send({ embeds: [embed] }).catch(() => {});
        if (player.state !== PLAYER_STATE_DESTROYED && !player.sudoDestroy) {
            await Promise.resolve(player.stop()).catch(() => {});
        }
        return;
    }

    // Note: RainlinkPlayer#play() automatically advances to the next track or emits queueEmpty on trackResolveError
    if (!player.queue.isEmpty) {
        embed.setDescription(`Could not resolve audio for **${track?.title || "track"}**. Advancing to the next song...`);
        if (channel) await channel.send({ embeds: [embed] }).catch(() => {});
    } else {
        embed.setDescription(`Could not resolve audio for **${track?.title || "track"}** and queue is empty.`);
        if (channel) await channel.send({ embeds: [embed] }).catch(() => {});
    }
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
