const { PLAYER_STATE_DESTROYED } = require("../../../functions/voiceSessionManager.js");
const { resetPlaybackFailure } = require("../../../functions/nodeHealthManager.js");
const { recordGuildTrackHistory } = require("../../../functions/musicPermissions.js");
const { sendOrReplaceNowPlayingDashboard } = require("../../../functions/nowPlayingManager.js");
const { onTrackSessionStart } = require("../../../functions/musicStatsEngine.js");
const { openOrSyncVoiceSession666 } = require("../../../functions/profileNotificationManager.js");
const { onProfile666TrackStart } = require("../../../functions/profile666Engine.js");
const { resetPartyVoteSkip } = require("../../../functions/musicPartySystem.js");
const { saveAutoResumeSnapshot } = require("../../../functions/radioAndSleepManager.js");
const { refreshRequestPanelMessage } = require("../../../functions/voiceRequestSystem.js");
const Logger = require("../../../utils/logger");

module.exports = async (client, player, track) => {
    if (!player || player.state === PLAYER_STATE_DESTROYED || player.sudoDestroy || !track) return;

    resetPlaybackFailure(player.guildId);

    const isGuessTheSong = Boolean(player.data?.get?.("guessTheSongActive"));
    if (!isGuessTheSong) {
        await openOrSyncVoiceSession666(client, player).catch(() => {});
        recordGuildTrackHistory(client, player.guildId, track).catch(() => {});
        await Promise.all([
            onTrackSessionStart(client, player, track).catch(() => {}),
            onProfile666TrackStart(client, player, track).catch(() => {}),
        ]);
        resetPartyVoteSkip(client, player.guildId).catch(() => {});
        saveAutoResumeSnapshot(player);
        refreshRequestPanelMessage(client, player.guildId).catch(() => {});
    }

    Logger.music("info", `Track playback started: ${isGuessTheSong ? "[GuessTheSong Snippet]" : track.title || "Unknown"}`, {
        guildId: player.guildId,
        userId: track.requester?.id || "autoplay",
        command: "trackStart",
        playerStatus: `playing(vol=${player.volume}%)`,
        nodeStatus: player.node?.options?.name || "Lavalink",
    });

    if (!isGuessTheSong) {
        await sendOrReplaceNowPlayingDashboard(client, player, track);
    }
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
