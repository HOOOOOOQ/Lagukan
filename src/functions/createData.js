const Logger = require("../utils/logger");

function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
}

function normalizeGuildData(client, guild, rawData = {}) {
    const envVoice = client?.config?.voiceLog || { enabled: true };
    const defaultTz = client?.config?.timezone || "Asia/Jakarta";
    const minVol = Number.isFinite(client?.config?.minVolume) ? client.config.minVolume : 1;
    const maxVol = Number.isFinite(client?.config?.maxVolume) ? client.config.maxVolume : 150;
    const configDefaultVol = clampNumber(client?.config?.defaultVolume, minVol, maxVol, 100);
    const configLeaveTimeout = clampNumber(process.env.AUTO_LEAVE_TIMEOUT || client?.config?.leaveTimeout, 5000, 3600000, 60000);

    const voiceSource = rawData.voiceLog?.source || "env";
    const manualDisconnect = Boolean(rawData.manualDisconnect);
    const rawMusic = rawData.music || {};
    const rawAutoLeave = rawMusic.autoLeave || {};

    const rawHistory = Array.isArray(rawData.history) ? rawData.history.slice(0, 50) : [];

    return {
        id: rawData.id || guild?.id,
        manualDisconnect,
        reconnect: {
            status: manualDisconnect ? false : Boolean(rawData.reconnect?.status),
            text: manualDisconnect ? null : rawData.reconnect?.text || null,
            voice: manualDisconnect ? null : rawData.reconnect?.voice || null,
        },
        voiceLog: {
            enabled: voiceSource === "command" ? Boolean(rawData.voiceLog?.enabled) : Boolean(envVoice.enabled),
            timezone: voiceSource === "command" ? rawData.voiceLog?.timezone || defaultTz : defaultTz,
            source: voiceSource,
        },
        music: {
            defaultVolume: clampNumber(rawMusic.defaultVolume, minVol, maxVol, configDefaultVol),
            autoplay: Boolean(rawMusic.autoplay),
            djMode: Boolean(rawMusic.djMode),
            djRoleId: typeof rawMusic.djRoleId === "string" && rawMusic.djRoleId.trim() ? rawMusic.djRoleId.trim() : null,
            autoLeave: {
                enabled: rawAutoLeave.enabled !== undefined ? Boolean(rawAutoLeave.enabled) : true,
                timeout: clampNumber(rawAutoLeave.timeout, 5000, 3600000, configLeaveTimeout),
            },
        },
        history: rawHistory,
    };
}

function normalizeUserData(userId, rawData = {}) {
    return {
        id: rawData.id || userId,
        ban: {
            status: Boolean(rawData.ban?.status),
            reason: rawData.ban?.reason || null,
        },
        favorites: Array.isArray(rawData.favorites) ? rawData.favorites.slice(0, 100) : [],
    };
}

module.exports = {
    normalizeGuildData,
    normalizeUserData,

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
                        manualDisconnect: defaults.manualDisconnect,
                        reconnect: defaults.reconnect,
                        voiceLog: defaults.voiceLog,
                        music: defaults.music,
                        history: defaults.history,
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
        if (!user?.id || user.bot || user.id === client.user?.id) return null;

        try {
            const existing = client.data.get(`userData_${user.id}`);
            if (existing) return existing;

            const defaults = normalizeUserData(user.id, { id: user.id });
            const userData = await client.userData.findOneAndUpdate(
                { id: user.id },
                {
                    $setOnInsert: {
                        id: user.id,
                        ban: defaults.ban,
                        favorites: defaults.favorites,
                    },
                },
                { upsert: true, returnDocument: "after" },
            );
            const { _id, __v, ...data } = userData.toObject();
            const normalized = normalizeUserData(user.id, data);

            if (!client.data.has(`userData_${user.id}`)) client.data.set(`userData_${user.id}`, normalized);
            return normalized;
        } catch (error) {
            Logger.error("Error creating user data:", error);
            const fallback = normalizeUserData(user.id, { id: user.id });
            if (!client.data.has(`userData_${user.id}`)) client.data.set(`userData_${user.id}`, fallback);
            return fallback;
        }
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
