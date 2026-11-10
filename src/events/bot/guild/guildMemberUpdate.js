const { handleGuildMemberTagUpdate } = require("../../../functions/serverTagLogger.js");

module.exports = async (client, oldMember, newMember) => {
    await handleGuildMemberTagUpdate(client, oldMember, newMember).catch(() => {});
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
