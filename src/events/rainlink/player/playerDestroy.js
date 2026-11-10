const { isGuildManuallyDisconnected, isGuildLeavingInProgress } = require("../../../functions/voiceSessionManager.js");
const Logger = require("../../../utils/logger");

module.exports = async (client, player) => {
    if (!player) return;

    const guildId = String(player.guildId || "");
    const guild = client.guilds.cache.get(guildId);

    if (guild) {
        Logger.debug(`Player destroyed from [${guild.name}] (${guild.id})`);
    }

    if (player.message) {
        player.message.delete().catch(() => {});
        player.message = null;
    }

    // Never auto-reconnect if this guild was intentionally disconnected via /leave
    if (!guild || isGuildManuallyDisconnected(client, guildId) || isGuildLeavingInProgress(guildId)) {
        return;
    }

    const guildData = client.data.get(`guildData_${guild.id}`);

    if (guildData && !guildData.manualDisconnect && guildData.reconnect?.status) {
        if (client.rainlink.players.has(guild.id)) return;

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

        if (isGuildManuallyDisconnected(client, guildId) || isGuildLeavingInProgress(guildId)) {
            return;
        }

        return await client.rainlink.create({
            guildId: guild.id,
            voiceId: voice.id,
            textId: text.id,
            shardId: guild.shardId,
            volume: client.config.defaultVolume,
            deaf: true,
        });
    }
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
