const Logger = require("../../../utils/logger");

module.exports = (client, node, code, reason) => {
    Logger.warn(`Node ${node.options.name} disconnected`, code, reason);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
