const { recordNodeEvent } = require("../../../functions/nodeHealthManager.js");
const Logger = require("../../../utils/logger");

module.exports = (client, node, code, reason) => {
    const desc = `${code || ""} ${reason || ""}`.trim();
    recordNodeEvent(node, "disconnect", desc);
    Logger.music("warn", "Lavalink node disconnected", {
        guildId: "-",
        userId: "-",
        command: "nodeDisconnect",
        playerStatus: "-",
        nodeStatus: `${node?.options?.name || "Lavalink"}(code=${code ?? "unknown"})`,
        errorMessage: desc || "WebSocket disconnected",
    });
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
