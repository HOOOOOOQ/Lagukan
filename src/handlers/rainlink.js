const { readdirSync } = require("fs");
const Logger = require("../utils/logger");

module.exports = (client) => {
    try {
        readdirSync("./src/events/rainlink/").forEach((dir) => {
            const bots = readdirSync(`./src/events/rainlink/${dir}`).filter((file) => file.endsWith(".js"));

            for (const file of bots) {
                const event = require(`../events/rainlink/${dir}/${file}`);
                const eventName = file.split(".")[0];

                client.rainlink.on(eventName, (...args) => {
                    Promise.resolve()
                        .then(() => event(client, ...args))
                        .catch((err) => {
                            Logger.error(`[Rainlink:${eventName}] Unhandled event error:`, err);
                        });
                });
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
