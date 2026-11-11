const {
    isGuildManuallyDisconnected,
    isGuildLeavingInProgress,
    hasActiveGuildPlayer,
    prepareGuildForReconnect,
} = require("../../../functions/voiceSessionManager.js");
const { getGuildMusicSettings } = require("../../../functions/musicPermissions.js");
const { cleanupNowPlayingMessage } = require("../../../functions/nowPlayingManager.js");
const Logger = require("../../../utils/logger");

module.exports = async (client, player) => {
    try {
        if (!player) return;

        const guildId = String(player.guildId || "");
        if (!guildId) return;

        const guild = client.guilds.cache.get(guildId);

        if (guild) {
            Logger.debug(`Player destroyed from [${guild.name}] (${guild.id})`);
        }

        await cleanupNowPlayingMessage(player, true);

        // Never auto-reconnect if this guild was intentionally disconnected via /leave
        if (!guild || isGuildManuallyDisconnected(client, guildId) || isGuildLeavingInProgress(guildId)) {
            return;
        }

        const guildData = client.data.get(`guildData_${guild.id}`);

        if (guildData && !guildData.manualDisconnect && guildData.reconnect?.status) {
            if (!client?.rainlink?.players || typeof client.rainlink.players.get !== "function") {
                return;
            }

            if (hasActiveGuildPlayer(client, guild.id)) {
                return;
            }

            const voice = client.channels.cache.get(guildData.reconnect.voice);
            const text = client.channels.cache.get(guildData.reconnect.text);

            if (!voice || !text) {
                guildData.reconnect = { status: false, text: null, voice: null };
                client.data.set(`guildData_${guild.id}`, guildData);

                await client.guildData
                    ?.findOneAndUpdate(
                        { id: guild.id },
                        { $set: { reconnect: guildData.reconnect } },
                        { upsert: true, returnDocument: "after" },
                    )
                    .catch(() => {});

                return;
            }

            const shouldCreate = await prepareGuildForReconnect(client, guild.id);
            if (!shouldCreate || isGuildManuallyDisconnected(client, guildId) || isGuildLeavingInProgress(guildId)) {
                return;
            }

            const musicSettings = getGuildMusicSettings(client, guild);

            return await client.rainlink
                .create({
                    guildId: guild.id,
                    voiceId: voice.id,
                    textId: text.id,
                    shardId: guild.shardId,
                    volume: musicSettings.defaultVolume || client.config.defaultVolume,
                    deaf: true,
                })
                .catch((err) => {
                    Logger.debug(`[PlayerDestroy] Gagal auto-reconnect player di server ${guild.id}: ${err?.message || err}`);
                    return null;
                });
        }
    } catch (error) {
        Logger.error("[PlayerDestroy] Gagal memproses event playerDestroy:", error);
    }
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
