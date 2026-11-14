const mongoose = require("mongoose");
const Logger = require("../utils/logger");
const { isCloudDatabaseMode, connectCloudDatabase } = require("./cloudAdapter");

module.exports = async (client) => {
    try {
        if (isCloudDatabaseMode(client)) {
            await connectCloudDatabase(client);
            Logger.info("Database events loaded (Lagukan Cloud Gateway mode)");
            if (client.isReady?.()) await require("../functions/auto247Manager.js").syncAllAuto247OnStartup(client);
            return;
        }

        if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) {
            Logger.info("Database connection reused");
            return;
        }

        const mongoUri = String(client.config?.mongoUri || "").trim();
        if (!mongoUri) {
            Logger.warn("MONGO_URI belum dikonfigurasi; bot berjalan menggunakan penyimpanan sesi memori sementara.");
            return;
        }

        mongoose.set("strictQuery", false);
        await mongoose.connect(mongoUri);

        Logger.info("Database events loaded");
        if (client.isReady?.()) await require("../functions/auto247Manager.js").syncAllAuto247OnStartup(client);
    } catch (error) {
        Logger.error("Failed to connect to database:", error?.message || error);
    }
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
