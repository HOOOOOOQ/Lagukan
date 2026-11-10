const { EmbedBuilder, MessageFlags, escapeMarkdown } = require("discord.js");
const {
    TAG_COLORS,
    FOOTER_TEXT,
    hasServerMembersIntent,
    validateLogChannel,
    getServerTagStatsSnapshot,
} = require("../../../functions/serverTagLogger.js");

function escapeInline(value) {
    return String(value ?? "").replace(/`/g, "ˋ");
}

module.exports = {
    name: "ceklogs",
    description: "Lihat konfigurasi dan status Server Tag Logger pada server ini",
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

        const guildId = interaction.guildId;
        const guild = interaction.guild || client.guilds.cache.get(guildId);
        const botAvatar = client.user?.displayAvatarURL?.({ size: 128 }) || undefined;
        const snapshot = await getServerTagStatsSnapshot(client, guild);
        const realTimeIntent = hasServerMembersIntent(client);

        let channelDisplay = "`Belum diatur` *(gunakan `/setlogs` untuk mengaktifkan)*";
        let permissionHealth = "⚪ Menunggu pemilihan channel";
        let embedColor = snapshot.enabled ? TAG_COLORS.INFO : TAG_COLORS.REMOVED;

        if (snapshot.logChannelId) {
            const targetChannel =
                guild.channels?.cache?.get?.(snapshot.logChannelId) ||
                (typeof guild.channels?.fetch === "function" ? await guild.channels.fetch(snapshot.logChannelId).catch(() => null) : null);

            if (!targetChannel) {
                channelDisplay = `⚠️ Channel tidak ditemukan (\`${snapshot.logChannelId}\`) — kemungkinan sudah dihapus`;
                permissionHealth = "❌ Channel tidak tersedia, silakan atur ulang melalui `/setlogs`";
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

        const detectedTagLabel = snapshot.detectedServerTag
            ? `\`[${escapeInline(snapshot.detectedServerTag)}]\``
            : snapshot.hasGuildTagsFeature
              ? "`Fitur aktif (menunggu member memakai tag server ini)`"
              : "`Belum terdeteksi pada server ini`";

        const updatedAtUnix = snapshot.updatedAt ? Math.floor(new Date(snapshot.updatedAt).getTime() / 1000) : null;
        const updatedInfo = updatedAtUnix
            ? `<t:${updatedAtUnix}:R>${snapshot.updatedBy ? ` oleh <@${snapshot.updatedBy}>` : ""}`
            : "`Belum pernah diatur`";

        const configLines = [
            `• **Server:** **${escapeMarkdown(guild.name)}** (\`${guildId}\`)`,
            `• **Server Tag Terdeteksi:** ${detectedTagLabel}`,
            `• **Status Fitur:** ${snapshot.enabled ? "🟢 Aktif" : "🔴 Nonaktif"}`,
            `• **Channel Log:** ${channelDisplay}`,
            `• **Status Izin Bot:** ${permissionHealth}`,
            `• **Mode Deteksi:** ${
                realTimeIntent
                    ? "⚡ Real-Time (`Server Members Intent` aktif)"
                    : "ℹ️ Mode Kompatibilitas (aktifkan `SERVER MEMBERS INTENT` untuk deteksi real-time)"
            }`,
            `• **Pembaruan Terakhir:** ${updatedInfo}`,
        ];

        const statsLines = [
            `• **Dipasang:** \`${snapshot.statistics.installed}\` kali`,
            `• **Diganti:** \`${snapshot.statistics.changed}\` kali`,
            `• **Dihapus:** \`${snapshot.statistics.removed}\` kali`,
            `• **Member Aktif Pemakai Tag Server Ini:** \`${snapshot.activeOwnTagMembers}\` member`,
        ];

        const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setAuthor({
                name: `${guild.name} • Status Server Tag Logger`,
                iconURL: guild.iconURL?.({ size: 128 }) || botAvatar,
            })
            .setTitle("🔎 Konfigurasi Server Tag Logger")
            .setDescription(
                snapshot.enabled
                    ? `Pemantau **Server Tag** aktif khusus untuk server **${escapeMarkdown(guild.name)}**.`
                    : `Pemantau **Server Tag** pada server **${escapeMarkdown(guild.name)}** saat ini belum diaktifkan. Gunakan \`/setlogs\` untuk mengatur channel log.`,
            )
            .addFields(
                {
                    name: "⚙️ Pengaturan Server Saat Ini",
                    value: configLines.join("\n"),
                    inline: false,
                },
                {
                    name: "📊 Statistik Server Ini",
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
