const { ApplicationCommandOptionType, ChannelType, EmbedBuilder, MessageFlags } = require("discord.js");
const {
    TAG_COLORS,
    FOOTER_TEXT,
    hasAdminPermission,
    hasServerMembersIntent,
    buildAdminDeniedEmbed,
    validateLogChannel,
    setServerTagLogChannel,
} = require("../../../functions/serverTagLogger.js");

module.exports = {
    name: "setlogs",
    description: "Atur channel teks untuk menerima notifikasi Server Tag Logger",
    category: "setting",
    locale: "id",
    options: [
        {
            name: "channel",
            description: "Pilih channel teks tujuan pengiriman log Server Tag",
            type: ApplicationCommandOptionType.Channel,
            channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
            required: true,
        },
    ],
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
    run: async (client, interaction) => {
        if (!hasAdminPermission(interaction.member)) {
            const deniedEmbed = buildAdminDeniedEmbed(client, "setlogs");
            return interaction.reply({ embeds: [deniedEmbed], flags: [MessageFlags.Ephemeral] });
        }

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const guild = interaction.guild;
        const targetChannel = interaction.options.getChannel("channel");
        const botAvatar = client.user?.displayAvatarURL?.({ size: 128 }) || undefined;

        const validation = validateLogChannel(guild, targetChannel);
        if (!validation.valid) {
            const errorEmbed = new EmbedBuilder()
                .setColor(TAG_COLORS.ERROR)
                .setTitle("⚠️ Gagal Mengatur Channel Log")
                .setDescription(validation.message)
                .setFooter({ text: FOOTER_TEXT, iconURL: botAvatar })
                .setTimestamp();

            return interaction.editReply({ embeds: [errorEmbed] });
        }

        const { syncedCount } = await setServerTagLogChannel(client, guild, targetChannel.id, interaction.user.id);
        const realTimeIntent = hasServerMembersIntent(client);

        const detailLines = [
            `• **Status Fitur:** 🟢 Aktif`,
            `• **Channel Tujuan:** <#${targetChannel.id}> (\`${targetChannel.id}\`)`,
            `• **Diatur Oleh:** <@${interaction.user.id}>`,
            `• **Izin Bot di Channel:** ✅ \`ViewChannel\`, \`SendMessages\`, \`EmbedLinks\``,
            `• **Sinkronisasi Awal:** \`${syncedCount}\` data member berhasil dipetakan`,
            `• **Mode Deteksi Gateway:** ${
                realTimeIntent
                    ? "⚡ Real-Time (`Server Members Intent` aktif)"
                    : "⚠️ Mode Kompatibilitas — aktifkan **SERVER MEMBERS INTENT** di Discord Developer Portal agar perubahan tag terdeteksi secara real-time"
            }`,
        ];

        const successEmbed = new EmbedBuilder()
            .setColor(TAG_COLORS.INFO)
            .setAuthor({
                name: `${guild.name} • Konfigurasi Server Tag Logger`,
                iconURL: guild.iconURL?.({ size: 128 }) || botAvatar,
            })
            .setTitle("✅ Channel Server Tag Logger Berhasil Diatur")
            .setDescription(
                `Notifikasi aktivitas pemasangan, penggantian, pelepasan, dan pemasangan kembali **Server Tag** di server ini sekarang akan dikirim otomatis ke <#${targetChannel.id}>.`,
            )
            .addFields({
                name: "⚙️ Ringkasan Pengaturan",
                value: detailLines.join("\n"),
                inline: false,
            })
            .setFooter({ text: FOOTER_TEXT, iconURL: botAvatar })
            .setTimestamp();

        return interaction.editReply({ embeds: [successEmbed] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
