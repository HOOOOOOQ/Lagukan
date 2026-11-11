const { ApplicationCommandOptionType, EmbedBuilder } = require("discord.js");
const { startMusicBattleSession, getMusicBattleLeaderboard } = require("../../../functions/musicGamesSystem.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "musicbattle",
    description: "Adu lagu pilihan antara dua anggota server dengan sistem voting adil 1-user-1-suara!",
    category: "games",
    options: [
        {
            name: "start",
            description: "Mulai pertandingan Music Battle melawan anggota lain",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "opponent",
                    description: "Lawan tanding Music Battle",
                    type: ApplicationCommandOptionType.User,
                    required: true,
                },
                {
                    name: "your_song",
                    description: "Judul atau link lagu andalanmu (kosongkan jika ingin input lewat tombol form)",
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
                {
                    name: "opponent_song",
                    description: "Judul/link lagu lawan (kosongkan agar lawan memilih sendiri lewat tombol)",
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
                {
                    name: "vote_seconds",
                    description: "Durasi voting dalam detik (15 - 180 detik, Default: 45)",
                    type: ApplicationCommandOptionType.Integer,
                    min_value: 15,
                    max_value: 180,
                    required: false,
                },
            ],
        },
        {
            name: "stats",
            description: "Lihat statistik menang/kalah Music Battle milikmu atau anggota lain",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "user",
                    description: "Anggota yang ingin dilihat statistik battle-nya",
                    type: ApplicationCommandOptionType.User,
                    required: false,
                },
            ],
        },
        {
            name: "leaderboard",
            description: "Lihat papan peringkat juara Music Battle di server ini",
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
            const opponent = interaction.options.getUser("opponent", true);
            const songA = interaction.options.getString("your_song") || null;
            const songB = interaction.options.getString("opponent_song") || null;
            const voteSeconds = interaction.options.getInteger("vote_seconds") || 45;

            const res = await startMusicBattleSession(client, {
                guild: interaction.guild,
                userA: interaction.user,
                userB: opponent,
                songQueryA: songA,
                songQueryB: songB,
                voteSeconds,
            });

            if (!res.ok) {
                return safeEditReply(interaction, {
                    embeds: [new EmbedBuilder().setColor(color).setDescription(`⚠️ ${res.error}`)],
                });
            }

            const sent = await safeEditReply(interaction, res.payload);
            res.battle.message = sent;
            return;
        }

        if (sub === "stats") {
            const target = interaction.options.getUser("user") || interaction.user;
            const doc = await client.musicBattleData
                ?.findOne({ guildId: String(interaction.guildId), userId: String(target.id) })
                .catch(() => null);
            const plain = doc ? (typeof doc.toObject === "function" ? doc.toObject() : doc) : null;

            const embed = new EmbedBuilder()
                .setColor(color)
                .setTitle(`⚔️ Statistik Music Battle — ${target.username}`)
                .setThumbnail(target.displayAvatarURL?.({ size: 256 }) || null)
                .addFields(
                    { name: "Menang (Wins)", value: `\`${plain?.wins || 0}\``, inline: true },
                    { name: "Kalah (Losses)", value: `\`${plain?.losses || 0}\``, inline: true },
                    { name: "Seri (Ties)", value: `\`${plain?.ties || 0}\``, inline: true },
                    { name: "Total Battle", value: `\`${plain?.battlesPlayed || 0}\``, inline: true },
                    { name: "Total Suara Diterima", value: `\`${plain?.totalVotesReceived || 0}\``, inline: true },
                )
                .setTimestamp();
            return safeEditReply(interaction, { embeds: [embed] });
        }

        if (sub === "leaderboard") {
            const rows = await getMusicBattleLeaderboard(client, interaction.guildId);
            const lines = rows.slice(0, 10).map((r, idx) => {
                const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `\`#${idx + 1}\``;
                return `${medal} <@${r.userId}> — **\`${r.wins} Menang\`** (\`${r.losses}\` Kalah • \`${r.ties}\` Seri • \`${r.totalVotesReceived}\` suara)`;
            });

            const embed = new EmbedBuilder()
                .setColor(color)
                .setTitle(`🏆 Music Battle Leaderboard — ${interaction.guild.name}`)
                .setDescription(
                    lines.length
                        ? lines.join("\n")
                        : "Belum ada pertandingan Music Battle tercatat di server ini. Tantang temanmu dengan `/musicbattle start`!",
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
