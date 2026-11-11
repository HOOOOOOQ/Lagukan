const { PLAYER_STATE_DESTROYED } = require("../../../functions/voiceSessionManager.js");
const { refreshNowPlayingDashboard } = require("../../../functions/nowPlayingManager.js");

module.exports = async (client, player) => {
    if (!player || player.state === PLAYER_STATE_DESTROYED || player.sudoDestroy) return;
    await refreshNowPlayingDashboard(client, player);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
