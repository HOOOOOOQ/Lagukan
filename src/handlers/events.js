const { readdirSync } = require("node:fs");
const path = require("node:path");
const Logger = require("../utils/logger");

module.exports = (client) => {
    if (client._botEventsLoaded) return;
    client._botEventsLoaded = true;

    try {
        const eventsRoot = path.join(__dirname, "../events/bot");

        readdirSync(eventsRoot)
            .sort()
            .forEach((dir) => {
                const dirPath = path.join(eventsRoot, dir);
                const bots = readdirSync(dirPath)
                    .filter((file) => file.endsWith(".js"))
                    .sort();

                for (const file of bots) {
                    const event = require(path.join(dirPath, file));
                    const eventName = file.split(".")[0];

                    client.on(eventName, (...args) =>
                        Promise.resolve(event(client, ...args)).catch((err) => {
                            Logger.error(`Unhandled error in bot event '${eventName}':`, err);
                        }),
                    );
                }
            });

        Logger.info("Bot events loaded");
    } catch (error) {
        Logger.error("Failed to load bot events:", error);
    }
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
