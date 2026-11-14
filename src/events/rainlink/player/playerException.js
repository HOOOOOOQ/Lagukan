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

async function tryAlternateSourceFallback(client, player) {
    const failedTrack = player?.queue?.current;
    if (!failedTrack || failedTrack._playbackFallbackTried) return false;

    failedTrack._playbackFallbackTried = true;
    const cleanTitle = String(failedTrack.title || "").trim();
    const cleanAuthor = String(failedTrack.author || "")
        .replace(/ - Topic$/i, "")
        .trim();
    if (!cleanTitle) return false;

    const query = [cleanAuthor, cleanTitle].filter(Boolean).join(" - ");
    const altEngines = ["soundcloud", "youtubeMusic", "youtube"].filter(
        (eng) => eng.toLowerCase() !== String(failedTrack.source || "").toLowerCase(),
    );

    for (const engine of altEngines.slice(0, 2)) {
        const res = await client.rainlink.search(query, { requester: failedTrack.requester, engine }).catch(() => null);
        const backup = res?.tracks?.[0];
        if (backup?.encoded) {
            backup._playbackFallbackTried = true;
            await Promise.resolve(player.play(backup, { replaceCurrent: true })).catch(() => {});
            return true;
        }
    }

    return false;
}

module.exports = async (client, player, data) => {
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
    const errText = data?.exception?.message || data?.message || "Playback exception";
    Logger.music("error", `Player playback exception in ${guild?.name || "Unknown"}`, {
        guildId: player.guildId,
        userId: player.queue?.current?.requester?.id,
        command: "playerException",
        playerStatus: `playing=${player.playing},paused=${player.paused}`,
        nodeStatus: player.node?.options?.name || "Lavalink",
        errorMessage: errText,
    });

    await cleanupNowPlayingMessage(player, true);

    const breaker = recordPlaybackFailure(player.guildId, client.user?.id);
    const channel = client.channels.cache.get(player.textId);
    const embed = new EmbedBuilder().setColor(client.config.embedColor);

    if (!breaker.tripped) {
        const recovered = await tryAlternateSourceFallback(client, player);
        if (recovered) return;
    }

    await onTrackSessionFailed(client, player, player.queue?.current).catch(() => {});

    if (breaker.tripped) {
        player.queue.clear();
        embed.setDescription("Multiple consecutive playback errors occurred. Stopping queue to prevent loop.");
        if (channel) await channel.send({ embeds: [embed] }).catch(() => {});
        if (player.state !== PLAYER_STATE_DESTROYED && !player.sudoDestroy) {
            await Promise.resolve(player.stop()).catch(() => {});
        }
        return;
    }

    if (!player.queue.isEmpty) {
        embed.setDescription("Error while playing current track. Skipping to the next song...");
        if (channel) await channel.send({ embeds: [embed] }).catch(() => {});
    } else {
        embed.setDescription("Error while playing and the queue is empty. Stopping the player...");
        if (channel) await channel.send({ embeds: [embed] }).catch(() => {});
    }

    if (player.state !== PLAYER_STATE_DESTROYED && !player.sudoDestroy) {
        await Promise.resolve(player.skip()).catch(() => {});
    }
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
