const LagukanClient = require("./lagukan.js");
const client = new LagukanClient();
require("../functions/gracefulShutdown.js").installGracefulShutdown(client);

client.connect();

module.exports = client;

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
