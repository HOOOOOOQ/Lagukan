const { EmbedBuilder, MessageFlags } = require("discord.js");
const { getGuildPlayer, performManualLeave } = require("../../../functions/voiceSessionManager.js");
const { safeDeferReply, safeEditReply, safeReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "leave",
    description: "Make Lagukan leave the voice channel",
    category: "music",
    permissions: {
        bot: [],
        user: ["ManageGuild"],
    },
    settings: {
        voice: true,
        player: false,
        current: false,
    },
    devOnly: false,
    run: async (client, interaction, player) => {
        const botName = client.config.botName || "Lagukan";
        const embed = new EmbedBuilder().setColor(client.config.embedColor);
        const activePlayer = player || getGuildPlayer(client, interaction.guildId);
        const botVoiceId = activePlayer?.voiceId || interaction.guild?.members?.me?.voice?.channelId || null;
        const guildData = client.data.get(`guildData_${interaction.guildId}`);

        if (!activePlayer && !botVoiceId && !guildData?.reconnect?.status) {
            embed.setDescription(`There is no active player in this server.`);

            return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        if (botVoiceId && interaction.member?.voice?.channelId !== botVoiceId) {
            embed.setDescription(`You need to be in the same voice channel as ${botName}.`);

            return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        await performManualLeave(client, interaction.guild, activePlayer);

        embed.setDescription(`Leaving voice channel...`);

        return safeEditReply(interaction, { embeds: [embed] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
