const Logger = require("../../../utils/logger");

module.exports = (client, node, error) => {
    Logger.error(`Node ${node.options.name} error`, error);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
