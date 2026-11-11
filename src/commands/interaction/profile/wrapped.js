const { ActionRowBuilder, ApplicationCommandOptionType, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const { computeMusicWrappedData, buildMusicWrappedPages } = require("../../../functions/musicStatsEngine.js");
const { safeDeferReply, safeEditReply, safeDeferUpdate, safeReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "wrapped",
    description: "Lihat ringkasan Music Wrapped personal kamu (All-Time, Weekly, atau Monthly)",
    category: "profile",
    options: [
        {
            name: "period",
            description: "Periode waktu Music Wrapped",
            type: ApplicationCommandOptionType.String,
            required: false,
            choices: [
                { name: "Weekly (7 Hari Terakhir)", value: "weekly" },
                { name: "Monthly (30 Hari Terakhir)", value: "monthly" },
                { name: "All-Time (Sepanjang Waktu)", value: "alltime" },
            ],
        },
        {
            name: "user",
            description: "Anggota yang ingin dilihat Music Wrapped-nya",
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

        const period = interaction.options.getString("period") || "weekly";
        const targetUser = interaction.options.getUser("user") || interaction.user;

        const wrappedData = await computeMusicWrappedData(client, {
            userId: targetUser.id,
            periodType: period,
            guildId: interaction.guildId,
        });

        const pages = buildMusicWrappedPages(client, targetUser, wrappedData);

        if (pages.length <= 1) {
            return safeEditReply(interaction, { embeds: pages, components: [] });
        }

        let currentPage = 0;
        const buildNavRow = (pageIdx) =>
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("wrap:prev")
                    .setEmoji("⬅️")
                    .setLabel("Sebelumnya")
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(pageIdx <= 0),
                new ButtonBuilder()
                    .setCustomId("wrap:page")
                    .setLabel(`Halaman ${pageIdx + 1}/${pages.length}`)
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId("wrap:next")
                    .setEmoji("➡️")
                    .setLabel("Berikutnya")
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(pageIdx >= pages.length - 1),
            );

        const sent = await safeEditReply(interaction, {
            embeds: [pages[currentPage]],
            components: [buildNavRow(currentPage)],
        });

        if (!sent || typeof sent.createMessageComponentCollector !== "function") return;

        const collector = sent.createMessageComponentCollector({ time: 180000 });
        collector.on("collect", (btn) => {
            void (async () => {
                if (btn.user.id !== interaction.user.id) {
                    return safeReply(btn, {
                        content: "Jalankan `/wrapped` sendiri untuk berpindah halaman.",
                        flags: MessageFlags.Ephemeral,
                    });
                }
                const ack = await safeDeferUpdate(btn);
                if (!ack) return;

                if (btn.customId === "wrap:prev") currentPage = Math.max(0, currentPage - 1);
                else if (btn.customId === "wrap:next") currentPage = Math.min(pages.length - 1, currentPage + 1);

                await safeEditReply(interaction, {
                    embeds: [pages[currentPage]],
                    components: [buildNavRow(currentPage)],
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
