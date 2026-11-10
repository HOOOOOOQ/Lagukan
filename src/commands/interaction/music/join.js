const { EmbedBuilder, MessageFlags } = require("discord.js");
const { cleanupStalePlayerIfDisconnected, clearManualDisconnect } = require("../../../functions/voiceSessionManager.js");
const { safeDeferReply, safeEditReply, safeReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "join",
    description: "Make Lagukan join your voice channel",
    category: "music",
    permissions: {
        bot: [],
        user: [],
    },
    settings: {
        voice: true,
        player: false,
        current: false,
    },
    devOnly: false,
    run: async (client, interaction, player) => {
        const embed = new EmbedBuilder().setColor(client.config.embedColor);

        player = (await cleanupStalePlayerIfDisconnected(client, interaction.guild)) || null;

        if (player) {
            embed.setDescription(`Already joined a voice channel.`);

            return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        await clearManualDisconnect(client, interaction.guildId, interaction.guild);

        player = await client.rainlink.create({
            guildId: interaction.guildId,
            textId: interaction.channelId,
            voiceId: interaction.member.voice.channelId,
            shardId: interaction.guild.shardId,
            volume: client.config.defaultVolume,
            deaf: true,
        });

        embed.setDescription(`Joined ${interaction.member.voice.channel}.`);

        return safeEditReply(interaction, { embeds: [embed] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
