const Logger = require("../../../utils/logger");

module.exports = async (client, error, id) => {
    Logger.error(`Shard ${id} error`, error);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
