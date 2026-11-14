const { ActivityType } = require("discord.js");
const mongoose = require("mongoose");
const emojiConfig = require("../../../settings/emoji.js");
const { normalizeGuildData, normalizeUserData } = require("../../../functions/createData.js");
const { syncGuildDisconnectMemory } = require("../../../functions/voiceSessionManager.js");
const { syncAllAuto247OnStartup } = require("../../../functions/auto247Manager.js");
const { isCloudDatabaseReady } = require("../../../databases/cloudAdapter.js");
const Logger = require("../../../utils/logger");

module.exports = async (client) => {
    await emojiConfig(client);

    const botName = client.user?.username || client.config.botName || "Lagukan";
    const dbReady = mongoose.connection.readyState === 1 || isCloudDatabaseReady();

    if (dbReady) {
        const guildData = (await client.guildData.find().catch(() => [])) || [];

        for (const x of guildData) {
            const plain = typeof x.toObject === "function" ? x.toObject() : x;
            const { _id, __v, ...raw } = plain;
            const guild = client.guilds.cache.get(x.id);
            const normalized = normalizeGuildData(client, guild, raw);

            client.data.set(`guildData_${x.id}`, normalized);
            syncGuildDisconnectMemory(x.id, normalized, client);

            if (guild) {
                await client.guildData
                    .findOneAndUpdate({ id: x.id }, { $set: normalized }, { upsert: true, returnDocument: "after" })
                    .catch(() => {});
            }
        }

        for (const [, guild] of client.guilds.cache) {
            if (!client.data.has(`guildData_${guild.id}`)) {
                const normalized = normalizeGuildData(client, guild, { id: guild.id });
                client.data.set(`guildData_${guild.id}`, normalized);

                await client.guildData
                    .findOneAndUpdate({ id: guild.id }, { $set: normalized }, { upsert: true, returnDocument: "after" })
                    .catch(() => {});
            }
        }

        const userData = (await client.userData.find().catch(() => [])) || [];
        for (const x of userData) {
            const plain = typeof x.toObject === "function" ? x.toObject() : x;
            const { _id, __v, ...data } = plain;
            client.data.set(`userData_${x.id}`, normalizeUserData(x.id, data));
        }
    } else {
        for (const [, guild] of client.guilds.cache) {
            if (!client.data.has(`guildData_${guild.id}`)) {
                client.data.set(`guildData_${guild.id}`, normalizeGuildData(client, guild, { id: guild.id }));
            }
        }
    }

    // Automatically connect this bot to its configured 24/7 voice channels on startup
    await syncAllAuto247OnStartup(client).catch((err) => {
        Logger.debug(`[Auto247] Startup sync menunggu kesiapan Lavalink: ${err?.message || err}`);
    });

    if (client._presenceInterval) {
        clearInterval(client._presenceInterval);
    }

    client._presenceInterval = setInterval(async () => {
        try {
            let servers = 0;
            let members = 0;

            if (client.cluster && typeof client.cluster.broadcastEval === "function") {
                const results = await Promise.all([
                    client.cluster.broadcastEval("this.guilds.cache.size"),
                    client.cluster.broadcastEval((c) => c.guilds.cache.reduce((acc, guild) => acc + (guild.memberCount || 0), 0)),
                ]);
                servers = results[0].reduce((acc, guildCount) => acc + guildCount, 0);
                members = results[1].reduce((acc, memberCount) => acc + memberCount, 0);
            } else {
                servers = client.guilds.cache.size;
                members = client.guilds.cache.reduce((acc, guild) => acc + (guild.memberCount || 0), 0);
            }

            const status = [
                { type: ActivityType.Playing, name: `/play | ${botName}` },
                { type: ActivityType.Listening, name: `${members} Users` },
                { type: ActivityType.Competing, name: `${servers} Servers` },
            ];

            const index = Math.floor(Math.random() * status.length);
            const presenceOptions = { activities: [{ type: status[index].type, name: status[index].name }], status: "online" };

            client.user?.setPresence?.(presenceOptions);
        } catch (err) {
            Logger.debug(`Presence update skipped: ${err?.message || err}`);
        }
    }, 15000);

    if (typeof client._presenceInterval.unref === "function") {
        client._presenceInterval.unref();
    }

    Logger.info(`${botName} Music Bot (${client.user?.username || "Bot"}) is ready with ${client.guilds.cache.size} server`);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
