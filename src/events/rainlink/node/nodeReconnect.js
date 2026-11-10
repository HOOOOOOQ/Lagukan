const Logger = require("../../../utils/logger");

module.exports = async (client, node) => {
    Logger.warn(`Node ${node.options.name} reconnecting...`);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
