const { PLAYER_STATE_DESTROYED } = require("../../../functions/voiceSessionManager.js");
const { refreshNowPlayingDashboard } = require("../../../functions/nowPlayingManager.js");

module.exports = async (client, player) => {
    if (!player || player.state === PLAYER_STATE_DESTROYED || player.sudoDestroy) return;
    if (!player.playing || player.paused || !player.queue?.current || !player.message) return;

    await refreshNowPlayingDashboard(client, player, { throttleProgress: true });
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
