const { refreshNowPlayingDashboard } = require("../../../functions/nowPlayingManager.js");

module.exports = async (client, player) => {
    if (!player || !player.message) return;
    await refreshNowPlayingDashboard(client, player);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
