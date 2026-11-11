const mongoose = require("mongoose");
const Logger = require("../utils/logger");
const { isCloudDatabaseMode, connectCloudDatabase } = require("./cloudAdapter");

module.exports = async (client) => {
    try {
        if (isCloudDatabaseMode(client)) {
            await connectCloudDatabase(client);
            Logger.info("Database events loaded (Lagukan Cloud Gateway mode)");
            return;
        }

        mongoose.set("strictQuery", false);
        await mongoose.connect(client.config.mongoUri);

        Logger.info("Database events loaded");
    } catch (error) {
        Logger.error("Failed to connect to database:", error?.message || error);
    }
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
