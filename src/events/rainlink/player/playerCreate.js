const { openOrSyncVoiceSession666 } = require("../../../functions/profileNotificationManager.js");
const Logger = require("../../../utils/logger");

module.exports = async (client, player) => {
    if (!player) return;

    await openOrSyncVoiceSession666(client, player).catch(() => {});

    const guild = client.guilds.cache.get(player.guildId);
    if (!guild) return;

    const guildData = client.data.get(`guildData_${guild.id}`);

    if (guildData?.reconnect?.status) {
        Logger.debug(`Player reconnected to [${guild.name}] (${guild.id})`);
    } else {
        Logger.debug(`Player created in [${guild.name}] (${guild.id})`);
    }
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
