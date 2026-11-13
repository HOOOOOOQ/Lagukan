const { ApplicationCommandOptionType, ChannelType, EmbedBuilder, MessageFlags, PermissionsBitField } = require("discord.js");
const { verifyVoiceChannelPermissions, upsertAuto247Config, ensureBotAuto247Connected } = require("../../../functions/auto247Manager.js");
const { clearManualDisconnect } = require("../../../functions/voiceSessionManager.js");
const { THEME_666 } = require("../../../functions/cardRenderer666.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "247-setup",
    description: "Atur Voice Channel 24/7 otomatis khusus untuk bot ini (join otomatis saat startup & reconnect)",
    category: "setting",
    options: [
        {
            name: "voice_channel",
            description: "Voice Channel tempat bot ini akan standby 24/7 secara otomatis",
            type: ApplicationCommandOptionType.Channel,
            channel_types: [ChannelType.GuildVoice, ChannelType.GuildStageVoice],
            required: true,
        },
        {
            name: "auto_reconnect",
            description: "Sambungkan ulang otomatis jika bot terputus dari Voice Channel (default: true)",
            type: ApplicationCommandOptionType.Boolean,
            required: false,
        },
    ],
    permissions: {
        bot: [],
        user: [PermissionsBitField.Flags.ManageGuild],
    },
    settings: {
        voice: false,
        player: false,
        current: false,
    },
    devOnly: false,
    run: async (client, interaction) => {
        const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const voiceChannel = interaction.options.getChannel("voice_channel");
        const autoReconnect = interaction.options.getBoolean("auto_reconnect") ?? true;
        const botName = client.user?.username || "Lagukan 666";

        const permCheck = verifyVoiceChannelPermissions(interaction.guild, voiceChannel);
        if (!permCheck.valid) {
            const errEmbed = new EmbedBuilder().setColor(0xff4757).setDescription(`❌ **Gagal mengatur 24/7:** ${permCheck.reason}`);
            return safeEditReply(interaction, { embeds: [errEmbed] });
        }

        await clearManualDisconnect(client, interaction.guildId, interaction.guild);
        await upsertAuto247Config(client, {
            guildId: interaction.guildId,
            voiceChannelId: voiceChannel.id,
            enabled: true,
            autoReconnect,
            updatedBy: interaction.user.id,
        });

        const connectResult = await ensureBotAuto247Connected(client, interaction.guildId, { forceMove: true });

        const embed = new EmbedBuilder()
            .setColor(THEME_666.embedColor)
            .setTitle("666 • Auto 24/7 Voice Configured")
            .setDescription(
                [
                    `✅ Konfigurasi **Auto 24/7** untuk **${botName}** berhasil disimpan!`,
                    `• **Bot Application ID:** \`${client.user.id}\``,
                    `• **Voice Channel:** <#${voiceChannel.id}> (\`${voiceChannel.id}\`)`,
                    `• **Auto Reconnect:** \`${autoReconnect ? "Aktif" : "Nonaktif"}\``,
                    `• **Status Koneksi:** ${connectResult.connected ? "🟢 Terhubung ke Voice Channel" : `🟡 Disimpan (${connectResult.reason})`}`,
                ].join("\n"),
            );

        return safeEditReply(interaction, { embeds: [embed] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
