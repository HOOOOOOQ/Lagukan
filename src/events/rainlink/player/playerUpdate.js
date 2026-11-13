const { PLAYER_STATE_DESTROYED } = require("../../../functions/voiceSessionManager.js");
const { refreshNowPlayingDashboard } = require("../../../functions/nowPlayingManager.js");
const { onTrackSessionTick } = require("../../../functions/musicStatsEngine.js");
const { onProfile666Tick } = require("../../../functions/profile666Engine.js");
const { saveAutoResumeSnapshot } = require("../../../functions/radioAndSleepManager.js");

module.exports = async (client, player, data) => {
    if (!player || player.state === PLAYER_STATE_DESTROYED || player.sudoDestroy) return;

    if (data?.state) {
        if (typeof data.state.connected === "boolean") {
            player._voiceConnected = data.state.connected;
        }
        if (Number.isFinite(Number(data.state.ping))) {
            player._voicePing = Number(data.state.ping);
        }
    }

    if (!player.data?.get?.("guessTheSongActive")) {
        onTrackSessionTick(client, player);
        onProfile666Tick(client, player);
        if (player.playing && !player.paused) {
            saveAutoResumeSnapshot(player);
        }
    }

    if (!player.playing || player.paused || !player.queue?.current || !player.message) return;

    await refreshNowPlayingDashboard(client, player, { throttleProgress: true });
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
