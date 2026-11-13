const { ApplicationCommandOptionType, ChannelType, EmbedBuilder, MessageFlags, PermissionsBitField } = require("discord.js");
const {
    isVoiceChannelDirectSendable,
    hasChannelSendPermissions,
    upsertNotificationConfig,
} = require("../../../functions/profileNotificationManager.js");
const { THEME_666 } = require("../../../functions/cardRenderer666.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "profile-notification",
    description: "Konfigurasi channel notifikasi profil & achievement per Voice Channel untuk bot ini",
    category: "setting",
    options: [
        {
            name: "setup",
            description: "Aktifkan notifikasi otomatis pada Voice Channel (chat Voice Channel langsung atau fallback)",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "voice_channel",
                    description: "Voice Channel milik bot ini",
                    type: ApplicationCommandOptionType.Channel,
                    channel_types: [ChannelType.GuildVoice, ChannelType.GuildStageVoice],
                    required: true,
                },
                {
                    name: "fallback_channel",
                    description: "Text channel cadangan jika Voice Channel tidak mendukung chat langsung",
                    type: ApplicationCommandOptionType.Channel,
                    channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
                    required: false,
                },
            ],
        },
        {
            name: "set-channel",
            description: "Tetapkan text channel khusus untuk notifikasi sesi dari Voice Channel tertentu",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "voice_channel",
                    description: "Voice Channel yang ingin dihubungkan",
                    type: ApplicationCommandOptionType.Channel,
                    channel_types: [ChannelType.GuildVoice, ChannelType.GuildStageVoice],
                    required: true,
                },
                {
                    name: "text_channel",
                    description: "Text channel tujuan notifikasi untuk Voice Channel tersebut",
                    type: ApplicationCommandOptionType.Channel,
                    channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
                    required: true,
                },
            ],
        },
        {
            name: "disable",
            description: "Nonaktifkan pengiriman notifikasi profil & achievement pada Voice Channel tertentu",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "voice_channel",
                    description: "Voice Channel yang ingin dinonaktifkan notifikasinya",
                    type: ApplicationCommandOptionType.Channel,
                    channel_types: [ChannelType.GuildVoice, ChannelType.GuildStageVoice],
                    required: true,
                },
            ],
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

        const sub = interaction.options.getSubcommand();
        const voiceChannel = interaction.options.getChannel("voice_channel");
        const botName = client.user?.username || "Lagukan 666";

        if (sub === "setup") {
            const fallbackChannel = interaction.options.getChannel("fallback_channel") || null;
            const supportsDirectVoiceChat =
                isVoiceChannelDirectSendable(voiceChannel) && hasChannelSendPermissions(interaction.guild, voiceChannel);

            if (!supportsDirectVoiceChat && !fallbackChannel) {
                const errEmbed = new EmbedBuilder()
                    .setColor(0xff4757)
                    .setDescription(
                        `❌ Voice channel <#${voiceChannel.id}> tidak mendukung pengiriman pesan langsung atau bot belum memiliki izin \`ViewChannel / SendMessages / EmbedLinks\`. Sertakan \`fallback_channel\` atau gunakan \`/profile-notification set-channel\`.`,
                    );
                return safeEditReply(interaction, { embeds: [errEmbed] });
            }

            if (fallbackChannel && !hasChannelSendPermissions(interaction.guild, fallbackChannel)) {
                const errEmbed = new EmbedBuilder()
                    .setColor(0xff4757)
                    .setDescription(`❌ Bot kekurangan izin kirim pesan/embed pada channel <#${fallbackChannel.id}>.`);
                return safeEditReply(interaction, { embeds: [errEmbed] });
            }

            await upsertNotificationConfig(client, {
                guildId: interaction.guildId,
                voiceChannelId: voiceChannel.id,
                notificationChannelId: fallbackChannel ? fallbackChannel.id : voiceChannel.id,
                useVoiceChannelChat: !fallbackChannel,
                enabled: true,
                updatedBy: interaction.user.id,
            });

            const okEmbed = new EmbedBuilder()
                .setColor(THEME_666.embedColor)
                .setTitle("666 • Profile Notification Setup")
                .setDescription(
                    [
                        `✅ Notifikasi untuk **${botName}** berhasil diaktifkan!`,
                        `• **Bot Application ID:** \`${client.user.id}\``,
                        `• **Voice Channel:** <#${voiceChannel.id}>`,
                        `• **Target Chat:** ${fallbackChannel ? `<#${fallbackChannel.id}> *(Text Channel Khusus)*` : `<#${voiceChannel.id}> *(Chat Voice Channel Langsung)*`}`,
                    ].join("\n"),
                );

            return safeEditReply(interaction, { embeds: [okEmbed] });
        }

        if (sub === "set-channel") {
            const textChannel = interaction.options.getChannel("text_channel");
            if (!hasChannelSendPermissions(interaction.guild, textChannel)) {
                const errEmbed = new EmbedBuilder()
                    .setColor(0xff4757)
                    .setDescription(
                        `❌ Bot tidak memiliki izin \`ViewChannel\`, \`SendMessages\`, atau \`EmbedLinks\` di <#${textChannel.id}>.`,
                    );
                return safeEditReply(interaction, { embeds: [errEmbed] });
            }

            await upsertNotificationConfig(client, {
                guildId: interaction.guildId,
                voiceChannelId: voiceChannel.id,
                notificationChannelId: textChannel.id,
                useVoiceChannelChat: false,
                enabled: true,
                updatedBy: interaction.user.id,
            });

            const okEmbed = new EmbedBuilder()
                .setColor(THEME_666.embedColor)
                .setTitle("666 • Profile Notification Channel Updated")
                .setDescription(
                    [
                        `✅ Channel notifikasi khusus berhasil disimpan untuk **${botName}**:`,
                        `• **Voice Channel:** <#${voiceChannel.id}>`,
                        `• **Notification Channel:** <#${textChannel.id}>`,
                    ].join("\n"),
                );

            return safeEditReply(interaction, { embeds: [okEmbed] });
        }

        if (sub === "disable") {
            await upsertNotificationConfig(client, {
                guildId: interaction.guildId,
                voiceChannelId: voiceChannel.id,
                notificationChannelId: null,
                useVoiceChannelChat: false,
                enabled: false,
                updatedBy: interaction.user.id,
            });

            const okEmbed = new EmbedBuilder()
                .setColor(THEME_666.embedColor)
                .setTitle("666 • Profile Notification Disabled")
                .setDescription(
                    `🔕 Pengiriman notifikasi profil & achievement untuk **${botName}** pada <#${voiceChannel.id}> telah dinonaktifkan.`,
                );

            return safeEditReply(interaction, { embeds: [okEmbed] });
        }
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
