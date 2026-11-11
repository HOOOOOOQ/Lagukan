const { ApplicationCommandOptionType, MessageFlags } = require("discord.js");
const { buildMusicLeaderboardPayload } = require("../../../functions/musicStatsEngine.js");
const { safeDeferReply, safeEditReply, safeDeferUpdate, safeReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "musicleaderboard",
    description: "Lihat papan peringkat musik server (Listener Aktif, Lagu Terpopuler, Artis, Durasi, Mingguan, Bulanan)",
    category: "profile",
    options: [
        {
            name: "mode",
            description: "Kategori papan peringkat yang ingin ditampilkan",
            type: ApplicationCommandOptionType.String,
            required: false,
            choices: [
                { name: "Most Active Listener", value: "active" },
                { name: "Most Played Songs", value: "songs" },
                { name: "Top Artists", value: "artists" },
                { name: "Total Listening Time", value: "time" },
                { name: "Weekly Listener", value: "weekly" },
                { name: "Monthly Listener", value: "monthly" },
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
        const deferred = await safeDeferReply(interaction);
        if (!deferred) return;

        let currentMode = interaction.options.getString("mode") || "active";
        let currentPage = 0;

        const initial = await buildMusicLeaderboardPayload(client, interaction.guild, currentMode, currentPage);
        currentPage = initial.safePage;

        const sent = await safeEditReply(interaction, {
            embeds: initial.embeds,
            components: initial.components,
        });
        if (!sent || typeof sent.createMessageComponentCollector !== "function") return;

        const collector = sent.createMessageComponentCollector({ time: 180000 });
        collector.on("collect", (comp) => {
            void (async () => {
                if (comp.user.id !== interaction.user.id) {
                    return safeReply(comp, {
                        content: "Jalankan `/musicleaderboard` sendiri untuk mengganti kategori atau halaman.",
                        flags: MessageFlags.Ephemeral,
                    });
                }
                const ack = await safeDeferUpdate(comp);
                if (!ack) return;

                if (comp.customId === "mlb:mode") {
                    currentMode = comp.values?.[0] || "active";
                    currentPage = 0;
                } else if (comp.customId === "mlb:prev") {
                    currentPage = Math.max(0, currentPage - 1);
                } else if (comp.customId === "mlb:next") {
                    currentPage += 1;
                }

                const next = await buildMusicLeaderboardPayload(client, interaction.guild, currentMode, currentPage);
                currentPage = next.safePage;
                await safeEditReply(interaction, {
                    embeds: next.embeds,
                    components: next.components,
                });
            })().catch(() => {});
        });

        collector.on("end", () => {
            if (typeof sent.edit === "function") {
                sent.edit({ components: [] }).catch(() => {});
            }
        });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
