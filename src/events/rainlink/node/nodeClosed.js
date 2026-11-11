const { recordNodeEvent } = require("../../../functions/nodeHealthManager.js");
const Logger = require("../../../utils/logger");

module.exports = (client, node) => {
    recordNodeEvent(node, "closed");
    Logger.warn(`Node ${node?.options?.name || "Lavalink"} closed after reaching bounded retry limit`);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
