const { handlePassiveMemberObservation } = require("../../../functions/serverTagLogger.js");
const { evaluateMemberTagAutoRole } = require("../../../functions/serverTagAutoRole.js");

module.exports = async (client, member) => {
    if (!member?.guild || !member?.user || member.user.bot) return;

    await Promise.allSettled([
        handlePassiveMemberObservation(client, member.guild, member.user, member),
        evaluateMemberTagAutoRole(client, member.guild, member.user, { member }),
    ]);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
