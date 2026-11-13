const { cleanupNowPlayingMessage } = require("../../../functions/nowPlayingManager.js");
const { onTrackSessionEnd } = require("../../../functions/musicStatsEngine.js");
const { onProfile666TrackEnd } = require("../../../functions/profile666Engine.js");
const { refreshRequestPanelMessage } = require("../../../functions/voiceRequestSystem.js");
const Logger = require("../../../utils/logger");

module.exports = async (client, player) => {
    if (!player) return;

    const guild = client.guilds?.cache?.get?.(player.guildId);
    Logger.debug(`Track ended from ${guild?.name || "Unknown"} (${player.guildId})`);

    if (!player.data?.get?.("guessTheSongActive")) {
        await Promise.all([
            onTrackSessionEnd(client, player, "finished").catch(() => {}),
            onProfile666TrackEnd(client, player, "finished").catch(() => {}),
        ]);
        refreshRequestPanelMessage(client, player.guildId).catch(() => {});
    }

    // Stop collector only; preserve `player.message` so `trackStart` edits the existing Now Playing message!
    await cleanupNowPlayingMessage(player, false);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
