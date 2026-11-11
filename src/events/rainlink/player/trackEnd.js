const { cleanupNowPlayingMessage } = require("../../../functions/nowPlayingManager.js");
const Logger = require("../../../utils/logger");

module.exports = async (client, player) => {
    if (!player) return;

    const guild = client.guilds?.cache?.get?.(player.guildId);
    Logger.debug(`Track ended from ${guild?.name || "Unknown"} (${player.guildId})`);

    await cleanupNowPlayingMessage(player, true);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
