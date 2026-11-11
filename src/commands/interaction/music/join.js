const { EmbedBuilder, MessageFlags } = require("discord.js");
const { cleanupStalePlayerIfDisconnected } = require("../../../functions/voiceSessionManager.js");
const { getOrCreateGuildPlayer } = require("../../../functions/musicPermissions.js");
const { safeDeferReply, safeEditReply, safeReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "join",
    description: "Make Lagukan join your voice channel",
    category: "music",
    permissions: {
        bot: ["Connect", "Speak"],
        user: ["Connect"],
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
            embed.setDescription(`Already joined <#${player.voiceId}>.`);
            return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        try {
            await getOrCreateGuildPlayer(client, {
                guild: interaction.guild,
                voiceChannelId: interaction.member.voice.channelId,
                textChannelId: interaction.channelId,
            });
        } catch (err) {
            embed.setDescription(err?.message || "Could not connect to voice channel right now.");
            return safeEditReply(interaction, { embeds: [embed] });
        }

        embed.setDescription(`Joined ${interaction.member.voice.channel}.`);

        return safeEditReply(interaction, { embeds: [embed] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
