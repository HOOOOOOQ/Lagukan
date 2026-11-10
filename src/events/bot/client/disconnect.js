const Logger = require("../../../utils/logger");

module.exports = async (client) => {
    Logger.warn(`Disconnected ${client.user.tag} (${client.user.id})`);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
