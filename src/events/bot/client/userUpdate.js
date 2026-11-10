const { handleUserTagUpdate } = require("../../../functions/serverTagLogger.js");
const { handleCrossGuildUserTagAutoRole } = require("../../../functions/serverTagAutoRole.js");

module.exports = async (client, oldUser, newUser) => {
    await Promise.allSettled([handleUserTagUpdate(client, oldUser, newUser), handleCrossGuildUserTagAutoRole(client, newUser)]);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
