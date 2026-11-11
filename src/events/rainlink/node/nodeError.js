const { recordNodeEvent } = require("../../../functions/nodeHealthManager.js");
const Logger = require("../../../utils/logger");

module.exports = (client, node, error) => {
    recordNodeEvent(node, "error", error);
    Logger.error(`Node ${node?.options?.name || "Lavalink"} error:`, error?.message || error);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
