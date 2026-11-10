const { EmbedBuilder } = require("discord.js");
const { isGuildManuallyDisconnected, isGuildLeavingInProgress } = require("../../../functions/voiceSessionManager.js");

module.exports = async (client, player) => {
    if (
        !player ||
        player.state === 2 ||
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
            return player.destroy();
        }

        const getTrack = `https://music.youtube.com/watch?v=${track.identifier}&list=RD${track.identifier}`;
        const result = await client.rainlink.search(getTrack, { requester: track.requester });

        if (isGuildManuallyDisconnected(client, player.guildId) || isGuildLeavingInProgress(player.guildId) || player.state === 2) {
            return;
        }

        if (!result || !result.tracks || !result.tracks.length) {
            client.data.delete("autoplay", player.guildId);

            return player.destroy();
        }

        const randomTrack = result.tracks[Math.floor(Math.random() * result.tracks.length)];

        player.queue.add(randomTrack);

        if (!player.playing) player.play();
    } else {
        const guildData = client.data.get(`guildData_${player.guildId}`);

        if (guildData && !guildData.manualDisconnect && guildData.reconnect?.status) return;

        const embed = new EmbedBuilder()
            .setColor(client.config.embedColor)
            .setDescription(`The queue is empty. You can disable this by using \`247\` command.`);

        if (channel) await channel.send({ embeds: [embed] }).catch(() => {});

        return player.destroy();
    }
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
