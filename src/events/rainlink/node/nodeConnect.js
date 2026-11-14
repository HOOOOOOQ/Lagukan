const { recordNodeEvent, fetchNodeCapabilities } = require("../../../functions/nodeHealthManager.js");
const { syncAllAuto247OnStartup } = require("../../../functions/auto247Manager.js");
const { tryAutoResumeGuildPlayback } = require("../../../functions/radioAndSleepManager.js");
const { recoverNodePlayers, invalidateSession } = require("../../../functions/sessionRecoveryManager.js");
const { waitForNodeSessionReady } = require("../../../functions/nodeHealthManager.js");
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

        // nodeConnect is the WebSocket open event, not the Lavalink ready handshake.
        if (!(await waitForNodeSessionReady(node, 10000))) {
            Logger.warn(`[NodeConnect] Lavalink ready handshake timed out on ${nodeName}.`);
            invalidateSession(node);
            try {
                node.driver?.wsClient?.close?.(4000, "Ready handshake timeout");
            } catch (err) {
                Logger.warn(`[NodeConnect] Could not close stalled socket: ${err.message}`);
            }
            return;
        }
        await recoverNodePlayers(client, node);

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
