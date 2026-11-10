const { createDataGuild } = require("../../../functions/createData.js");
const { initializeGuildServerTag } = require("../../../functions/serverTagLogger.js");

module.exports = async (client, guild) => {
    await createDataGuild(client, guild);
    await initializeGuildServerTag(client, guild).catch(() => {});
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
