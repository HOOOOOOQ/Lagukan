const { EmbedBuilder, MessageFlags, escapeMarkdown } = require("discord.js");
const { hasServerMembersIntent, detectGuildOwnTagFromMembers } = require("../../../functions/serverTagLogger.js");
const {
    AUTO_ROLE_COLORS,
    AUTO_ROLE_FOOTER,
    ensureTagRoleConfig,
    inspectAutoRoleHealth,
} = require("../../../functions/serverTagAutoRole.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

function escapeInline(value) {
    return String(value ?? "").replace(/`/g, "ˋ");
}

module.exports = {
    name: "cektagrole",
    description: "Lihat status dan role yang digunakan pada Server Tag Auto Role di server ini",
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

        let config;
        try {
            config = await ensureTagRoleConfig(client, guild);
        } catch (dbErr) {
            const detail = escapeInline(dbErr?.message || "Gagal membaca konfigurasi dari database MongoDB.");
            const errEmbed = new EmbedBuilder()
                .setColor(AUTO_ROLE_COLORS.ERROR)
                .setTitle("❌ Gagal Memuat Konfigurasi Auto Role")
                .setDescription(`Terjadi kendala saat mengambil konfigurasi dari MongoDB.\n\n• **Detail:** \`${detail}\``)
                .setFooter({ text: AUTO_ROLE_FOOTER, iconURL: botAvatar })
                .setTimestamp();

            return safeEditReply(interaction, { embeds: [errEmbed] });
        }

        const health = await inspectAutoRoleHealth(guild, config?.roleId);
        const realTimeIntent = hasServerMembersIntent(client);
        const discoveredTag = detectGuildOwnTagFromMembers(guild, guild.members?.cache);
        const cachedTagConfig = client.data.get(`tagConfig_${guildId}`);
        const detectedTagName = discoveredTag?.tag || cachedTagConfig?.detectedServerTag?.tag || null;

        let statusText = "⚪ Belum dikonfigurasi";
        let embedColor = AUTO_ROLE_COLORS.INACTIVE;
        let roleDisplay = "`Belum diatur` *(gunakan `/settagrole` untuk memilih role)*";
        let securityDisplay = health.hasManageRoles
            ? "✅ Permission `Manage Roles` aktif"
            : "❌ Bot belum memiliki permission `Manage Roles`";

        if (config?.roleId) {
            if (!health.roleExists) {
                statusText = "⚠️ Role Terhapus — Perlu Diatur Ulang";
                embedColor = AUTO_ROLE_COLORS.WARNING;
                roleDisplay = `⚠️ Role tidak ditemukan (\`${config.roleId}\`) — kemungkinan sudah dihapus`;
                securityDisplay = "❌ Pilih role baru melalui `/settagrole`";
            } else {
                roleDisplay = `<@&${config.roleId}> (\`${config.roleId}\`)`;
                if (config.enabled && health.valid) {
                    statusText = "🟢 Aktif";
                    embedColor = AUTO_ROLE_COLORS.ACTIVE;
                    securityDisplay = "✅ `Manage Roles` aktif & posisi role aman di bawah role Lagukan";
                } else if (config.enabled && !health.valid) {
                    statusText = "⚠️ Aktif (Terdapat Kendala Izin / Hierarki)";
                    embedColor = AUTO_ROLE_COLORS.WARNING;
                    securityDisplay = `⚠️ ${health.warning}`;
                } else {
                    statusText = "🔴 Nonaktif";
                    embedColor = AUTO_ROLE_COLORS.INACTIVE;
                }
            }
        }

        const createdUnix = config?.createdAt ? Math.floor(new Date(config.createdAt).getTime() / 1000) : null;
        const updatedUnix = config?.updatedAt ? Math.floor(new Date(config.updatedAt).getTime() / 1000) : null;

        const configLines = [
            `• **Server:** **${escapeMarkdown(guild.name)}** (\`${guildId}\`)`,
            `• **Status Fitur:** ${statusText}`,
            `• **Role Auto Role:** ${roleDisplay}`,
            `• **Server Tag Terdeteksi:** ${detectedTagName ? `\`[${escapeInline(detectedTagName)}]\`` : "`Berdasarkan ID Server saat ini`"}`,
            `• **Status Keamanan & Izin:** ${securityDisplay}`,
            `• **Member Terkelola Saat Ini:** \`${Array.isArray(config?.assignedUsers) ? config.assignedUsers.length : 0}\` member`,
            `• **Mode Deteksi Gateway:** ${
                realTimeIntent
                    ? "⚡ Real-Time (`GUILD_MEMBER_UPDATE` & `USER_UPDATE` aktif)"
                    : "ℹ️ Mode Kompatibilitas (aktifkan `SERVER MEMBERS INTENT` untuk sinkronisasi penuh)"
            }`,
            `• **Diatur Oleh:** ${config?.configuredBy ? `<@${config.configuredBy}>` : "`Belum pernah diatur`"}`,
            `• **Dibuat Pada:** ${createdUnix ? `<t:${createdUnix}:F>` : "`-`"}`,
            `• **Diperbarui Pada:** ${updatedUnix ? `<t:${updatedUnix}:R>` : "`-`"}`,
        ];

        const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setAuthor({
                name: `${guild.name} • Status Server Tag Auto Role`,
                iconURL: guild.iconURL?.({ size: 128 }) || botAvatar,
            })
            .setTitle("🛡️ Konfigurasi Server Tag Auto Role")
            .setDescription(
                config?.enabled && health.roleExists
                    ? `Sistem **Server Tag Auto Role** sedang aktif pada server **${escapeMarkdown(guild.name)}**.`
                    : `Berikut adalah informasi status konfigurasi **Server Tag Auto Role** khusus untuk server **${escapeMarkdown(guild.name)}**.`,
            )
            .addFields({
                name: "⚙️ Detail Konfigurasi Server Ini",
                value: configLines.join("\n"),
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
