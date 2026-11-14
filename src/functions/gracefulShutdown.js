const mongoose = require("mongoose");
const Logger = require("../utils/logger");

function installGracefulShutdown(client) {
    let stopping = false;
    const shutdown = async (signal) => {
        if (stopping) return;
        stopping = true;
        Logger.info(`[Shutdown] ${signal}: closing bot connections`);
        clearInterval(client._nodeHealthTimer);
        clearInterval(client._presenceInterval);
        for (const timer of client._auto247Timers?.values?.() || []) clearTimeout(timer);
        for (const node of client.rainlink?.nodes?.all?.() || []) {
            clearTimeout(node._lagukanReconnectTimer);
            try {
                node.disconnect();
            } catch (error) {
                Logger.warn(`[Shutdown] Node close failed: ${error.message}`);
            }
        }
        try {
            await client.destroy();
        } catch (error) {
            Logger.warn(`[Shutdown] Discord close failed: ${error.message}`);
        }
        try {
            await mongoose.disconnect();
        } catch (error) {
            Logger.warn(`[Shutdown] Database close failed: ${error.message}`);
        }
    };
    process.once("SIGTERM", () => {
        void shutdown("SIGTERM");
    });
    process.once("SIGINT", () => {
        void shutdown("SIGINT");
    });
}
module.exports = { installGracefulShutdown };
