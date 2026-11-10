const Logger = require("../utils/logger");

function normalizeGuildData(client, guild, rawData = {}) {
    const envVoice = client.config?.voiceLog || { enabled: true };
    const defaultTz = client.config?.timezone || "Asia/Jakarta";
    const voiceSource = rawData.voiceLog?.source || "env";
    const rawTagLog = rawData.serverTagLog || {};
    const rawTagStats = rawTagLog.stats || {};

    return {
        id: rawData.id || guild?.id,
        reconnect: {
            status: Boolean(rawData.reconnect?.status),
            text: rawData.reconnect?.text || null,
            voice: rawData.reconnect?.voice || null,
        },
        voiceLog: {
            enabled: voiceSource === "command" ? Boolean(rawData.voiceLog?.enabled) : Boolean(envVoice.enabled),
            timezone: voiceSource === "command" ? rawData.voiceLog?.timezone || defaultTz : defaultTz,
            source: voiceSource,
        },
        serverTagLog: {
            enabled: Boolean(rawTagLog.enabled && rawTagLog.channelId),
            channelId: rawTagLog.channelId || null,
            updatedBy: rawTagLog.updatedBy || null,
            updatedAt: rawTagLog.updatedAt || null,
            stats: {
                totalInstalled: Math.max(0, Number(rawTagStats.totalInstalled) || 0),
                totalChanged: Math.max(0, Number(rawTagStats.totalChanged) || 0),
                totalRemoved: Math.max(0, Number(rawTagStats.totalRemoved) || 0),
                totalReinstalled: Math.max(0, Number(rawTagStats.totalReinstalled) || 0),
            },
            recentHistory: Array.isArray(rawTagLog.recentHistory) ? rawTagLog.recentHistory.slice(0, 25) : [],
        },
    };
}

module.exports = {
    normalizeGuildData,

    createDataGuild: async (client, guild) => {
        if (!guild?.id) return null;

        try {
            const existingCached = client.data.get(`guildData_${guild.id}`);
            if (existingCached) return existingCached;

            const defaults = normalizeGuildData(client, guild, { id: guild.id });
            const guildDoc = await client.guildData.findOneAndUpdate(
                { id: guild.id },
                {
                    $setOnInsert: {
                        id: guild.id,
                        reconnect: defaults.reconnect,
                        voiceLog: defaults.voiceLog,
                        serverTagLog: defaults.serverTagLog,
                    },
                },
                { upsert: true, returnDocument: "after" },
            );

            const { _id, __v, ...raw } = guildDoc.toObject();
            const normalized = normalizeGuildData(client, guild, raw);

            client.data.set(`guildData_${guild.id}`, normalized);

            return normalized;
        } catch (error) {
            Logger.error("Error creating guild data:", error);

            const fallback = normalizeGuildData(client, guild, { id: guild.id });
            if (!client.data.has(`guildData_${guild.id}`)) client.data.set(`guildData_${guild.id}`, fallback);

            return fallback;
        }
    },

    createDataUser: async (client, user) => {
        if (!user?.id || user.bot || user.id === client.user?.id) return;

        try {
            if (client.data.has(`userData_${user.id}`)) return;

            const userData = await client.userData.findOneAndUpdate(
                { id: user.id },
                { $setOnInsert: { id: user.id } },
                { upsert: true, returnDocument: "after" },
            );
            const { _id, __v, ...data } = userData.toObject();

            if (!client.data.has(`userData_${user.id}`)) client.data.set(`userData_${user.id}`, data);
        } catch (error) {
            Logger.error("Error creating user data:", error);
        }
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
