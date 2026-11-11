const { recordNodeEvent } = require("../../../functions/nodeHealthManager.js");
const Logger = require("../../../utils/logger");

module.exports = (client, node, error) => {
    recordNodeEvent(node, "error", error);
    Logger.music("error", "Lavalink node connection/protocol error", {
        guildId: "-",
        userId: "-",
        command: "nodeError",
        playerStatus: "-",
        nodeStatus: `${node?.options?.name || "Lavalink"}(state=${node?.state ?? "?"})`,
        errorMessage: error,
    });
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
