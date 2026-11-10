const Logger = require("../../../utils/logger");

module.exports = (client, node) => {
    Logger.warn(`Node ${node.options.name} closed`);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
