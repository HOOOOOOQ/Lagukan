module.exports = async (client) => {
    if (client._databaseLoaded) return;
    client._databaseLoaded = true;

    require("../databases/connector.js")(client);
    require("../databases/updater.js")(client);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
