const { cleanupNowPlayingMessage } = require("../../../functions/nowPlayingManager.js");
const { onTrackSessionEnd } = require("../../../functions/musicStatsEngine.js");
const { refreshRequestPanelMessage } = require("../../../functions/voiceRequestSystem.js");
const Logger = require("../../../utils/logger");

module.exports = async (client, player) => {
    if (!player) return;

    const guild = client.guilds?.cache?.get?.(player.guildId);
    Logger.debug(`Track ended from ${guild?.name || "Unknown"} (${player.guildId})`);

    if (!player.data?.get?.("guessTheSongActive")) {
        await onTrackSessionEnd(client, player, "finished").catch(() => {});
        refreshRequestPanelMessage(client, player.guildId).catch(() => {});
    }

    await cleanupNowPlayingMessage(player, true);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
