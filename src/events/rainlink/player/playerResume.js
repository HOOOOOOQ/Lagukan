const { PLAYER_STATE_DESTROYED } = require("../../../functions/voiceSessionManager.js");
const { refreshNowPlayingDashboard } = require("../../../functions/nowPlayingManager.js");
const { onProfile666Resume } = require("../../../functions/profile666Engine.js");

module.exports = async (client, player) => {
    if (!player || player.state === PLAYER_STATE_DESTROYED || player.sudoDestroy) return;
    onProfile666Resume(client, player);
    await refreshNowPlayingDashboard(client, player);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
