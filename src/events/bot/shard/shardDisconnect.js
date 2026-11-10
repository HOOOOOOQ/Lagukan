const Logger = require("../../../utils/logger");

module.exports = async (client, error, id) => {
    Logger.warn(`Shard ${id} disconnected`);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
