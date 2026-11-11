const Logger = require("../../../utils/logger");

module.exports = async (client, node) => {
    const maxRetries = client?.rainlink?.rainlinkOptions?.options?.retryCount ?? 10;
    Logger.warn(`Node ${node?.options?.name || "Lavalink"} reconnecting (attempt ${node?.retryCounter || 1}/${maxRetries})...`);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
