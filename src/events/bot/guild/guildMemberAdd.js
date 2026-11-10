const { handlePassiveMemberObservation } = require("../../../functions/serverTagLogger.js");

module.exports = async (client, member) => {
    if (!member?.guild || !member?.user || member.user.bot) return;

    await handlePassiveMemberObservation(client, member.guild, member.user, member).catch(() => {});
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
