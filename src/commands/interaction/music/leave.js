const { EmbedBuilder, MessageFlags, PermissionsBitField } = require("discord.js");
const { getGuildPlayer, performManualLeave } = require("../../../functions/voiceSessionManager.js");
const { checkDjAccess } = require("../../../functions/musicPermissions.js");
const { safeDeferReply, safeEditReply, safeReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "leave",
    description: "Disconnect Lagukan from the voice channel and stop Auto Reconnect",
    category: "music",
    permissions: {
        bot: [],
        user: [],
    },
    settings: {
        voice: false,
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
            embed.setDescription("There is no active player in this server.");
            return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        const isAdmin = Boolean(
            interaction.memberPermissions?.has?.(PermissionsBitField.Flags.ManageGuild) ||
            interaction.memberPermissions?.has?.(PermissionsBitField.Flags.Administrator),
        );

        if (botVoiceId && !isAdmin && interaction.member?.voice?.channelId !== botVoiceId) {
            embed.setDescription(`You need to be in the same voice channel as ${botName}.`);
            return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        const djCheck = checkDjAccess(client, {
            guild: interaction.guild,
            member: interaction.member,
            user: interaction.user,
            player: activePlayer,
            track: activePlayer?.queue?.current || null,
            allowRequester: false,
            interaction,
        });

        if (!djCheck.allowed) {
            embed.setDescription(djCheck.reason);
            return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        await performManualLeave(client, interaction.guild, activePlayer);

        embed.setDescription("Disconnected from the voice channel. Auto-reconnect has been stopped.");

        return safeEditReply(interaction, { embeds: [embed] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
