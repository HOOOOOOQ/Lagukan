const { ActivityType } = require("discord.js");
const emojiConfig = require("../../../settings/emoji.js");
const { normalizeGuildData, normalizeUserData } = require("../../../functions/createData.js");
const { syncGuildDisconnectMemory } = require("../../../functions/voiceSessionManager.js");
const { initializeServerTagLogger } = require("../../../functions/serverTagLogger.js");
const { initializeServerTagAutoRole } = require("../../../functions/serverTagAutoRole.js");
const { initializeCustomRolePanels } = require("../../../functions/customRoleSystem.js");
const Logger = require("../../../utils/logger");

module.exports = async (client) => {
    await emojiConfig(client);

    const botName = client.config.botName || "Lagukan";

    if (client.user.username !== botName) {
        await client.user.setUsername(botName).catch((err) => {
            Logger.debug(`Skipped updating Discord bot username to ${botName}: ${err.message}`);
        });
    }

    const guildData = await client.guildData.find();

    for (const x of guildData) {
        const { _id, __v, ...raw } = x.toObject();
        const guild = client.guilds.cache.get(x.id);
        const normalized = normalizeGuildData(client, guild, raw);

        client.data.set(`guildData_${x.id}`, normalized);
        syncGuildDisconnectMemory(x.id, normalized);

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

    const userData = await client.userData.find();

    userData.forEach(async (x) => {
        const { _id, __v, ...data } = x.toObject();

        client.data.set(`userData_${x.id}`, normalizeUserData(x.id, data));
    });

    initializeServerTagLogger(client).catch((err) => {
        Logger.debug(`Server Tag Logger initial baseline skipped: ${err.message}`);
    });

    initializeServerTagAutoRole(client).catch((err) => {
        Logger.debug(`Server Tag Auto Role initial baseline skipped: ${err.message}`);
    });

    initializeCustomRolePanels(client).catch((err) => {
        Logger.debug(`Custom Role Panel initial sync skipped: ${err.message}`);
    });

    setInterval(async () => {
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

            client.user.setPresence(presenceOptions);
        } catch (err) {
            Logger.debug(`Presence update skipped: ${err?.message || err}`);
        }
    }, 15000);

    Logger.info(`${botName} Music Bot (${client.user.username}) is ready with ${await client.guilds.cache.size} server`);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
