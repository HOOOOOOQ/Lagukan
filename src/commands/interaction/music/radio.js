const { ApplicationCommandOptionType, EmbedBuilder, MessageFlags } = require("discord.js");
const {
    RADIO_STATIONS,
    getGuildRadioState,
    startGuildRadioMode,
    stopGuildRadioMode,
} = require("../../../functions/radioAndSleepManager.js");
const { getOrCreateGuildPlayer } = require("../../../functions/musicPermissions.js");
const { ensureNowPlayingDashboardVisible } = require("../../../functions/nowPlayingManager.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "radio",
    description: "Nyalakan Radio Mode (genre/kategori berkelanjutan) atau Auto DJ pintar tanpa lagu berulang",
    category: "music",
    options: [
        {
            name: "station",
            description: "Mulai stasiun Radio berdasarkan genre atau kategori pilihan",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "genre",
                    description: "Pilih stasiun genre Radio",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: Object.entries(RADIO_STATIONS).map(([key, st]) => ({
                        name: st.label,
                        value: key,
                    })),
                },
            ],
        },
        {
            name: "autodj",
            description: "Aktifkan Auto DJ (memilih lagu otomatis dari artis/genre lagu terakhir tanpa duplikat)",
            type: ApplicationCommandOptionType.Subcommand,
        },
        {
            name: "custom",
            description: "Mulai Radio Mode kustom berdasarkan artis, suasana, atau genre pilihanmu",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "query",
                    description: "Tema / artis / genre radio (contoh: Sheila On 7 & Dewa 19)",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
            ],
        },
        {
            name: "status",
            description: "Lihat status Radio Mode / Auto DJ di server ini",
            type: ApplicationCommandOptionType.Subcommand,
        },
        {
            name: "stop",
            description: "Matikan Radio Mode / Auto DJ berkelanjutan",
            type: ApplicationCommandOptionType.Subcommand,
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
    run: async (client, interaction) => {
        const sub = interaction.options.getSubcommand();
        const color = client.config?.embedColor || "#5865F2";

        if (sub === "status") {
            const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) return;
            const st = getGuildRadioState(interaction.guildId);
            if (!st?.enabled) {
                return safeEditReply(interaction, {
                    embeds: [new EmbedBuilder().setColor(color).setDescription("📻 **Radio Mode / Auto DJ** saat ini tidak aktif.")],
                });
            }
            return safeEditReply(interaction, {
                embeds: [
                    new EmbedBuilder()
                        .setColor(color)
                        .setTitle("📻 Status Radio Mode & Auto DJ")
                        .setDescription(
                            `• Mode Aktif: **${st.label}** (\`${st.mode}\`)\n` +
                                `• Lagu Terputar (Anti-Duplikat): \`${st.recentKeys?.length || 0}\` lagu dicatat`,
                        ),
                ],
            });
        }

        const deferred = await safeDeferReply(interaction);
        if (!deferred) return;

        if (sub === "stop") {
            const stopped = stopGuildRadioMode(interaction.guildId);
            return safeEditReply(interaction, {
                embeds: [
                    new EmbedBuilder()
                        .setColor(color)
                        .setDescription(
                            stopped
                                ? "⏹️ **Radio Mode / Auto DJ dinonaktifkan.** Bot tidak akan menambah lagu radio otomatis lagi."
                                : "Radio Mode / Auto DJ memang sudah dalam keadaan mati.",
                        ),
                ],
            });
        }

        const voiceChannel = interaction.member?.voice?.channel;
        if (!voiceChannel) {
            return safeEditReply(interaction, {
                embeds: [
                    new EmbedBuilder()
                        .setColor(color)
                        .setDescription("Masuk ke **Voice Channel** terlebih dahulu untuk menyalakan Radio Mode!"),
                ],
            });
        }

        let player;
        try {
            player = await getOrCreateGuildPlayer(client, {
                guild: interaction.guild,
                voiceChannelId: voiceChannel.id,
                textChannelId: interaction.channelId,
            });
        } catch (err) {
            return safeEditReply(interaction, {
                embeds: [new EmbedBuilder().setColor(color).setDescription(`❌ ${err?.message || "Gagal menghubungkan voice channel."}`)],
            });
        }

        if (player.voiceId && player.voiceId !== voiceChannel.id) {
            return safeEditReply(interaction, {
                embeds: [new EmbedBuilder().setColor(color).setDescription(`Kamu harus berada di <#${player.voiceId}> bersama bot.`)],
            });
        }

        const mode = sub === "autodj" ? "autodj" : "radio";
        const stationId = sub === "station" ? interaction.options.getString("genre", true) : sub === "custom" ? "custom" : "indonesian_pop";
        const customQuery = sub === "custom" ? interaction.options.getString("query", true) : null;

        const res = await startGuildRadioMode(client, player, {
            mode,
            stationId,
            customQuery,
            requester: interaction.user,
        });

        if (!res.ok) {
            return safeEditReply(interaction, {
                embeds: [new EmbedBuilder().setColor(color).setDescription(`❌ ${res.error}`)],
            });
        }

        if (player.queue?.current) {
            await ensureNowPlayingDashboardVisible(client, player, player.queue.current);
        }

        return safeEditReply(interaction, {
            embeds: [
                new EmbedBuilder()
                    .setColor(color)
                    .setTitle("📻 Radio Mode & Auto DJ Aktif!")
                    .setDescription(
                        `Stasiun **${res.state.label}** berhasil dinyalakan di <#${player.voiceId || voiceChannel.id}>!\n` +
                            `Setiap kali antrean selesai, Lagukan otomatis memverifikasi source yang dapat diputar dan menghindari pengulangan 30 lagu terakhir.\n\n` +
                            `*Gunakan \`/radio stop\` kapan saja untuk mematikan Radio Mode.*`,
                    ),
            ],
        });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
