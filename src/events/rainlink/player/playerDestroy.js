const { isGuildManuallyDisconnected, isGuildLeavingInProgress } = require("../../../functions/voiceSessionManager.js");
const { cleanupNowPlayingMessage } = require("../../../functions/nowPlayingManager.js");
const { onTrackSessionEnd } = require("../../../functions/musicStatsEngine.js");
const { onProfile666TrackEnd } = require("../../../functions/profile666Engine.js");
const { closeVoiceSession666 } = require("../../../functions/profileNotificationManager.js");
const { scheduleAuto247Reconnect } = require("../../../functions/auto247Manager.js");
const { cancelGuildSleepTimer, stopGuildRadioMode, clearAutoResumeSnapshot } = require("../../../functions/radioAndSleepManager.js");
const Logger = require("../../../utils/logger");

module.exports = async (client, player) => {
    try {
        if (!player) return;

        const guildId = String(player.guildId || "");
        if (!guildId) return;

        const guild = client.guilds.cache.get(guildId);

        if (guild) {
            Logger.debug(`Player destroyed from [${guild.name}] (${guild.id})`);
        }

        await Promise.all([
            onTrackSessionEnd(client, player, "stopped").catch(() => {}),
            onProfile666TrackEnd(client, player, "stopped").catch(() => {}),
        ]);

        await cleanupNowPlayingMessage(player, true);
        await closeVoiceSession666(client, guildId, "player_destroyed");

        // Never auto-reconnect if this bot was intentionally disconnected via /leave
        if (!guild || isGuildManuallyDisconnected(client, guildId) || isGuildLeavingInProgress(guildId, client)) {
            cancelGuildSleepTimer(guildId);
            stopGuildRadioMode(guildId);
            clearAutoResumeSnapshot(guildId);
            return;
        }

        // Per-bot Auto 24/7 staged backoff reconnect
        await scheduleAuto247Reconnect(client, guildId, "player_destroyed");
    } catch (error) {
        Logger.error("[PlayerDestroy] Gagal memproses event playerDestroy:", error);
    }
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
