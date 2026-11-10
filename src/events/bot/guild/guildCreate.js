const { createDataGuild } = require("../../../functions/createData.js");

module.exports = async (client, guild) => {
    await createDataGuild(client, guild);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
