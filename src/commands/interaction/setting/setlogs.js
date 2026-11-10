const { ApplicationCommandOptionType, ChannelType, EmbedBuilder, MessageFlags, escapeMarkdown } = require("discord.js");
const {
    TAG_COLORS,
    FOOTER_TEXT,
    hasAdminPermission,
    hasServerMembersIntent,
    buildAdminDeniedEmbed,
    validateLogChannel,
    setServerTagLogChannel,
} = require("../../../functions/serverTagLogger.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

function escapeInline(value) {
    return String(value ?? "").replace(/`/g, "ˋ");
}

module.exports = {
    name: "setlogs",
    description: "Atur channel log Server Tag untuk server ini",
    category: "setting",
    locale: "id",
    options: [
        {
            name: "channel",
            description: "Pilih channel teks tujuan pengiriman log Server Tag di server ini",
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
            const deniedEmbed = buildAdminDeniedEmbed(client, "setlogs");
            return safeEditReply(interaction, { embeds: [deniedEmbed] });
        }

        if (!guild.members?.me && typeof guild.members?.fetchMe === "function") {
            await guild.members.fetchMe().catch(() => null);
        }

        const rawChannel = interaction.options.getChannel("channel");
        const targetChannel =
            (rawChannel?.id && guild.channels?.cache?.get?.(rawChannel.id)) ||
            (rawChannel?.id && typeof guild.channels?.fetch === "function"
                ? await guild.channels.fetch(rawChannel.id).catch(() => null)
                : null) ||
            rawChannel;

        const validation = validateLogChannel(guild, targetChannel);
        if (!validation.valid) {
            const errorEmbed = new EmbedBuilder()
                .setColor(TAG_COLORS.ERROR)
                .setTitle("⚠️ Gagal Mengatur Channel Log")
                .setDescription(validation.message)
                .setFooter({ text: FOOTER_TEXT, iconURL: botAvatar })
                .setTimestamp();

            return safeEditReply(interaction, { embeds: [errorEmbed] });
        }

        let saveResult;
        try {
            saveResult = await setServerTagLogChannel(client, guild, targetChannel.id, interaction.user.id, {
                strictMongo: true,
            });
        } catch (dbError) {
            const detail = escapeInline(dbError?.message || "Terjadi gangguan koneksi ke database MongoDB.");
            const mongoErrorEmbed = new EmbedBuilder()
                .setColor(TAG_COLORS.ERROR)
                .setTitle("❌ Gagal Menyimpan Konfigurasi ke MongoDB")
                .setDescription(
                    [
                        "Pengaturan channel log **Server Tag** belum berhasil disimpan ke database **MongoDB**.",
                        "",
                        `• **Detail Kesalahan:** \`${detail}\``,
                        "• **Saran:** Pastikan variabel `MONGO_URI` aktif dan koneksi database stabil, lalu jalankan kembali `/setlogs`.",
                    ].join("\n"),
                )
                .setFooter({ text: FOOTER_TEXT, iconURL: botAvatar })
                .setTimestamp();

            return safeEditReply(interaction, { embeds: [mongoErrorEmbed] });
        }

        const { syncedCount, detectedTag } = saveResult;
        const realTimeIntent = hasServerMembersIntent(client);
        const tagInfo = detectedTag
            ? `\`[${escapeInline(detectedTag)}]\` *(terdeteksi otomatis)*`
            : "`Otomatis (terdeteksi saat member memakai tag server ini)`";

        const detailLines = [
            `• **Server:** **${escapeMarkdown(guild.name)}** (\`${guildId}\`)`,
            `• **Server Tag:** ${tagInfo}`,
            `• **Status Fitur:** 🟢 Aktif (Tersimpan di MongoDB)`,
            `• **Channel Log:** <#${targetChannel.id}> (\`${targetChannel.id}\`)`,
            `• **Diatur Oleh:** <@${interaction.user.id}>`,
            `• **Izin Bot:** ✅ \`ViewChannel\`, \`SendMessages\`, \`EmbedLinks\``,
            `• **Sinkronisasi Member:** \`${syncedCount}\` member dipetakan`,
            `• **Mode Deteksi:** ${
                realTimeIntent
                    ? "⚡ Real-Time (`Server Members Intent` aktif)"
                    : "⚠️ Mode Kompatibilitas — aktifkan **SERVER MEMBERS INTENT** di Discord Developer Portal untuk deteksi real-time"
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
                `Konfigurasi log **Server Tag** khusus untuk server **${escapeMarkdown(guild.name)}** berhasil disimpan ke MongoDB. Seluruh aktivitas pemasangan, penggantian, dan penghapusan tag server ini akan dikirim ke <#${targetChannel.id}>.`,
            )
            .addFields({
                name: "⚙️ Konfigurasi Server Ini",
                value: detailLines.join("\n"),
                inline: false,
            })
            .setFooter({ text: FOOTER_TEXT, iconURL: botAvatar })
            .setTimestamp();

        return safeEditReply(interaction, { embeds: [successEmbed] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
