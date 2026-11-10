const {
    isGuildManuallyDisconnected,
    isGuildLeavingInProgress,
    registerNodeReconnectTimer,
    clearNodeReconnectTimerRef,
    syncGuildDisconnectMemory,
} = require("../../../functions/voiceSessionManager.js");
const Logger = require("../../../utils/logger");

module.exports = async (client, node) => {
    Logger.info(`Node ${node.options.name} ready`);

    const guildDatas = (await client.guildData?.find?.().catch(() => [])) || [];

    const reconnects = guildDatas.filter((doc) => {
        const gId = String(doc?.id || "");
        if (!gId) return false;

        const liveData = client.data.get(`guildData_${gId}`) || doc;
        syncGuildDisconnectMemory(gId, liveData);

        if (isGuildManuallyDisconnected(client, gId) || isGuildLeavingInProgress(gId)) {
            return false;
        }

        return Boolean(liveData?.reconnect?.status && !liveData?.manualDisconnect);
    });

    Logger.info(`Auto reconnect found in ${reconnects.length} servers`);

    reconnects.forEach((doc, index) => {
        const gId = String(doc.id);

        const timer = setTimeout(async () => {
            clearNodeReconnectTimerRef(gId, timer);

            // Re-verify live state in case user ran /leave while timer was waiting
            if (isGuildManuallyDisconnected(client, gId) || isGuildLeavingInProgress(gId)) {
                return;
            }

            const liveGuildData = client.data.get(`guildData_${gId}`) || doc;
            if (!liveGuildData?.reconnect?.status || liveGuildData?.manualDisconnect) {
                return;
            }

            if (client.rainlink.players.has(gId)) {
                return;
            }

            const guild = client.guilds.cache.get(gId);
            const text = client.channels.cache.get(liveGuildData.reconnect.text);
            const voice = client.channels.cache.get(liveGuildData.reconnect.voice);

            if (!guild || !text || !voice) return;

            await client.rainlink
                .create({
                    guildId: guild.id,
                    voiceId: voice.id,
                    textId: text.id,
                    shardId: guild.shardId,
                    volume: client.config.defaultVolume,
                    deaf: true,
                })
                .catch((err) => {
                    Logger.debug(`[AutoReconnect] Gagal menyambungkan ulang player di server ${guild.id}: ${err?.message || err}`);
                });
        }, index * 5000);

        registerNodeReconnectTimer(gId, timer);
    });
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
