const Logger = require("../../../utils/logger");

module.exports = async (client, player) => {
    if (!player) return;

    const guild = await client.guilds.cache.get(player.guildId);

    Logger.debug(`Track ended from ${guild.name} (${guild.id})`);

    if (player.message) player.message.delete().catch((e) => {});
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
