const { handleGuildMemberTagUpdate } = require("../../../functions/serverTagLogger.js");
const { handleCrossGuildUserTagAutoRole } = require("../../../functions/serverTagAutoRole.js");

module.exports = async (client, oldMember, newMember) => {
    const guild = newMember?.guild || oldMember?.guild;
    const user = newMember?.user || oldMember?.user;

    await Promise.allSettled([
        handleGuildMemberTagUpdate(client, oldMember, newMember),
        guild && user
            ? handleCrossGuildUserTagAutoRole(client, user, {
                  originGuildId: guild.id,
                  member: newMember?.roles?.add ? newMember : undefined,
              })
            : Promise.resolve(),
    ]);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
