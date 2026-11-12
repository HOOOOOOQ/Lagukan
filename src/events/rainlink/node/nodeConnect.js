const mongoose = require("mongoose");
const {
    isGuildManuallyDisconnected,
    isGuildLeavingInProgress,
    hasActiveGuildPlayer,
    prepareGuildForReconnect,
    registerNodeReconnectTimer,
    clearNodeReconnectTimerRef,
    syncGuildDisconnectMemory,
} = require("../../../functions/voiceSessionManager.js");
const { recordNodeEvent, fetchNodeCapabilities, waitForNodeSessionReady } = require("../../../functions/nodeHealthManager.js");
const { getGuildMusicSettings } = require("../../../functions/musicPermissions.js");
const { tryAutoResumeGuildPlayback } = require("../../../functions/radioAndSleepManager.js");
const { isCloudDatabaseReady } = require("../../../databases/cloudAdapter.js");
const Logger = require("../../../utils/logger");

module.exports = async (client, node) => {
    try {
        const nodeName = node?.options?.name || "Lavalink";
        recordNodeEvent(node, "connect");
        Logger.info(`Node ${nodeName} ready`);

        // Probe node /v4/info in background to cache supported sources, plugins, and filters
        fetchNodeCapabilities(node, true)
            .then((caps) => {
                if (caps) {
                    Logger.debug(
                        `[NodeConnect] ${nodeName} v${caps.version} sources=[${caps.sourceManagers.join(", ")}] plugins=[${caps.plugins.map((p) => p.name).join(", ")}]`,
                    );
                }
            })
            .catch(() => {});

        const dbReady = mongoose.connection.readyState === 1 || isCloudDatabaseReady();
        const guildDatas = dbReady ? (await client.guildData?.find?.().catch(() => [])) || [] : [];

        const reconnects = guildDatas.filter((doc) => {
            const gId = String(doc?.id || "");
            if (!gId) return false;

            const liveData = client.data.get(`guildData_${gId}`) || doc;
            syncGuildDisconnectMemory(gId, liveData);

            if (isGuildManuallyDisconnected(client, gId) || isGuildLeavingInProgress(gId)) {
                return false;
            }

            if (liveData?.reconnect?.botId && client.user?.id && String(liveData.reconnect.botId) !== String(client.user.id)) {
                return false;
            }

            return Boolean(liveData?.reconnect?.status && !liveData?.manualDisconnect);
        });

        Logger.info(`Auto reconnect found in ${reconnects.length} servers`);

        reconnects.forEach((doc, index) => {
            const gId = String(doc.id);

            const timer = setTimeout(() => {
                void (async () => {
                    try {
                        clearNodeReconnectTimerRef(gId, timer);

                        // Re-verify live state in case user ran /leave while timer was waiting
                        if (isGuildManuallyDisconnected(client, gId) || isGuildLeavingInProgress(gId)) {
                            return;
                        }

                        const liveGuildData = client.data.get(`guildData_${gId}`) || doc;
                        if (!liveGuildData?.reconnect?.status || liveGuildData?.manualDisconnect) {
                            return;
                        }

                        if (!client?.rainlink?.players || typeof client.rainlink.players.get !== "function") {
                            return;
                        }

                        if (hasActiveGuildPlayer(client, gId)) {
                            return;
                        }

                        const shouldCreate = await prepareGuildForReconnect(client, gId);
                        if (!shouldCreate) {
                            return;
                        }

                        const guild = client.guilds.cache.get(gId);
                        const text = client.channels.cache.get(liveGuildData.reconnect.text);
                        const voice = client.channels.cache.get(liveGuildData.reconnect.voice);

                        if (!guild || !text || !voice) return;

                        if (isGuildManuallyDisconnected(client, gId) || isGuildLeavingInProgress(gId)) {
                            return;
                        }

                        const sessionReady = await waitForNodeSessionReady(node, 4000);
                        if (!sessionReady) return;

                        const musicSettings = getGuildMusicSettings(client, guild);

                        const reconnectedPlayer = await client.rainlink.create({
                            guildId: guild.id,
                            voiceId: voice.id,
                            textId: text.id,
                            shardId: guild.shardId ?? client?.ws?.shards?.first?.()?.id ?? 0,
                            volume: musicSettings.defaultVolume || client.config.defaultVolume,
                            deaf: true,
                        });

                        if (reconnectedPlayer) {
                            await tryAutoResumeGuildPlayback(client, reconnectedPlayer).catch(() => {});
                        }
                    } catch (err) {
                        Logger.debug(`[AutoReconnect] Gagal menyambungkan ulang player di server ${gId}: ${err?.message || err}`);
                    }
                })().catch((err) => {
                    Logger.debug(`[AutoReconnect] Penanganan error reconnect pada server ${gId}: ${err?.message || err}`);
                });
            }, index * 5000);

            if (typeof timer.unref === "function") timer.unref();
            registerNodeReconnectTimer(gId, timer);
        });
    } catch (error) {
        Logger.error("[NodeConnect] Gagal memproses event nodeConnect:", error);
    }
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
