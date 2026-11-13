const { recordNodeEvent, fetchNodeCapabilities } = require("../../../functions/nodeHealthManager.js");
const { syncAllAuto247OnStartup } = require("../../../functions/auto247Manager.js");
const { tryAutoResumeGuildPlayback } = require("../../../functions/radioAndSleepManager.js");
const Logger = require("../../../utils/logger");

module.exports = async (client, node) => {
    try {
        const nodeName = node?.options?.name || "Lavalink";
        recordNodeEvent(node, "connect");
        Logger.info(`Node ${nodeName} ready`);

        fetchNodeCapabilities(node, true)
            .then((caps) => {
                if (caps) {
                    Logger.debug(
                        `[NodeConnect] ${nodeName} v${caps.version} sources=[${caps.sourceManagers.join(", ")}] plugins=[${caps.plugins.map((p) => p.name).join(", ")}]`,
                    );
                }
            })
            .catch(() => {});

        // Automatically connect this bot (`botApplicationId`) to all its configured 24/7 voice channels
        const connectedList = await syncAllAuto247OnStartup(client, node);
        for (const item of connectedList) {
            if (item?.connected && item?.player && !item.alreadyConnected) {
                await tryAutoResumeGuildPlayback(client, item.player).catch(() => {});
            }
        }
    } catch (error) {
        Logger.error("[NodeConnect] Gagal memproses event nodeConnect:", error);
    }
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
