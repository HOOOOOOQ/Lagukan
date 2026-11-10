const { EmbedBuilder, MessageFlags, escapeMarkdown } = require("discord.js");
const {
    TAG_COLORS,
    FOOTER_TEXT,
    hasAdminPermission,
    buildAdminDeniedEmbed,
    resetServerTagLogChannel,
} = require("../../../functions/serverTagLogger.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

function escapeInline(value) {
    return String(value ?? "").replace(/`/g, "ˋ");
}

module.exports = {
    name: "resetlogs",
    description: "Hapus konfigurasi channel log Server Tag pada server ini",
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
        const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const guildId = interaction.guildId;
        const guild = interaction.guild || client.guilds.cache.get(guildId);
        const botAvatar = client.user?.displayAvatarURL?.({ size: 128 }) || undefined;

        if (!guild) {
            const guildErrEmbed = new EmbedBuilder()
                .setColor(TAG_COLORS.ERROR)
                .setTitle("⚠️ Server Tidak Ditemukan")
                .setDescription("Data server ini belum tersedia di cache bot. Silakan coba beberapa saat lagi.")
                .setFooter({ text: FOOTER_TEXT, iconURL: botAvatar })
                .setTimestamp();

            return safeEditReply(interaction, { embeds: [guildErrEmbed] });
        }

        if (!hasAdminPermission(interaction, guild)) {
            const deniedEmbed = buildAdminDeniedEmbed(client, "resetlogs");
            return safeEditReply(interaction, { embeds: [deniedEmbed] });
        }

        let resetResult;
        try {
            resetResult = await resetServerTagLogChannel(client, guild, interaction.user.id, {
                strictMongo: true,
            });
        } catch (dbError) {
            const detail = escapeInline(dbError?.message || "Terjadi gangguan koneksi ke database MongoDB.");
            const mongoErrorEmbed = new EmbedBuilder()
                .setColor(TAG_COLORS.ERROR)
                .setTitle("❌ Gagal Mereset Konfigurasi di MongoDB")
                .setDescription(
                    [
                        "Perubahan reset konfigurasi log **Server Tag** belum berhasil disimpan ke database **MongoDB**.",
                        "",
                        `• **Detail Kesalahan:** \`${detail}\``,
                        "• **Saran:** Pastikan koneksi `MONGO_URI` aktif dan stabil, lalu jalankan kembali `/resetlogs`.",
                    ].join("\n"),
                )
                .setFooter({ text: FOOTER_TEXT, iconURL: botAvatar })
                .setTimestamp();

            return safeEditReply(interaction, { embeds: [mongoErrorEmbed] });
        }

        const { wasConfigured, previousChannelId, config } = resetResult;

        if (!wasConfigured) {
            const infoEmbed = new EmbedBuilder()
                .setColor(TAG_COLORS.REMOVED)
                .setAuthor({
                    name: `${guild.name} • Konfigurasi Server Tag Logger`,
                    iconURL: guild.iconURL?.({ size: 128 }) || botAvatar,
                })
                .setTitle("ℹ️ Konfigurasi Log Belum Aktif")
                .setDescription(
                    `Channel log **Server Tag** untuk server **${escapeMarkdown(guild.name)}** (\`${guildId}\`) memang belum diatur atau sudah dinonaktifkan.\n\nGunakan \`/setlogs\` apabila ingin mengaktifkan pencatatan.`,
                )
                .setFooter({ text: FOOTER_TEXT, iconURL: botAvatar })
                .setTimestamp();

            return safeEditReply(interaction, { embeds: [infoEmbed] });
        }

        const totalRecorded =
            (Number(config?.statistics?.installed) || 0) +
            (Number(config?.statistics?.changed) || 0) +
            (Number(config?.statistics?.removed) || 0);

        const embed = new EmbedBuilder()
            .setColor(TAG_COLORS.INFO)
            .setAuthor({
                name: `${guild.name} • Konfigurasi Server Tag Logger`,
                iconURL: guild.iconURL?.({ size: 128 }) || botAvatar,
            })
            .setTitle("🗑️ Konfigurasi Log Server Berhasil Direset")
            .setDescription(
                `Pengaturan channel log **Server Tag** untuk server **${escapeMarkdown(guild.name)}** telah dihapus di MongoDB dan pengiriman notifikasi dinonaktifkan tanpa memengaruhi server lain.`,
            )
            .addFields({
                name: "📋 Detail Reset Server Ini",
                value: [
                    `• **Server:** **${escapeMarkdown(guild.name)}** (\`${guildId}\`)`,
                    `• **Channel Sebelumnya:** ${previousChannelId ? `<#${previousChannelId}> (\`${previousChannelId}\`)` : "`Tidak ada`"}`,
                    `• **Status Sekarang:** 🔴 Nonaktif`,
                    `• **Direset Oleh:** <@${interaction.user.id}>`,
                    `• **Statistik Tersimpan:** \`${totalRecorded}\` total aktivitas historis server ini tetap aman`,
                ].join("\n"),
                inline: false,
            })
            .setFooter({ text: FOOTER_TEXT, iconURL: botAvatar })
            .setTimestamp();

        return safeEditReply(interaction, { embeds: [embed] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
