const { ClusterManager } = require("discord-hybrid-sharding");
const Logger = require("./utils/logger");
require("dotenv").config({ path: "./.env", quiet: true });
const { token } = require("./settings/config.js");

const resolvedToken = process.env.TOKEN || token;
const isStandaloneMode =
    String(process.env.STANDALONE_MODE || "")
        .trim()
        .toLowerCase() === "true";

if (!resolvedToken || resolvedToken === "YOUR_BOT_TOKEN") {
    Logger.error("Discord bot TOKEN belum diatur! Silakan isi TOKEN pada file .env terlebih dahulu.");
    process.exit(1);
}

if (isStandaloneMode) {
    Logger.info("Starting Lagukan in Standalone Single-Process Mode (Termux / Lightweight Mode)...");
    require("./clients/manager.js");
} else {
    const manager = new ClusterManager(`${__dirname}/clients/manager.js`, {
        totalShards: "auto",
        shardsPerClusters: 2,
        totalClusters: "auto",
        mode: "process",
        token: resolvedToken,
    });

    manager.on("clusterCreate", (cluster) => Logger.info(`Launched Lagukan cluster ${cluster.id}`));
    manager.spawn({ timeout: -1 });
}

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
