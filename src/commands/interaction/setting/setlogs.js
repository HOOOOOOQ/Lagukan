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
        if (!hasAdminPermission(interaction.member)) {
            const deniedEmbed = buildAdminDeniedEmbed(client, "setlogs");
            return interaction.reply({ embeds: [deniedEmbed], flags: [MessageFlags.Ephemeral] });
        }

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const guildId = interaction.guildId;
        const guild = interaction.guild || client.guilds.cache.get(guildId);
        const targetChannel = interaction.options.getChannel("channel");
        const botAvatar = client.user?.displayAvatarURL?.({ size: 128 }) || undefined;

        const validation = validateLogChannel(guild, targetChannel);
        if (!validation.valid) {
            const errorEmbed = new EmbedBuilder()
                .setColor(TAG_COLORS.ERROR)
                .setTitle("⚠️ Gagal Mengatur Channel Log")
                .setDescription(validation.message)
                .setFooter({ text: FOOTER_TEXT, iconURL: botAvatar })
                .setTimestamp();

            return interaction.editReply({ embeds: [errorEmbed] });
        }

        const { syncedCount, detectedTag } = await setServerTagLogChannel(client, guild, targetChannel.id, interaction.user.id);
        const realTimeIntent = hasServerMembersIntent(client);
        const tagInfo = detectedTag
            ? `\`[${escapeInline(detectedTag)}]\` *(terdeteksi otomatis)*`
            : "`Otomatis (terdeteksi saat member memakai tag server ini)`";

        const detailLines = [
            `• **Server:** **${escapeMarkdown(guild.name)}** (\`${guildId}\`)`,
            `• **Server Tag:** ${tagInfo}`,
            `• **Status Fitur:** 🟢 Aktif`,
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
                `Konfigurasi log **Server Tag** khusus untuk server **${escapeMarkdown(guild.name)}** berhasil disimpan. Seluruh aktivitas pemasangan, penggantian, dan penghapusan tag server ini akan dikirim ke <#${targetChannel.id}>.`,
            )
            .addFields({
                name: "⚙️ Konfigurasi Server Ini",
                value: detailLines.join("\n"),
                inline: false,
            })
            .setFooter({ text: FOOTER_TEXT, iconURL: botAvatar })
            .setTimestamp();

        return interaction.editReply({ embeds: [successEmbed] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
