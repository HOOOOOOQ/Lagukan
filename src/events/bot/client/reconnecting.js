const Logger = require("../../../utils/logger");

module.exports = async (client) => {
    Logger.warn(`Reconnecting ${client.user.tag} (${client.user.id})`);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
