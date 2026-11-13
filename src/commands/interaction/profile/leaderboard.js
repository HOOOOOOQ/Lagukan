const { MessageFlags } = require("discord.js");
const { buildLeaderboard666Payload } = require("../../../functions/profile666Engine.js");
const { safeDeferReply, safeEditReply, safeDeferUpdate, safeReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "leaderboard",
    description: "Tampilkan Top 10 pendengar musik paling aktif di server ini (666 Music Leaderboard)",
    category: "profile",
    options: [],
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

        let currentPage = 0;
        const initial = await buildLeaderboard666Payload(client, interaction.guild, interaction.user, currentPage);
        currentPage = initial.safePage;

        const sent = await safeEditReply(interaction, {
            embeds: initial.embeds,
            files: initial.files,
            components: initial.components,
        });
        if (!sent || typeof sent.createMessageComponentCollector !== "function") return;

        const collector = sent.createMessageComponentCollector({ time: 180_000 });
        collector.on("collect", (comp) => {
            void (async () => {
                if (comp.applicationId && client.user?.id && String(comp.applicationId) !== String(client.user.id)) return;
                if (comp.user.id !== interaction.user.id) {
                    return safeReply(comp, {
                        content: "Jalankan `/leaderboard` sendiri untuk mengganti halaman.",
                        flags: MessageFlags.Ephemeral,
                    });
                }

                const ack = await safeDeferUpdate(comp);
                if (!ack) return;

                if (comp.customId === "lb666:prev") {
                    currentPage = Math.max(0, currentPage - 1);
                } else if (comp.customId === "lb666:next") {
                    currentPage += 1;
                }

                const next = await buildLeaderboard666Payload(client, interaction.guild, interaction.user, currentPage);
                currentPage = next.safePage;
                await safeEditReply(interaction, {
                    embeds: next.embeds,
                    files: next.files,
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
