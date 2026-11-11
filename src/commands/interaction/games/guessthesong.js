const { ApplicationCommandOptionType, EmbedBuilder } = require("discord.js");
const { startGuessTheSongGame, stopGuessTheSongGame, getGuessTheSongLeaderboard } = require("../../../functions/musicGamesSystem.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "guessthesong",
    description: "Mainkan mini-game tebak judul lagu dari potongan audio di voice channel!",
    category: "games",
    options: [
        {
            name: "start",
            description: "Mulai ronde Guess The Song baru di voice channel",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "difficulty",
                    description: "Tingkat kesulitan tebak lagu",
                    type: ApplicationCommandOptionType.String,
                    required: false,
                    choices: [
                        { name: "Easy (45d + Petunjuk Artis & Pola)", value: "easy" },
                        { name: "Medium (30d + Pola Huruf)", value: "medium" },
                        { name: "Hard (20d + Murni Audio Tanpa Petunjuk)", value: "hard" },
                    ],
                },
            ],
        },
        {
            name: "stop",
            description: "Hentikan ronde Guess The Song yang sedang berjalan",
            type: ApplicationCommandOptionType.Subcommand,
        },
        {
            name: "leaderboard",
            description: "Lihat papan peringkat poin Guess The Song di server ini",
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
    },
    devOnly: false,
    run: async (client, interaction) => {
        const sub = interaction.options.getSubcommand();
        const color = client.config?.embedColor || "#5865F2";
        const deferred = await safeDeferReply(interaction);
        if (!deferred) return;

        if (sub === "start") {
            const difficulty = interaction.options.getString("difficulty") || "medium";
            const res = await startGuessTheSongGame(client, {
                guild: interaction.guild,
                member: interaction.member,
                user: interaction.user,
                channel: interaction.channel,
                difficulty,
            });
            if (!res.ok) {
                return safeEditReply(interaction, {
                    embeds: [new EmbedBuilder().setColor(color).setDescription(`⚠️ ${res.error}`)],
                });
            }
            return safeEditReply(interaction, { embeds: [res.embed] });
        }

        if (sub === "stop") {
            const stopped = await stopGuessTheSongGame(client, interaction.guildId, "manual");
            return safeEditReply(interaction, {
                embeds: [
                    new EmbedBuilder()
                        .setColor(color)
                        .setDescription(
                            stopped
                                ? "🛑 Ronde **Guess The Song** berhasil dihentikan."
                                : "Tidak ada ronde Guess The Song yang sedang aktif.",
                        ),
                ],
            });
        }

        if (sub === "leaderboard") {
            const rows = await getGuessTheSongLeaderboard(client, interaction.guildId);
            const lines = rows.slice(0, 10).map((r, idx) => {
                const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `\`#${idx + 1}\``;
                const fast = r.fastestGuessMs ? ` • Tercepat \`${(r.fastestGuessMs / 1000).toFixed(1)}d\`` : "";
                return `${medal} <@${r.userId}> — **\`${r.points} Poin\`** (\`${r.correctGuesses}\` benar dari \`${r.gamesPlayed}\` ronde${fast})`;
            });

            const embed = new EmbedBuilder()
                .setColor(color)
                .setTitle(`🏆 Guess The Song Leaderboard — ${interaction.guild.name}`)
                .setDescription(
                    lines.length
                        ? lines.join("\n")
                        : "Belum ada skor Guess The Song di server ini. Mulai ronde pertamamu dengan `/guessthesong start`!",
                )
                .setTimestamp();
            return safeEditReply(interaction, { embeds: [embed] });
        }
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
