const { recordNodeEvent } = require("../../../functions/nodeHealthManager.js");
const Logger = require("../../../utils/logger");

module.exports = (client, node, code, reason) => {
    recordNodeEvent(node, "disconnect", `${code || ""} ${reason || ""}`.trim());
    Logger.warn(`Node ${node?.options?.name || "Lavalink"} disconnected (code=${code ?? "unknown"})`);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
