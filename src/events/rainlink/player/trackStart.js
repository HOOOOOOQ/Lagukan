const { PLAYER_STATE_DESTROYED } = require("../../../functions/voiceSessionManager.js");
const { resetPlaybackFailure } = require("../../../functions/nodeHealthManager.js");
const { recordGuildTrackHistory } = require("../../../functions/musicPermissions.js");
const { sendOrReplaceNowPlayingDashboard } = require("../../../functions/nowPlayingManager.js");

module.exports = async (client, player, track) => {
    if (!player || player.state === PLAYER_STATE_DESTROYED || player.sudoDestroy || !track) return;

    resetPlaybackFailure(player.guildId);
    recordGuildTrackHistory(client, player.guildId, track).catch(() => {});

    await sendOrReplaceNowPlayingDashboard(client, player, track);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
