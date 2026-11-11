const { PLAYER_STATE_DESTROYED } = require("../../../functions/voiceSessionManager.js");
const { resetPlaybackFailure } = require("../../../functions/nodeHealthManager.js");
const { recordGuildTrackHistory } = require("../../../functions/musicPermissions.js");
const { sendOrReplaceNowPlayingDashboard } = require("../../../functions/nowPlayingManager.js");
const Logger = require("../../../utils/logger");

module.exports = async (client, player, track) => {
    if (!player || player.state === PLAYER_STATE_DESTROYED || player.sudoDestroy || !track) return;

    resetPlaybackFailure(player.guildId);
    recordGuildTrackHistory(client, player.guildId, track).catch(() => {});

    Logger.music("info", `Track playback started: ${track.title || "Unknown"}`, {
        guildId: player.guildId,
        userId: track.requester?.id || "autoplay",
        command: "trackStart",
        playerStatus: `playing(vol=${player.volume}%)`,
        nodeStatus: player.node?.options?.name || "Lavalink",
    });

    await sendOrReplaceNowPlayingDashboard(client, player, track);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
