const { EmbedBuilder, MessageFlags } = require("discord.js");
const { cleanupStalePlayerIfDisconnected } = require("../../../functions/voiceSessionManager.js");
const { getOrCreateGuildPlayer } = require("../../../functions/musicPermissions.js");
const { safeDeferReply, safeEditReply, safeReply, voiceConnectionErrorMessage } = require("../../../functions/interactionResponder.js");
const Logger = require("../../../utils/logger");

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

        const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        player = (await cleanupStalePlayerIfDisconnected(client, interaction.guild)) || null;

        if (player) {
            embed.setDescription(`Already joined <#${player.voiceId}>.`);
            return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        try {
            await getOrCreateGuildPlayer(client, {
                guild: interaction.guild,
                voiceChannelId: interaction.member.voice.channelId,
                textChannelId: interaction.channelId,
            });
        } catch (err) {
            Logger.music("error", "Failed to create or join voice player", {
                guildId: interaction.guildId,
                userId: interaction.user?.id,
                command: "join",
                errorMessage: err,
            });
            embed.setDescription(voiceConnectionErrorMessage(err));
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
