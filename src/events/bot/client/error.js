const Logger = require("../../../utils/logger");

module.exports = async (client, error, origin) => {
    Logger.error(`${client.user.tag} (${client.user.id})`, error, origin);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
