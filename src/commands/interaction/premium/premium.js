const { ApplicationCommandOptionType, EmbedBuilder, MessageFlags, PermissionsBitField } = require("discord.js");
const { getPremiumAccess, grantPremium, revokePremium, customizeGuildPremiumDashboard } = require("../../../functions/premiumSystem.js");
const { getGuildPlayer } = require("../../../functions/voiceSessionManager.js");
const { refreshNowPlayingDashboard } = require("../../../functions/nowPlayingManager.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

function isBotAdminOrDev(client, userId) {
    const uid = String(userId || "");
    if (!uid) return false;
    if (String(client.config?.owner || "") === uid) return true;
    return Array.isArray(client.config?.dev) && client.config.dev.map(String).includes(uid);
}

module.exports = {
    name: "premium",
    description: "Cek status fitur Premium Lagukan, kustomisasi tampilan server, atau kelola verifikasi (Admin Bot)",
    category: "premium",
    options: [
        {
            name: "status",
            description: "Lihat status akses Premium akunmu dan server saat ini beserta batas kuotanya",
            type: ApplicationCommandOptionType.Subcommand,
        },
        {
            name: "customize",
            description: "Kustomisasi warna aksen & judul Now Playing Dashboard (Khusus Server berstatus Premium)",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "accent_color",
                    description: "Kode warna HEX untuk Now Playing Dashboard (contoh: #00E5FF)",
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
                {
                    name: "dashboard_title",
                    description: "Judul kustom header dashboard musik (maks 40 karakter)",
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
            ],
        },
        {
            name: "grant",
            description: "[Owner/Dev Bot] Berikan akses Premium terverifikasi kepada User atau Server",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "target_type",
                    description: "Tipe penerima akses Premium",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: [
                        { name: "User (Personal)", value: "user" },
                        { name: "Guild (Server Ini / ID Server)", value: "guild" },
                    ],
                },
                {
                    name: "tier",
                    description: "Tingkatan paket Premium",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: [
                        { name: "Plus", value: "plus" },
                        { name: "VIP", value: "vip" },
                        { name: "Ultimate", value: "ultimate" },
                    ],
                },
                {
                    name: "user",
                    description: "Pilih user jika target_type = user",
                    type: ApplicationCommandOptionType.User,
                    required: false,
                },
                {
                    name: "guild_id",
                    description: "ID Server jika target_type = guild (kosongkan untuk server ini)",
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
                {
                    name: "days",
                    description: "Masa berlaku dalam hari (kosongkan untuk permanen)",
                    type: ApplicationCommandOptionType.Integer,
                    min_value: 1,
                    max_value: 3650,
                    required: false,
                },
                {
                    name: "note",
                    description: "Catatan verifikasi admin",
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
            ],
        },
        {
            name: "revoke",
            description: "[Owner/Dev Bot] Cabut akses Premium dari User atau Server",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "target_type",
                    description: "Tipe target yang dicabut",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: [
                        { name: "User", value: "user" },
                        { name: "Guild", value: "guild" },
                    ],
                },
                {
                    name: "user",
                    description: "User target (jika target_type = user)",
                    type: ApplicationCommandOptionType.User,
                    required: false,
                },
                {
                    name: "guild_id",
                    description: "ID Server target (kosongkan untuk server ini)",
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
            ],
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
        const sub = interaction.options.getSubcommand();
        const color = client.config?.embedColor || "#5865F2";
        const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        if (sub === "status") {
            const access = await getPremiumAccess(client, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
            });

            const expLine = access.expiresAt
                ? `<t:${Math.floor(new Date(access.expiresAt).getTime() / 1000)}:R>`
                : access.isPremium
                  ? "Permanen (Terverifikasi)"
                  : "-";

            const embed = new EmbedBuilder()
                .setColor(access.customAccentColor || color)
                .setTitle(`💎 Status Lagukan Premium — ${access.limits.label}`)
                .setDescription(
                    (access.isPremium
                        ? `✅ Akun atau server ini memiliki akses **Lagukan ${access.limits.label}** terverifikasi!\n\n`
                        : `ℹ️ Saat ini kamu menggunakan paket **Standard (Gratis)**. Akses Premium dikonfigurasi secara resmi & terverifikasi oleh Admin/Developer Bot (tanpa klaim otomatis palsu).\n\n`) +
                        `**Kuota & Fitur Aktif Kamu:**\n` +
                        `• Maks. Playlist Personal: \`${access.limits.maxPlaylists} playlist\`\n` +
                        `• Maks. Lagu per Playlist: \`${access.limits.maxTracksPerPlaylist} lagu\`\n` +
                        `• Maks. Lagu Favorit: \`${access.limits.maxFavorites} lagu\`\n` +
                        `• Kapasitas Request & Wrapped Top List: \`Top ${access.limits.wrappedTopTracksLimit} lagu\`\n` +
                        `• Kustomisasi Tampilan Dashboard Server: \`${access.guildPremium ? "Aktif" : "Belum Aktif"}\`\n` +
                        `• Masa Berlaku: ${expLine}`,
                )
                .setTimestamp();

            return safeEditReply(interaction, { embeds: [embed] });
        }

        if (sub === "customize") {
            if (
                !interaction.memberPermissions?.has?.(PermissionsBitField.Flags.ManageGuild) &&
                !isBotAdminOrDev(client, interaction.user.id)
            ) {
                return safeEditReply(interaction, {
                    embeds: [
                        new EmbedBuilder()
                            .setColor(color)
                            .setDescription("Kamu memerlukan izin `Manage Server` untuk mengubah tampilan dashboard server."),
                    ],
                });
            }

            const accentColor = interaction.options.getString("accent_color");
            const customTitle = interaction.options.getString("dashboard_title");

            const res = await customizeGuildPremiumDashboard(client, interaction.guildId, {
                accentColor,
                dashboardTitle: customTitle,
            });

            if (!res.ok) {
                return safeEditReply(interaction, {
                    embeds: [new EmbedBuilder().setColor(color).setDescription(`⚠️ ${res.error}`)],
                });
            }

            const player = getGuildPlayer(client, interaction.guildId);
            if (player) {
                await refreshNowPlayingDashboard(client, player).catch(() => {});
            }

            return safeEditReply(interaction, {
                embeds: [
                    new EmbedBuilder()
                        .setColor(res.doc.customAccentColor || color)
                        .setDescription("✅ Tema kustom Now Playing Dashboard server berhasil disimpan!"),
                ],
            });
        }

        if (!isBotAdminOrDev(client, interaction.user.id)) {
            return safeEditReply(interaction, {
                embeds: [
                    new EmbedBuilder()
                        .setColor(color)
                        .setDescription("🔒 Subcommand ini hanya dapat dijalankan oleh **Owner / Developer Bot** resmi."),
                ],
            });
        }

        const targetType = interaction.options.getString("target_type", true);
        const targetUser = interaction.options.getUser("user");
        const targetGuildId = interaction.options.getString("guild_id") || interaction.guildId;
        const targetId = targetType === "user" ? targetUser?.id : targetGuildId;

        if (!targetId) {
            return safeEditReply(interaction, {
                embeds: [new EmbedBuilder().setColor(color).setDescription("Pilih `user` yang valid ketika `target_type = user`.")],
            });
        }

        if (sub === "grant") {
            const tier = interaction.options.getString("tier", true);
            const days = interaction.options.getInteger("days") || 0;
            const note = interaction.options.getString("note") || "";

            const res = await grantPremium(client, {
                targetType,
                targetId,
                tier,
                durationDays: days,
                grantedBy: interaction.user.id,
                note,
            });

            return safeEditReply(interaction, {
                embeds: [
                    new EmbedBuilder()
                        .setColor(color)
                        .setTitle("✅ Akses Premium Diberikan")
                        .setDescription(
                            `• Target: \`${targetType}\` (\`${res.doc.targetId}\`)\n` +
                                `• Paket: \`${res.doc.tier.toUpperCase()}\`\n` +
                                `• Kedaluwarsa: ${res.doc.expiresAt ? `<t:${Math.floor(new Date(res.doc.expiresAt).getTime() / 1000)}:F>` : "`Permanen`"}`,
                        ),
                ],
            });
        }

        if (sub === "revoke") {
            await revokePremium(client, { targetType, targetId });
            return safeEditReply(interaction, {
                embeds: [
                    new EmbedBuilder()
                        .setColor(color)
                        .setDescription(`🛑 Akses Premium untuk \`${targetType}:${targetId}\` telah dicabut.`),
                ],
            });
        }
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
