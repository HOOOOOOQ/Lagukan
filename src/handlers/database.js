module.exports = async (client) => {
    require("../databases/connector.js")(client);
    require("../databases/updater.js")(client);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
