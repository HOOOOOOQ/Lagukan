const { ApplicationCommandOptionType, EmbedBuilder, escapeMarkdown } = require("discord.js");
const { TAG_COLORS, FOOTER_TEXT, getServerTagStatsSnapshot } = require("../../../functions/serverTagLogger.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

function formatActionBadge(action) {
    switch (action) {
        case "installed":
            return "🏷️ Memasang";
        case "changed":
            return "🔄 Mengganti";
        case "removed":
            return "🗑️ Menghapus";
        default:
            return "📌 Aktivitas";
    }
}

function escapeInline(value) {
    return String(value ?? "").replace(/`/g, "ˋ");
}

module.exports = {
    name: "tagstats",
    description: "Lihat statistik Server Tag untuk server ini",
    category: "general",
    locale: "id",
    options: [
        {
            name: "member",
            description: "Lihat detail riwayat Server Tag milik member tertentu di server ini (opsional)",
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
        const deferred = await safeDeferReply(interaction);
        if (!deferred) return;

        const guildId = interaction.guildId;
        const guild = interaction.guild || client.guilds.cache.get(guildId);
        const targetUser = interaction.options.getUser("member");
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

        const guildIcon = guild.iconURL?.({ size: 128 }) || botAvatar;

        let snapshot;
        try {
            snapshot = await getServerTagStatsSnapshot(client, guild, targetUser);
        } catch (dbError) {
            const detail = escapeInline(dbError?.message || "Gagal mengambil statistik dari database MongoDB.");
            const errEmbed = new EmbedBuilder()
                .setColor(TAG_COLORS.ERROR)
                .setTitle("❌ Gagal Memuat Statistik Server Tag")
                .setDescription(`Terjadi kendala saat membaca data statistik dari database MongoDB.\n\n• **Detail:** \`${detail}\``)
                .setFooter({ text: FOOTER_TEXT, iconURL: botAvatar })
                .setTimestamp();

            return safeEditReply(interaction, { embeds: [errEmbed] });
        }

        if (targetUser && snapshot.memberDetail) {
            const { liveTag, wearsThisGuildTag, record } = snapshot.memberDetail;
            const installs = Number(record?.installCount) || 0;
            const changes = Number(record?.changeCount) || 0;
            const removes = Number(record?.removeCount) || 0;
            const memberHistory = Array.isArray(record?.history) ? record.history.slice(0, 5) : [];

            const activeTagLines = wearsThisGuildTag
                ? [
                      `• **Status Tag Server Ini:** 🟢 Aktif memakai \`[${escapeInline(liveTag.tag)}]\``,
                      `• **Server:** **${escapeMarkdown(guild.name)}** (\`${guildId}\`)`,
                  ]
                : liveTag
                  ? [
                        `• **Status Tag Server Ini:** ⚪ Tidak memakai tag server ini *(sedang memakai \`[${escapeInline(liveTag.tag)}]\`)*`,
                        `• **Server:** **${escapeMarkdown(guild.name)}** (\`${guildId}\`)`,
                    ]
                  : [
                        `• **Status Tag Server Ini:** ⚪ Tidak sedang memasang Server Tag`,
                        `• **Server:** **${escapeMarkdown(guild.name)}** (\`${guildId}\`)`,
                    ];

            const counterLines = [
                `• **Dipasang:** \`${installs}\` kali`,
                `• **Diganti:** \`${changes}\` kali`,
                `• **Dihapus:** \`${removes}\` kali`,
            ];

            const recentMemberLines =
                memberHistory.length > 0
                    ? memberHistory.map((item) => {
                          const unix = item.timestamp ? Math.floor(new Date(item.timestamp).getTime() / 1000) : null;
                          const tagDesc =
                              item.action === "changed"
                                  ? `\`[${escapeInline(item.previousTag || "-")}]\` ➜ \`[${escapeInline(item.newTag || "-")}]\``
                                  : `\`[${escapeInline(item.newTag || item.previousTag || "-")}]\``;
                          return `• ${formatActionBadge(item.action)} ${tagDesc}${unix ? ` • <t:${unix}:R>` : ""}`;
                      })
                    : ["*Belum ada riwayat aktivitas Server Tag pada server ini untuk member tersebut.*"];

            const memberEmbed = new EmbedBuilder()
                .setColor(TAG_COLORS.INFO)
                .setAuthor({
                    name: `${guild.name} • Statistik Server Tag Member`,
                    iconURL: (wearsThisGuildTag ? liveTag?.badgeUrl : null) || guildIcon,
                })
                .setTitle(`📊 Statistik Server Tag — @${targetUser.username}`)
                .setThumbnail(targetUser.displayAvatarURL?.({ size: 256 }) || botAvatar)
                .setDescription(
                    `Ringkasan status dan riwayat **Server Tag** untuk <@${targetUser.id}> pada server **${escapeMarkdown(guild.name)}**.`,
                )
                .addFields(
                    {
                        name: "🏷️ Status Tag Saat Ini",
                        value: activeTagLines.join("\n"),
                        inline: false,
                    },
                    {
                        name: "📈 Statistik Member di Server Ini",
                        value: counterLines.join("\n"),
                        inline: false,
                    },
                    {
                        name: "🕒 Riwayat Terakhir di Server Ini",
                        value: recentMemberLines.join("\n"),
                        inline: false,
                    },
                )
                .setFooter({ text: FOOTER_TEXT, iconURL: botAvatar })
                .setTimestamp();

            return safeEditReply(interaction, { embeds: [memberEmbed] });
        }

        const totalEvents = snapshot.statistics.installed + snapshot.statistics.changed + snapshot.statistics.removed;
        const serverTagDisplay = snapshot.detectedServerTag
            ? `\`[${escapeInline(snapshot.detectedServerTag)}]\``
            : "`Belum terdeteksi (otomatis muncul saat ada member memakai tag server ini)`";

        const overviewLines = [
            `• **Server:** **${escapeMarkdown(guild.name)}** (\`${guildId}\`)`,
            `• **Server Tag:** ${serverTagDisplay}`,
            `• **Status Logger:** ${
                snapshot.enabled && snapshot.logChannelId
                    ? `🟢 Aktif di <#${snapshot.logChannelId}>`
                    : "🔴 Belum Diaktifkan *(atur dengan `/setlogs`)*"
            }`,
            `• **Member Aktif Pemakai Tag Server Ini:** \`${snapshot.activeOwnTagMembers}\` member`,
        ];

        const counterLines = [
            `• **Total Dipasang:** \`${snapshot.statistics.installed}\` kali`,
            `• **Total Diganti:** \`${snapshot.statistics.changed}\` kali`,
            `• **Total Dihapus:** \`${snapshot.statistics.removed}\` kali`,
            `• **Total Seluruh Aktivitas:** \`${totalEvents}\` aktivitas`,
        ];

        const recentItems = snapshot.recentHistory.slice(0, 5);
        const recentLines =
            recentItems.length > 0
                ? recentItems.map((entry) => {
                      const unix = entry.timestamp ? Math.floor(new Date(entry.timestamp).getTime() / 1000) : null;
                      const tagText =
                          entry.action === "changed"
                              ? `\`[${escapeInline(entry.previousTag || "-")}]\` ➜ \`[${escapeInline(entry.newTag || "-")}]\``
                              : `\`[${escapeInline(entry.newTag || entry.previousTag || "-")}]\``;
                      return `• <@${entry.userId}> — ${formatActionBadge(entry.action)} ${tagText}${unix ? ` (<t:${unix}:R>)` : ""}`;
                  })
                : ["*Belum ada aktivitas perubahan Server Tag yang tercatat pada server ini.*"];

        const serverEmbed = new EmbedBuilder()
            .setColor(TAG_COLORS.INFO)
            .setAuthor({
                name: `${guild.name} • Statistik Server Tag`,
                iconURL: guildIcon,
            })
            .setTitle("📊 Statistik Server Tag")
            .setThumbnail(guildIcon)
            .setDescription(`Data statistik aktivitas **Server Tag** khusus untuk server **${escapeMarkdown(guild.name)}**.`)
            .addFields(
                {
                    name: "⚙️ Informasi Server",
                    value: overviewLines.join("\n"),
                    inline: false,
                },
                {
                    name: "📈 Akumulasi Aktivitas",
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

        return safeEditReply(interaction, { embeds: [serverEmbed] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
