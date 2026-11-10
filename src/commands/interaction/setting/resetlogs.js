const { EmbedBuilder, MessageFlags } = require("discord.js");
const {
    TAG_COLORS,
    FOOTER_TEXT,
    hasAdminPermission,
    buildAdminDeniedEmbed,
    resetServerTagLogChannel,
} = require("../../../functions/serverTagLogger.js");

module.exports = {
    name: "resetlogs",
    description: "Hapus pengaturan channel log dan nonaktifkan Server Tag Logger",
    category: "setting",
    locale: "id",
    options: [],
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
            const deniedEmbed = buildAdminDeniedEmbed(client, "resetlogs");
            return interaction.reply({ embeds: [deniedEmbed], flags: [MessageFlags.Ephemeral] });
        }

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const guild = interaction.guild;
        const botAvatar = client.user?.displayAvatarURL?.({ size: 128 }) || undefined;
        const { wasConfigured, previousChannelId, config } = await resetServerTagLogChannel(client, guild, interaction.user.id);

        if (!wasConfigured) {
            const infoEmbed = new EmbedBuilder()
                .setColor(TAG_COLORS.REMOVED)
                .setAuthor({
                    name: `${guild.name} • Konfigurasi Server Tag Logger`,
                    iconURL: guild.iconURL?.({ size: 128 }) || botAvatar,
                })
                .setTitle("ℹ️ Channel Log Belum Diatur")
                .setDescription(
                    "Pengaturan channel **Server Tag Logger** di server ini memang belum aktif atau sudah dihapus sebelumnya.\n\nGunakan `/setlogs` apabila ingin mulai mengaktifkan pencatatan log.",
                )
                .setFooter({ text: FOOTER_TEXT, iconURL: botAvatar })
                .setTimestamp();

            return interaction.editReply({ embeds: [infoEmbed] });
        }

        const totalRecorded =
            (Number(config?.stats?.totalInstalled) || 0) +
            (Number(config?.stats?.totalChanged) || 0) +
            (Number(config?.stats?.totalRemoved) || 0);

        const embed = new EmbedBuilder()
            .setColor(TAG_COLORS.INFO)
            .setAuthor({
                name: `${guild.name} • Konfigurasi Server Tag Logger`,
                iconURL: guild.iconURL?.({ size: 128 }) || botAvatar,
            })
            .setTitle("🗑️ Pengaturan Channel Log Berhasil Direset")
            .setDescription(
                "Pengiriman notifikasi otomatis **Server Tag Logger** di server ini telah dinonaktifkan dan konfigurasi channel log telah dihapus.",
            )
            .addFields({
                name: "📋 Detail Perubahan",
                value: [
                    `• **Channel Sebelumnya:** ${previousChannelId ? `<#${previousChannelId}> (\`${previousChannelId}\`)` : "`Tidak ada`"}`,
                    `• **Status Fitur Sekarang:** 🔴 Nonaktif`,
                    `• **Direset Oleh:** <@${interaction.user.id}>`,
                    `• **Data Statistik Server:** Tetap tersimpan di database (\`${totalRecorded}\` total aktivitas historis)`,
                ].join("\n"),
                inline: false,
            })
            .setFooter({ text: FOOTER_TEXT, iconURL: botAvatar })
            .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
