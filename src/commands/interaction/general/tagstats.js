const { ApplicationCommandOptionType, EmbedBuilder, escapeMarkdown } = require("discord.js");
const { TAG_COLORS, FOOTER_TEXT, getServerTagStatsSnapshot } = require("../../../functions/serverTagLogger.js");

function formatActionBadge(action) {
    switch (action) {
        case "installed":
            return "🏷️ Memasang";
        case "reinstalled":
            return "✨ Memasang Kembali";
        case "changed":
            return "🔄 Mengganti";
        case "removed":
            return "🔓 Melepas";
        default:
            return "📌 Aktivitas";
    }
}

function escapeInline(value) {
    return String(value ?? "").replace(/`/g, "ˋ");
}

module.exports = {
    name: "tagstats",
    description: "Tampilkan statistik aktivitas Server Tag di server ini",
    category: "general",
    locale: "id",
    options: [
        {
            name: "member",
            description: "Lihat detail status dan riwayat Server Tag milik member tertentu (opsional)",
            type: ApplicationCommandOptionType.User,
            required: false,
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
        await interaction.deferReply();

        const guild = interaction.guild;
        const targetUser = interaction.options.getUser("member");
        const botAvatar = client.user?.displayAvatarURL?.({ size: 128 }) || undefined;
        const guildIcon = guild.iconURL?.({ size: 128 }) || botAvatar;

        const snapshot = await getServerTagStatsSnapshot(client, guild, targetUser);

        if (targetUser && snapshot.memberDetail) {
            const { liveTag, record } = snapshot.memberDetail;
            const installs = Number(record?.installCount) || 0;
            const changes = Number(record?.changeCount) || 0;
            const removes = Number(record?.removeCount) || 0;
            const memberHistory = Array.isArray(record?.history) ? record.history.slice(0, 5) : [];

            const activeTagLines = liveTag
                ? [
                      `• **Status Saat Ini:** 🟢 Aktif (\`${escapeInline(liveTag.tag)}\`)`,
                      `• **Asal Tag:** ${
                          liveTag.identityGuildId === guild.id
                              ? `Server Ini (**${escapeMarkdown(guild.name)}**)`
                              : liveTag.identityGuildId
                                ? `Server ID \`${liveTag.identityGuildId}\``
                                : "`Profil Discord`"
                      }`,
                  ]
                : ["• **Status Saat Ini:** ⚪ Tidak sedang memasang Server Tag"];

            const counterLines = [
                `• **Total Pemasangan:** \`${installs}\` kali`,
                `• **Total Penggantian:** \`${changes}\` kali`,
                `• **Total Pelepasan:** \`${removes}\` kali`,
            ];

            const recentMemberLines =
                memberHistory.length > 0
                    ? memberHistory.map((item) => {
                          const unix = item.timestamp ? Math.floor(new Date(item.timestamp).getTime() / 1000) : null;
                          const tagDesc =
                              item.action === "changed"
                                  ? `\`${escapeInline(item.previousTag || "-")}\` ➜ \`${escapeInline(item.newTag || "-")}\``
                                  : `\`${escapeInline(item.newTag || item.previousTag || "-")}\``;
                          return `• ${formatActionBadge(item.action)} ${tagDesc}${unix ? ` • <t:${unix}:R>` : ""}`;
                      })
                    : ["*Belum ada riwayat perubahan Server Tag yang tercatat untuk member ini.*"];

            const memberEmbed = new EmbedBuilder()
                .setColor(TAG_COLORS.INFO)
                .setAuthor({
                    name: `${guild.name} • Statistik Server Tag Member`,
                    iconURL: liveTag?.badgeUrl || guildIcon,
                })
                .setTitle(`📊 Statistik Server Tag — @${targetUser.username}`)
                .setThumbnail(targetUser.displayAvatarURL?.({ size: 256 }) || botAvatar)
                .setDescription(` Ringkasan status dan riwayat aktivitas **Server Tag** untuk <@${targetUser.id}> di server ini.`)
                .addFields(
                    {
                        name: "🏷️ Status Tag Profil",
                        value: activeTagLines.join("\n"),
                        inline: false,
                    },
                    {
                        name: "📈 Akumulasi Aktivitas Member",
                        value: counterLines.join("\n"),
                        inline: false,
                    },
                    {
                        name: "🕒 Riwayat Terakhir",
                        value: recentMemberLines.join("\n"),
                        inline: false,
                    },
                )
                .setFooter({ text: FOOTER_TEXT, iconURL: botAvatar })
                .setTimestamp();

            return interaction.editReply({ embeds: [memberEmbed] });
        }

        const totalEvents = snapshot.stats.totalInstalled + snapshot.stats.totalChanged + snapshot.stats.totalRemoved;

        const overviewLines = [
            `• **Status Logger:** ${
                snapshot.enabled && snapshot.channelId
                    ? `🟢 Aktif di <#${snapshot.channelId}>`
                    : "🔴 Belum Diaktifkan *(atur dengan `/setlogs`)*"
            }`,
            `• **Member Bertag Aktif:** \`${snapshot.activeSummary.totalActive}\` member terpantau (\`${snapshot.activeSummary.sameServerActive}\` tag server ini • \`${snapshot.activeSummary.externalServerActive}\` tag lain)`,
        ];

        const counterLines = [
            `• **Total Pemasangan Tag:** \`${snapshot.stats.totalInstalled}\` kali${
                snapshot.stats.totalReinstalled > 0 ? ` *(termasuk \`${snapshot.stats.totalReinstalled}\` pemasangan kembali)*` : ""
            }`,
            `• **Total Penggantian Tag:** \`${snapshot.stats.totalChanged}\` kali`,
            `• **Total Penghapusan Tag:** \`${snapshot.stats.totalRemoved}\` kali`,
            `• **Total Aktivitas Tercatat:** \`${totalEvents}\` aktivitas`,
        ];

        const recentItems = snapshot.recentHistory.slice(0, 5);
        const recentLines =
            recentItems.length > 0
                ? recentItems.map((entry) => {
                      const unix = entry.timestamp ? Math.floor(new Date(entry.timestamp).getTime() / 1000) : null;
                      const tagText =
                          entry.action === "changed"
                              ? `\`${escapeInline(entry.previousTag || "-")}\` ➜ \`${escapeInline(entry.newTag || "-")}\``
                              : `\`${escapeInline(entry.newTag || entry.previousTag || "-")}\``;
                      return `• <@${entry.userId}> — ${formatActionBadge(entry.action)} ${tagText}${unix ? ` (<t:${unix}:R>)` : ""}`;
                  })
                : ["*Belum ada aktivitas perubahan Server Tag yang tercatat di server ini.*"];

        const serverEmbed = new EmbedBuilder()
            .setColor(TAG_COLORS.INFO)
            .setAuthor({
                name: `${guild.name} • Statistik Server Tag`,
                iconURL: guildIcon,
            })
            .setTitle("📊 Statistik Aktivitas Server Tag")
            .setThumbnail(guildIcon)
            .setDescription(
                `Ringkasan data pemantauan **Server Tag** untuk komunitas **${escapeMarkdown(guild.name)}** berdasarkan pencatatan database Lagukan.`,
            )
            .addFields(
                {
                    name: "⚙️ Status & Cakupan Saat Ini",
                    value: overviewLines.join("\n"),
                    inline: false,
                },
                {
                    name: "📈 Akumulasi Aktivitas Server",
                    value: counterLines.join("\n"),
                    inline: false,
                },
                {
                    name: "🕒 5 Aktivitas Terbaru",
                    value: recentLines.join("\n"),
                    inline: false,
                },
            )
            .setFooter({ text: FOOTER_TEXT, iconURL: botAvatar })
            .setTimestamp();

        return interaction.editReply({ embeds: [serverEmbed] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
