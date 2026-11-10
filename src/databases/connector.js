const mongoose = require("mongoose");
const Logger = require("../utils/logger");

module.exports = async (client) => {
    try {
        mongoose.set("strictQuery", false);
        mongoose.connect(client.config.mongoUri);

        Logger.info("Database events loaded");
    } catch (error) {
        Logger.error("Failed to connect to database:", error);
    }
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
