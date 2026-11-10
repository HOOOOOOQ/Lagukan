const { handleUserTagUpdate } = require("../../../functions/serverTagLogger.js");

module.exports = async (client, oldUser, newUser) => {
    await handleUserTagUpdate(client, oldUser, newUser).catch(() => {});
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
