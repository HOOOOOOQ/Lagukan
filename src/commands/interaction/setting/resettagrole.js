const { EmbedBuilder, MessageFlags, escapeMarkdown } = require("discord.js");
const { hasAdminPermission, buildAdminDeniedEmbed } = require("../../../functions/serverTagLogger.js");
const { AUTO_ROLE_COLORS, AUTO_ROLE_FOOTER, resetTagRoleConfig } = require("../../../functions/serverTagAutoRole.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

function escapeInline(value) {
    return String(value ?? "").replace(/`/g, "ˋ");
}

module.exports = {
    name: "resettagrole",
    description: "Hapus konfigurasi Server Tag Auto Role pada server ini",
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
                .setColor(AUTO_ROLE_COLORS.ERROR)
                .setTitle("⚠️ Server Tidak Ditemukan")
                .setDescription("Data server ini belum tersedia di cache bot. Silakan coba beberapa saat lagi.")
                .setFooter({ text: AUTO_ROLE_FOOTER, iconURL: botAvatar })
                .setTimestamp();

            return safeEditReply(interaction, { embeds: [guildErrEmbed] });
        }

        if (!hasAdminPermission(interaction, guild)) {
            const deniedEmbed = buildAdminDeniedEmbed(client, "resettagrole");
            return safeEditReply(interaction, { embeds: [deniedEmbed] });
        }

        let resetResult;
        try {
            resetResult = await resetTagRoleConfig(client, guildId, interaction.user.id, {
                strictMongo: true,
            });
        } catch (dbErr) {
            const detail = escapeInline(dbErr?.message || "Gangguan koneksi ke database MongoDB.");
            const mongoErrorEmbed = new EmbedBuilder()
                .setColor(AUTO_ROLE_COLORS.ERROR)
                .setTitle("❌ Gagal Mereset Auto Role di MongoDB")
                .setDescription(
                    [
                        "Konfigurasi **Server Tag Auto Role** belum berhasil dihapus dari database **MongoDB**.",
                        "",
                        `• **Detail Kesalahan:** \`${detail}\``,
                        "• **Saran:** Pastikan variabel `MONGO_URI` aktif dan stabil, lalu jalankan kembali `/resettagrole`.",
                    ].join("\n"),
                )
                .setFooter({ text: AUTO_ROLE_FOOTER, iconURL: botAvatar })
                .setTimestamp();

            return safeEditReply(interaction, { embeds: [mongoErrorEmbed] });
        }

        const { wasConfigured, previousRoleId } = resetResult;

        if (!wasConfigured) {
            const infoEmbed = new EmbedBuilder()
                .setColor(AUTO_ROLE_COLORS.INACTIVE)
                .setAuthor({
                    name: `${guild.name} • Konfigurasi Server Tag Auto Role`,
                    iconURL: guild.iconURL?.({ size: 128 }) || botAvatar,
                })
                .setTitle("ℹ️ Auto Role Belum Dikonfigurasi")
                .setDescription(
                    `Fitur **Server Tag Auto Role** pada server **${escapeMarkdown(guild.name)}** (\`${guildId}\`) memang belum dikonfigurasi.\n\nGunakan \`/settagrole\` jika Anda ingin mengatur role otomatis.`,
                )
                .setFooter({ text: AUTO_ROLE_FOOTER, iconURL: botAvatar })
                .setTimestamp();

            return safeEditReply(interaction, { embeds: [infoEmbed] });
        }

        const embed = new EmbedBuilder()
            .setColor(AUTO_ROLE_COLORS.PRIMARY)
            .setAuthor({
                name: `${guild.name} • Konfigurasi Server Tag Auto Role`,
                iconURL: guild.iconURL?.({ size: 128 }) || botAvatar,
            })
            .setTitle("🗑️ Konfigurasi Auto Role Berhasil Direset")
            .setDescription(
                `Pengaturan **Server Tag Auto Role** untuk server **${escapeMarkdown(guild.name)}** telah dihapus dari MongoDB dan dinonaktifkan tanpa memengaruhi server lain.`,
            )
            .addFields({
                name: "📋 Ringkasan Reset",
                value: [
                    `• **Server:** **${escapeMarkdown(guild.name)}** (\`${guildId}\`)`,
                    `• **Role Sebelumnya:** ${previousRoleId ? `<@&${previousRoleId}> (\`${previousRoleId}\`)` : "`Tidak ada`"}`,
                    `• **Status Sekarang:** ⚪ Belum dikonfigurasi (Nonaktif)`,
                    `• **Direset Oleh:** <@${interaction.user.id}>`,
                ].join("\n"),
                inline: false,
            })
            .setFooter({ text: AUTO_ROLE_FOOTER, iconURL: botAvatar })
            .setTimestamp();

        return safeEditReply(interaction, { embeds: [embed] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
