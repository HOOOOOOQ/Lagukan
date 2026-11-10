const { EmbedBuilder, MessageFlags, escapeMarkdown } = require("discord.js");
const { hasAdminPermission, buildAdminDeniedEmbed } = require("../../../functions/serverTagLogger.js");
const { AUTO_ROLE_COLORS, AUTO_ROLE_FOOTER, syncGuildTagAutoRoles } = require("../../../functions/serverTagAutoRole.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "synctagrole",
    description: "Periksa dan sinkronkan Auto Role untuk member yang menggunakan Server Tag server ini",
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
            const deniedEmbed = buildAdminDeniedEmbed(client, "synctagrole");
            return safeEditReply(interaction, { embeds: [deniedEmbed] });
        }

        const result = await syncGuildTagAutoRoles(client, guild, { fetchMembers: true });

        if (!result.ok) {
            const warnEmbed = new EmbedBuilder()
                .setColor(AUTO_ROLE_COLORS.WARNING)
                .setAuthor({
                    name: `${guild.name} • Sinkronisasi Server Tag Auto Role`,
                    iconURL: guild.iconURL?.({ size: 128 }) || botAvatar,
                })
                .setTitle("⚠️ Sinkronisasi Auto Role Tidak Dapat Dijalankan")
                .setDescription(result.message)
                .setFooter({ text: AUTO_ROLE_FOOTER, iconURL: botAvatar })
                .setTimestamp();

            return safeEditReply(interaction, { embeds: [warnEmbed] });
        }

        const dataSourceLabel = result.fetchedAllMembers
            ? "⚡ Seluruh anggota server berhasil diperiksa (`Server Members Intent` aktif)"
            : result.realTimeIntent
              ? "ℹ️ Menggunakan daftar anggota yang tersedia pada cache server"
              : "⚠️ Mode Kompatibilitas — hanya memeriksa anggota yang tersedia di cache (aktifkan `SERVER MEMBERS INTENT` di Discord Developer Portal untuk pemindaian penuh)";

        const summaryLines = [
            `• **Server:** **${escapeMarkdown(guild.name)}** (\`${guildId}\`)`,
            `• **Role Auto Role:** <@&${result.role.id}> (\`${result.role.id}\`)`,
            `• **Member Diperiksa:** \`${result.scanned}\` member (non-bot)`,
            `• **Role Baru Diberikan:** \`${result.granted}\` member`,
            `• **Role Dicabut:** \`${result.revoked}\` member`,
            `• **Sudah Sesuai:** \`${result.unchanged}\` member`,
            `• **Gagal Diproses:** \`${result.failed}\` member`,
            `• **Cakupan Data:** ${dataSourceLabel}`,
        ];

        const embed = new EmbedBuilder()
            .setColor(AUTO_ROLE_COLORS.ACTIVE)
            .setAuthor({
                name: `${guild.name} • Sinkronisasi Server Tag Auto Role`,
                iconURL: guild.iconURL?.({ size: 128 }) || botAvatar,
            })
            .setTitle("🔄 Sinkronisasi Server Tag Auto Role Selesai")
            .setDescription(
                `Pemeriksaan dan penyelarasan **Server Tag Auto Role** pada server **${escapeMarkdown(guild.name)}** telah selesai dijalankan berdasarkan pencocokan ID server identitas resmi Discord.`,
            )
            .addFields({
                name: "📊 Hasil Sinkronisasi",
                value: summaryLines.join("\n"),
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
