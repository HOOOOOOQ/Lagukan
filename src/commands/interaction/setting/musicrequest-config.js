const { ApplicationCommandOptionType, ChannelType, EmbedBuilder, MessageFlags } = require("discord.js");
const {
    getGuildRequestConfig,
    saveGuildRequestConfig,
    buildRequestPanelPayload,
    refreshRequestPanelMessage,
} = require("../../../functions/voiceRequestSystem.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "musicrequest-config",
    description: "Atur channel khusus Voice Channel Music Request Panel (request lagu tanpa mengetik /play)",
    category: "setting",
    options: [
        {
            name: "setup",
            description: "Aktifkan channel khusus request musik dan kirim panel interaktif",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "channel",
                    description: "Channel teks tempat panel Request Musik dikirim",
                    type: ApplicationCommandOptionType.Channel,
                    channel_types: [ChannelType.GuildText],
                    required: true,
                },
                {
                    name: "cooldown",
                    description: "Cooldown request per user dalam detik (Default: 10)",
                    type: ApplicationCommandOptionType.Integer,
                    min_value: 2,
                    max_value: 120,
                    required: false,
                },
                {
                    name: "max_queue",
                    description: "Batas maksimal antrean aktif per user reguler (Default: 5)",
                    type: ApplicationCommandOptionType.Integer,
                    min_value: 1,
                    max_value: 50,
                    required: false,
                },
                {
                    name: "links_only",
                    description: "Hanya izinkan link musik resmi (tolak teks judul biasa)?",
                    type: ApplicationCommandOptionType.Boolean,
                    required: false,
                },
            ],
        },
        {
            name: "settings",
            description: "Perbarui batas cooldown, maks antrean per user, atau filter link",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "cooldown",
                    description: "Cooldown request per user (2 - 120 detik)",
                    type: ApplicationCommandOptionType.Integer,
                    min_value: 2,
                    max_value: 120,
                    required: false,
                },
                {
                    name: "max_queue",
                    description: "Maksimal lagu aktif di antrean per user (1 - 50)",
                    type: ApplicationCommandOptionType.Integer,
                    min_value: 1,
                    max_value: 50,
                    required: false,
                },
                {
                    name: "links_only",
                    description: "Hanya terima link musik?",
                    type: ApplicationCommandOptionType.Boolean,
                    required: false,
                },
                {
                    name: "auto_delete",
                    description: "Hapus otomatis pesan teks user di channel request agar tetap bersih?",
                    type: ApplicationCommandOptionType.Boolean,
                    required: false,
                },
            ],
        },
        {
            name: "refresh",
            description: "Segarkan atau kirim ulang panel Request Musik di channel yang sudah diatur",
            type: ApplicationCommandOptionType.Subcommand,
        },
        {
            name: "disable",
            description: "Nonaktifkan sistem Voice Channel Music Request di server ini",
            type: ApplicationCommandOptionType.Subcommand,
        },
    ],
    permissions: {
        bot: [],
        user: ["ManageGuild"],
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

        const sub = interaction.options.getSubcommand();
        const color = client.config?.embedColor || "#5865F2";

        if (sub === "setup") {
            const channel = interaction.options.getChannel("channel", true);
            const cooldownSec = interaction.options.getInteger("cooldown") ?? 10;
            const maxQueuePerUser = interaction.options.getInteger("max_queue") ?? 5;
            const linksOnly = interaction.options.getBoolean("links_only") ?? false;

            const draftCfg = {
                enabled: true,
                channelId: channel.id,
                cooldownSec,
                maxQueuePerUser,
                linksOnly,
                autoDeleteUserMessage: true,
            };

            const panelPayload = buildRequestPanelPayload(client, interaction.guild, draftCfg);
            const sentPanel = await channel.send(panelPayload).catch(() => null);
            if (!sentPanel) {
                return safeEditReply(interaction, {
                    embeds: [
                        new EmbedBuilder()
                            .setColor(color)
                            .setDescription(
                                `❌ Bot gagal mengirim panel ke ${channel}. Pastikan bot memiliki izin \`ViewChannel\`, \`SendMessages\`, dan \`EmbedLinks\`.`,
                            ),
                    ],
                });
            }

            await saveGuildRequestConfig(client, interaction.guildId, {
                ...draftCfg,
                messageId: sentPanel.id,
            });

            return safeEditReply(interaction, {
                embeds: [
                    new EmbedBuilder()
                        .setColor(color)
                        .setTitle("✅ Voice Channel Music Request Aktif")
                        .setDescription(
                            `Panel request musik berhasil dipasang di ${channel}!\n` +
                                `Anggota di voice channel kini bisa mengirim judul/link langsung di ${channel} atau memakai tombol panel tanpa mengetik \`/play\`.`,
                        ),
                ],
            });
        }

        const existing = await getGuildRequestConfig(client, interaction.guildId);

        if (sub === "settings") {
            if (!existing?.channelId) {
                return safeEditReply(interaction, {
                    embeds: [new EmbedBuilder().setColor(color).setDescription("Jalankan `/musicrequest-config setup` terlebih dahulu.")],
                });
            }

            const patch = {};
            const cd = interaction.options.getInteger("cooldown");
            const mq = interaction.options.getInteger("max_queue");
            const lo = interaction.options.getBoolean("links_only");
            const ad = interaction.options.getBoolean("auto_delete");
            if (cd !== null) patch.cooldownSec = cd;
            if (mq !== null) patch.maxQueuePerUser = mq;
            if (lo !== null) patch.linksOnly = lo;
            if (ad !== null) patch.autoDeleteUserMessage = ad;

            await saveGuildRequestConfig(client, interaction.guildId, patch);
            await refreshRequestPanelMessage(client, interaction.guildId);

            return safeEditReply(interaction, {
                embeds: [
                    new EmbedBuilder().setColor(color).setDescription("✅ Pengaturan proteksi & batas Music Request berhasil diperbarui."),
                ],
            });
        }

        if (sub === "refresh") {
            if (!existing?.channelId) {
                return safeEditReply(interaction, {
                    embeds: [new EmbedBuilder().setColor(color).setDescription("Belum ada channel Request Musik yang dikonfigurasi.")],
                });
            }
            const refreshed = await refreshRequestPanelMessage(client, interaction.guildId);
            if (!refreshed) {
                const ch = interaction.guild.channels?.cache?.get?.(existing.channelId);
                if (ch?.send) {
                    const resent = await ch.send(buildRequestPanelPayload(client, interaction.guild, existing)).catch(() => null);
                    if (resent) {
                        await saveGuildRequestConfig(client, interaction.guildId, { enabled: true, messageId: resent.id });
                        return safeEditReply(interaction, {
                            embeds: [
                                new EmbedBuilder()
                                    .setColor(color)
                                    .setDescription(`✅ Panel baru berhasil dikirim ulang ke <#${existing.channelId}>.`),
                            ],
                        });
                    }
                }
            }
            return safeEditReply(interaction, {
                embeds: [new EmbedBuilder().setColor(color).setDescription("✅ Panel Request Musik berhasil disegarkan.")],
            });
        }

        if (sub === "disable") {
            await saveGuildRequestConfig(client, interaction.guildId, { enabled: false });
            return safeEditReply(interaction, {
                embeds: [new EmbedBuilder().setColor(color).setDescription("⏹️ Sistem Voice Channel Music Request telah dinonaktifkan.")],
            });
        }
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
