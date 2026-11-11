const { ApplicationCommandOptionType, EmbedBuilder, MessageFlags } = require("discord.js");
const { setGuildSleepTimer, getGuildSleepTimer, cancelGuildSleepTimer } = require("../../../functions/radioAndSleepManager.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "sleep",
    description: "Atur Sleep Timer otomatis untuk menghentikan pemutaran musik sesuai durasi pilihan",
    category: "music",
    options: [
        {
            name: "preset",
            description: "Pilih durasi Sleep Timer atau batalkan timer aktif",
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
                { name: "15 Menit", value: "15" },
                { name: "30 Menit", value: "30" },
                { name: "45 Menit", value: "45" },
                { name: "60 Menit", value: "60" },
                { name: "Custom Durasi (Isi custom_minutes)", value: "custom" },
                { name: "Lihat Status Sleep Timer", value: "status" },
                { name: "Batalkan / Matikan Sleep Timer", value: "cancel" },
            ],
        },
        {
            name: "custom_minutes",
            description: "Durasi menit khusus (1 - 720 menit) jika memilih Custom Durasi",
            type: ApplicationCommandOptionType.Integer,
            required: false,
            min_value: 1,
            max_value: 720,
        },
        {
            name: "leave_voice",
            description: "Keluar dari voice channel saat timer selesai? (Default: sesuai pengaturan server)",
            type: ApplicationCommandOptionType.Boolean,
            required: false,
        },
        {
            name: "clear_queue",
            description: "Bersihkan antrean lagu saat timer selesai? (Default: Ya)",
            type: ApplicationCommandOptionType.Boolean,
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
        dj: true,
    },
    devOnly: false,
    run: async (client, interaction, player) => {
        const preset = interaction.options.getString("preset", true);
        const color = client.config?.embedColor || "#5865F2";

        if (preset === "status") {
            const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) return;
            const active = getGuildSleepTimer(interaction.guildId);
            if (!active) {
                return safeEditReply(interaction, {
                    embeds: [
                        new EmbedBuilder().setColor(color).setDescription("💤 Tidak ada Sleep Timer yang sedang aktif di server ini."),
                    ],
                });
            }
            return safeEditReply(interaction, {
                embeds: [
                    new EmbedBuilder()
                        .setColor(color)
                        .setTitle("⏰ Status Sleep Timer Aktif")
                        .setDescription(
                            `• Berakhir: <t:${Math.floor(active.endsAt / 1000)}:R> (\`${Math.ceil(active.remainingMs / 60000)} menit lagi\`)\n` +
                                `• Bersihkan Antrean: \`${active.clearQueue ? "Ya" : "Tidak"}\`\n` +
                                `• Keluar Voice Channel: \`${active.leaveVoice === null ? "Ikuti Pengaturan Server" : active.leaveVoice ? "Ya" : "Tidak"}\`\n` +
                                `• Diatur oleh: <@${active.requestedBy}>`,
                        ),
                ],
            });
        }

        const deferred = await safeDeferReply(interaction);
        if (!deferred) return;

        if (preset === "cancel") {
            const cancelled = cancelGuildSleepTimer(interaction.guildId);
            return safeEditReply(interaction, {
                embeds: [
                    new EmbedBuilder()
                        .setColor(color)
                        .setDescription(
                            cancelled
                                ? "✅ **Sleep Timer dibatalkan.** Musik akan terus berjalan normal."
                                : "Tidak ada Sleep Timer aktif untuk dibatalkan.",
                        ),
                ],
            });
        }

        if (!player) {
            return safeEditReply(interaction, {
                embeds: [new EmbedBuilder().setColor(color).setDescription("Tidak ada player musik yang sedang aktif di server ini.")],
            });
        }

        if (player.voiceId && interaction.member?.voice?.channelId !== player.voiceId) {
            return safeEditReply(interaction, {
                embeds: [
                    new EmbedBuilder()
                        .setColor(color)
                        .setDescription(
                            `Kamu harus berada di voice channel yang sama dengan bot (<#${player.voiceId}>) untuk mengatur Sleep Timer.`,
                        ),
                ],
            });
        }

        const minutes = preset === "custom" ? Number(interaction.options.getInteger("custom_minutes") || 0) : Number.parseInt(preset, 10);

        if (!Number.isFinite(minutes) || minutes < 1 || minutes > 720) {
            return safeEditReply(interaction, {
                embeds: [
                    new EmbedBuilder()
                        .setColor(color)
                        .setDescription("Masukkan `custom_minutes` antara **1** hingga **720** menit saat memilih mode Custom Durasi."),
                ],
            });
        }

        const leaveOpt = interaction.options.getBoolean("leave_voice");
        const clearOpt = interaction.options.getBoolean("clear_queue");

        const timerInfo = setGuildSleepTimer(client, {
            guildId: interaction.guildId,
            durationMinutes: minutes,
            requestedBy: interaction.user.id,
            textChannelId: interaction.channelId,
            clearQueue: clearOpt !== null ? clearOpt : true,
            leaveVoice: Boolean(leaveOpt),
        });

        return safeEditReply(interaction, {
            embeds: [
                new EmbedBuilder()
                    .setColor(color)
                    .setTitle("⏰ Sleep Timer Diaktifkan")
                    .setDescription(
                        `Musik akan berhenti otomatis <t:${Math.floor(timerInfo.endsAt / 1000)}:R> (**\`${minutes} menit\`**).\n` +
                            `*(Jika sebelumnya sudah ada timer, timer lama otomatis digantikan agar tidak terjadi timer ganda)*\n\n` +
                            `• Bersihkan Antrean: \`${timerInfo.clearQueue ? "Ya" : "Tidak"}\`\n` +
                            `• Keluar Voice: \`${leaveOpt === null ? "Ikuti Pengaturan Server" : leaveOpt ? "Ya" : "Tidak"}\``,
                    ),
            ],
        });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
