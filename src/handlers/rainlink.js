const { readdirSync } = require("node:fs");
const path = require("node:path");
const Logger = require("../utils/logger");

module.exports = (client) => {
    if (client._rainlinkEventsLoaded) return;
    client._rainlinkEventsLoaded = true;

    try {
        const rainlinkEventsRoot = path.join(__dirname, "../events/rainlink");

        readdirSync(rainlinkEventsRoot)
            .sort()
            .forEach((dir) => {
                const dirPath = path.join(rainlinkEventsRoot, dir);
                const bots = readdirSync(dirPath)
                    .filter((file) => file.endsWith(".js"))
                    .sort();

                for (const file of bots) {
                    const event = require(path.join(dirPath, file));
                    const eventName = file.split(".")[0];

                    client.rainlink.on(eventName, (...args) =>
                        Promise.resolve()
                            .then(() => event(client, ...args))
                            .catch((err) => {
                                Logger.error(`[Rainlink:${eventName}] Unhandled event error:`, err);
                            }),
                    );
                }
            });

        Logger.info("Rainlink events loaded");
    } catch (error) {
        Logger.error("Failed to load Rainlink events:", error);
    }
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
