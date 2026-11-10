const { EmbedBuilder, MessageFlags } = require("discord.js");
const {
    TAG_COLORS,
    FOOTER_TEXT,
    hasServerMembersIntent,
    validateLogChannel,
    getServerTagStatsSnapshot,
} = require("../../../functions/serverTagLogger.js");

module.exports = {
    name: "ceklogs",
    description: "Lihat konfigurasi channel dan status fitur Server Tag Logger saat ini",
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
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const guild = interaction.guild;
        const botAvatar = client.user?.displayAvatarURL?.({ size: 128 }) || undefined;
        const snapshot = await getServerTagStatsSnapshot(client, guild);
        const realTimeIntent = hasServerMembersIntent(client);

        let channelDisplay = "`Belum diatur` *(gunakan `/setlogs` untuk mengaktifkan)*";
        let permissionHealth = "⚪ Menunggu pemilihan channel";
        let embedColor = snapshot.enabled ? TAG_COLORS.INFO : TAG_COLORS.REMOVED;

        if (snapshot.channelId) {
            const targetChannel =
                guild.channels?.cache?.get?.(snapshot.channelId) ||
                (typeof guild.channels?.fetch === "function" ? await guild.channels.fetch(snapshot.channelId).catch(() => null) : null);

            if (!targetChannel) {
                channelDisplay = `⚠️ Channel tidak ditemukan (\`${snapshot.channelId}\`) — kemungkinan telah dihapus`;
                permissionHealth = "❌ Channel tidak tersedia, atur ulang dengan `/setlogs`";
                embedColor = TAG_COLORS.WARNING;
            } else {
                channelDisplay = `<#${targetChannel.id}> (\`${targetChannel.id}\`)`;
                const validation = validateLogChannel(guild, targetChannel);
                if (validation.valid) {
                    permissionHealth = "✅ Lengkap (`ViewChannel`, `SendMessages`, `EmbedLinks`)";
                } else {
                    const missingKeys = validation.missingPermissions.map((m) => `\`${m.key}\``).join(", ");
                    permissionHealth = `⚠️ Kurang izin: ${missingKeys || validation.code}`;
                    embedColor = TAG_COLORS.WARNING;
                }
            }
        }

        const updatedAtUnix = snapshot.updatedAt ? Math.floor(new Date(snapshot.updatedAt).getTime() / 1000) : null;
        const updatedInfo = updatedAtUnix
            ? `<t:${updatedAtUnix}:R>${snapshot.updatedBy ? ` oleh <@${snapshot.updatedBy}>` : ""}`
            : "`Belum pernah diperbarui`";

        const configLines = [
            `• **Status Fitur:** ${snapshot.enabled ? "🟢 Aktif" : "🔴 Nonaktif"}`,
            `• **Channel Log:** ${channelDisplay}`,
            `• **Status Izin Bot:** ${permissionHealth}`,
            `• **Mode Deteksi Gateway:** ${
                realTimeIntent
                    ? "⚡ Real-Time (`Server Members Intent` aktif)"
                    : "ℹ️ Mode Kompatibilitas (aktifkan `SERVER MEMBERS INTENT` untuk deteksi real-time)"
            }`,
            `• **Pembaruan Terakhir:** ${updatedInfo}`,
        ];

        const statsLines = [
            `• **Total Pemasangan:** \`${snapshot.stats.totalInstalled}\` kali`,
            `• **Total Penggantian:** \`${snapshot.stats.totalChanged}\` kali`,
            `• **Total Penghapusan:** \`${snapshot.stats.totalRemoved}\` kali`,
            `• **Member Bertag Saat Ini:** \`${snapshot.activeSummary.totalActive}\` member terpantau`,
        ];

        const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setAuthor({
                name: `${guild.name} • Status Server Tag Logger`,
                iconURL: guild.iconURL?.({ size: 128 }) || botAvatar,
            })
            .setTitle("🔎 Informasi Pengaturan Server Tag Logger")
            .setDescription(
                snapshot.enabled
                    ? "Sistem pemantau **Server Tag** aktif dan siap mencatat perubahan tag member di server ini."
                    : "Sistem pemantau **Server Tag** saat ini belum diaktifkan. Administrator dapat menggunakan command `/setlogs` untuk memilih channel log.",
            )
            .addFields(
                {
                    name: "⚙️ Konfigurasi Saat Ini",
                    value: configLines.join("\n"),
                    inline: false,
                },
                {
                    name: "📊 Ringkasan Aktivitas",
                    value: statsLines.join("\n"),
                    inline: false,
                },
            )
            .setFooter({ text: FOOTER_TEXT, iconURL: botAvatar })
            .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
