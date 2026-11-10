const { EmbedBuilder } = require("discord.js");
const {
    PLAYER_STATE_DESTROYED,
    isGuildManuallyDisconnected,
    isGuildLeavingInProgress,
} = require("../../../functions/voiceSessionManager.js");

module.exports = async (client, player) => {
    if (
        !player ||
        player.state === PLAYER_STATE_DESTROYED ||
        player.sudoDestroy ||
        isGuildManuallyDisconnected(client, player.guildId) ||
        isGuildLeavingInProgress(player.guildId)
    ) {
        return;
    }

    if (player.message) {
        player.message.delete().catch(() => {});
        player.message = null;
    }

    const channel = client.channels.cache.get(player.textId);
    const isAutoplayEnabled = client.data.get("autoplay", player.guildId);

    if (isAutoplayEnabled) {
        const track = player.queue.previous[0];
        if (!track) {
            client.data.delete("autoplay", player.guildId);
            if (player.state !== PLAYER_STATE_DESTROYED && !player.sudoDestroy) {
                await Promise.resolve(player.destroy()).catch(() => {});
            }
            return;
        }

        const getTrack = `https://music.youtube.com/watch?v=${track.identifier}&list=RD${track.identifier}`;
        const result = await client.rainlink.search(getTrack, { requester: track.requester }).catch(() => null);

        if (
            isGuildManuallyDisconnected(client, player.guildId) ||
            isGuildLeavingInProgress(player.guildId) ||
            player.state === PLAYER_STATE_DESTROYED ||
            player.sudoDestroy
        ) {
            return;
        }

        if (!result || !result.tracks || !result.tracks.length) {
            client.data.delete("autoplay", player.guildId);

            if (player.state !== PLAYER_STATE_DESTROYED && !player.sudoDestroy) {
                await Promise.resolve(player.destroy()).catch(() => {});
            }
            return;
        }

        const randomTrack = result.tracks[Math.floor(Math.random() * result.tracks.length)];

        player.queue.add(randomTrack);

        if (!player.playing && player.state !== PLAYER_STATE_DESTROYED && !player.sudoDestroy) {
            await Promise.resolve(player.play()).catch(() => {});
        }
    } else {
        const guildData = client.data.get(`guildData_${player.guildId}`);

        if (guildData && !guildData.manualDisconnect && guildData.reconnect?.status) return;

        const embed = new EmbedBuilder()
            .setColor(client.config.embedColor)
            .setDescription(`The queue is empty. You can disable this by using \`247\` command.`);

        if (channel) await channel.send({ embeds: [embed] }).catch(() => {});

        if (player.state !== PLAYER_STATE_DESTROYED && !player.sudoDestroy) {
            await Promise.resolve(player.destroy()).catch(() => {});
        }
    }
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
