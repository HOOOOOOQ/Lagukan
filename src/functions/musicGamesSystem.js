const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");
const { smartSearch, formatTrackSourceLabel } = require("./musicSourceResolver.js");
const { getOrCreateGuildPlayer, startPlayerIfIdle } = require("./musicPermissions.js");
const { PLAYER_STATE_DESTROYED, getGuildPlayer } = require("./voiceSessionManager.js");
const { cleanupNowPlayingMessage, truncateText } = require("./nowPlayingManager.js");
const { convertTime } = require("./timeFormat.js");
const { safeReply, safeEditReply, safeDeferReply, safeDeferUpdate } = require("./interactionResponder.js");

const GUESS_SONG_POOL = [
    { query: "Kunto Aji Teh Hijau", answerTitle: "Teh Hijau", answerArtist: "Kunto Aji" },
    { query: "HIVI! Remaja", answerTitle: "Remaja", answerArtist: "HIVI!" },
    { query: "Hindia Secukupnya", answerTitle: "Secukupnya", answerArtist: "Hindia" },
    { query: "Sheila On 7 Dan", answerTitle: "Dan", answerArtist: "Sheila On 7" },
    { query: "Payung Teduh Resah", answerTitle: "Resah", answerArtist: "Payung Teduh" },
    { query: "Tulus Hati-Hati di Jalan", answerTitle: "Hati-Hati di Jalan", answerArtist: "Tulus" },
    { query: "Pamungkas To The Bone", answerTitle: "To The Bone", answerArtist: "Pamungkas" },
    { query: "Nadin Amizah Bertaut", answerTitle: "Bertaut", answerArtist: "Nadin Amizah" },
    { query: "Queen Bohemian Rhapsody", answerTitle: "Bohemian Rhapsody", answerArtist: "Queen" },
    { query: "The Weeknd Blinding Lights", answerTitle: "Blinding Lights", answerArtist: "The Weeknd" },
    { query: "Linkin Park In The End", answerTitle: "In The End", answerArtist: "Linkin Park" },
    { query: "Coldplay Yellow", answerTitle: "Yellow", answerArtist: "Coldplay" },
];

const DIFFICULTY_SETTINGS = {
    easy: { label: "Easy", timeoutSec: 45, basePoints: 10 },
    medium: { label: "Medium", timeoutSec: 30, basePoints: 20 },
    hard: { label: "Hard", timeoutSec: 20, basePoints: 35 },
};

// Map<guildId, ActiveGuessSession>
const activeGuessSessions = new Map();

// Map<guildId, ActiveBattleSession>
const activeBattleSessions = new Map();

function normalizeGuessString(str) {
    return String(str || "")
        .toLowerCase()
        .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
        .replace(/[^a-z0-9\s]/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function maskTitleHint(title) {
    return String(title || "")
        .split(" ")
        .map((word) => {
            if (word.length <= 2) return "_".repeat(word.length);
            return word[0] + "_".repeat(word.length - 1);
        })
        .join(" ");
}

function getActiveGuessSession(guildId) {
    if (!guildId) return null;
    return activeGuessSessions.get(String(guildId)) || null;
}

async function stopGuessTheSongGame(client, guildId, reason = "stopped") {
    const gid = String(guildId || "");
    const session = activeGuessSessions.get(gid);
    if (!session) return false;

    if (session.timer) clearTimeout(session.timer);
    activeGuessSessions.delete(gid);

    const player = getGuildPlayer(client, gid);
    if (player && player.state !== PLAYER_STATE_DESTROYED) {
        player.data?.set?.("guessTheSongActive", false);
        player._manualStopAt = Date.now();
        await Promise.resolve(player.stop()).catch(() => {});
    }

    if (reason === "timeout" && session.channel) {
        const embed = new EmbedBuilder()
            .setColor(client.config?.embedColor || "#5865F2")
            .setTitle("⏰ Waktu Habis — Guess The Song!")
            .setDescription(
                `Belum ada yang berhasil menebak tepat waktu.\n\n` +
                    `🎶 **Judul Lagu:** **${session.answerTitle}**\n` +
                    `🎤 **Artis:** **${session.answerArtist}**`,
            );
        await session.channel.send({ embeds: [embed] }).catch(() => {});
    }

    return true;
}

async function startGuessTheSongGame(client, { guild, member, user, channel, difficulty = "medium", customPick = null }) {
    const gid = String(guild.id);
    if (activeGuessSessions.has(gid)) {
        return { ok: false, error: "Masih ada ronde **Guess The Song** yang sedang berjalan di server ini!" };
    }

    const voiceChannel = member?.voice?.channel;
    if (!voiceChannel) {
        return { ok: false, error: "Masuk ke **Voice Channel** terlebih dahulu untuk memulai Guess The Song!" };
    }

    const diffKey = DIFFICULTY_SETTINGS[difficulty] ? difficulty : "medium";
    const diff = DIFFICULTY_SETTINGS[diffKey];

    const picked = customPick || GUESS_SONG_POOL[Math.floor(Math.random() * GUESS_SONG_POOL.length)];

    const searchRes = await smartSearch(client, picked.query, { requester: client.user });
    const resolvedTrack = searchRes?.tracks?.[0];
    if (!resolvedTrack) {
        return { ok: false, error: "Gagal memuat potongan audio tebak lagu dari source Lavalink." };
    }

    let player;
    try {
        player = await getOrCreateGuildPlayer(client, {
            guild,
            voiceChannelId: voiceChannel.id,
            textChannelId: channel.id,
        });
    } catch (err) {
        return { ok: false, error: err?.message || "Gagal menghubungkan player ke voice channel." };
    }

    // Hide Now Playing Dashboard & prevent title leak BEFORE starting snippet playback
    await cleanupNowPlayingMessage(player, true);
    player.queue.clear();
    player.data?.set?.("guessTheSongActive", true);
    player.queue.add(resolvedTrack);

    const startRes = await startPlayerIfIdle(client, player, {
        guild,
        userId: user.id,
        command: "guessthesong",
        waitForTrackStart: true,
        timeoutMs: 7000,
    });

    if (!startRes.ok) {
        player.data?.set?.("guessTheSongActive", false);
        return { ok: false, error: startRes.error || "Gagal memutar potongan audio tebak lagu." };
    }

    if (resolvedTrack.isSeekable && Number(resolvedTrack.duration || 0) >= 60000 && typeof player.seek === "function") {
        await Promise.resolve(player.seek(25000)).catch(() => {});
    }

    const hintLines = [];
    if (diffKey === "easy") {
        hintLines.push(`💡 **Petunjuk Artis:** \`${picked.answerArtist}\``);
        hintLines.push(`🔤 **Pola Judul:** \`${maskTitleHint(picked.answerTitle)}\``);
    } else if (diffKey === "medium") {
        hintLines.push(`🔤 **Pola Judul:** \`${maskTitleHint(picked.answerTitle)}\``);
    } else {
        hintLines.push(`🔥 **Mode Hard:** Tanpa petunjuk teks — dengarkan potongan audionya di <#${voiceChannel.id}>!`);
    }

    const startedAt = Date.now();
    const session = {
        guildId: gid,
        botId: client.user?.id || null,
        channelId: String(channel.id),
        channel,
        hostId: String(user.id),
        difficulty: diffKey,
        basePoints: diff.basePoints,
        timeoutSec: diff.timeoutSec,
        answerTitle: picked.answerTitle,
        normalizedAnswer: normalizeGuessString(picked.answerTitle),
        answerArtist: picked.answerArtist,
        participants: new Set([String(user.id)]),
        startedAt,
        timer: null,
    };

    session.timer = setTimeout(() => {
        void stopGuessTheSongGame(client, gid, "timeout");
    }, diff.timeoutSec * 1000);
    if (typeof session.timer.unref === "function") session.timer.unref();

    activeGuessSessions.set(gid, session);

    const startEmbed = new EmbedBuilder()
        .setColor(client.config?.embedColor || "#5865F2")
        .setTitle(`🎧 Guess The Song Dimulai! (${diff.label})`)
        .setDescription(
            `Potongan audio sedang diputar di <#${voiceChannel.id}>!\n` +
                `**Ketik tebakan judul lagu langsung di chat channel ini** sebelum waktu habis.\n\n` +
                `${hintLines.join("\n")}\n\n` +
                `⏱️ **Batas Waktu:** \`${diff.timeoutSec} detik\` • 🏆 **Poin Dasar:** \`+${diff.basePoints} pts\``,
        )
        .setFooter({ text: "Judul lagu disembunyikan sampai ronde selesai!" });

    return { ok: true, embed: startEmbed, session };
}

/**
 * Checks plain-text guesses in an active Guess The Song channel without leaking the answer early.
 */
async function handleGuessTheSongMessage(client, message) {
    if (!message?.guild || message.author?.bot) return false;
    const session = activeGuessSessions.get(String(message.guild.id));
    if (!session || String(message.channel.id) !== session.channelId) return false;
    if (session.botId && client.user?.id && String(session.botId) !== String(client.user.id)) return false;

    const raw = String(message.content || "").trim();
    if (!raw || raw.startsWith("/") || /^<@!?\d+>/.test(raw) || /^666(?:\b|!)/i.test(raw)) return false;

    const guessNorm = normalizeGuessString(raw);
    if (!guessNorm || guessNorm.length < 2) return false;

    session.participants.add(String(message.author.id));

    const isExactOrCleanMatch =
        guessNorm === session.normalizedAnswer ||
        (guessNorm.length >= 4 && session.normalizedAnswer.length >= 4 && guessNorm.includes(session.normalizedAnswer));

    if (!isExactOrCleanMatch) {
        return false;
    }

    // Winner found! Stop timer and audio snippet immediately
    const elapsedMs = Math.max(100, Date.now() - session.startedAt);
    const speedBonus = elapsedMs <= 10000 ? 5 : elapsedMs <= 20000 ? 3 : 0;
    const pointsEarned = session.basePoints + speedBonus;

    await stopGuessTheSongGame(client, message.guild.id, "guessed");

    // Persist stats for winner and participants in GuessTheSong collection
    if (client?.guessTheSongData) {
        for (const pid of session.participants) {
            const isWin = pid === String(message.author.id);
            const existing = await client.guessTheSongData.findOne({ guildId: String(message.guild.id), userId: pid }).catch(() => null);
            const plain = existing ? (typeof existing.toObject === "function" ? existing.toObject() : existing) : null;

            const prevFastest = plain?.fastestGuessMs ?? null;
            const nextFastest = isWin && (prevFastest === null || elapsedMs < prevFastest) ? elapsedMs : prevFastest;

            await client.guessTheSongData
                .findOneAndUpdate(
                    { guildId: String(message.guild.id), userId: pid },
                    {
                        $set: {
                            points: Number(plain?.points || 0) + (isWin ? pointsEarned : 0),
                            correctGuesses: Number(plain?.correctGuesses || 0) + (isWin ? 1 : 0),
                            gamesPlayed: Number(plain?.gamesPlayed || 0) + 1,
                            fastestGuessMs: nextFastest,
                            lastPlayedAt: new Date(),
                        },
                    },
                    { upsert: true, returnDocument: "after" },
                )
                .catch(() => {});
        }
    }

    const winEmbed = new EmbedBuilder()
        .setColor(client.config?.embedColor || "#5865F2")
        .setTitle("🎉 Jawaban Benar — Guess The Song!")
        .setDescription(
            `Selamat <@${message.author.id}> berhasil menebak dalam **\`${(elapsedMs / 1000).toFixed(1)} detik\`**!\n\n` +
                `🎶 **Judul Lagu:** **${session.answerTitle}**\n` +
                `🎤 **Artis:** **${session.answerArtist}**\n` +
                `🏆 **Poin Diperoleh:** **\`+${pointsEarned} Poin\`** *(Kesulitan: ${session.difficulty.toUpperCase()})*`,
        )
        .setTimestamp();

    await message.channel.send({ embeds: [winEmbed] }).catch(() => {});
    return true;
}

async function getGuessTheSongLeaderboard(client, guildId) {
    if (!client?.guessTheSongData) return [];
    const raw = await client.guessTheSongData.find({ guildId: String(guildId) }).catch(() => []);
    return (Array.isArray(raw) ? raw : [])
        .map((r) => (typeof r.toObject === "function" ? r.toObject() : r))
        .filter((r) => Number(r.points || 0) > 0 || Number(r.correctGuesses || 0) > 0)
        .sort((a, b) => b.points - a.points || b.correctGuesses - a.correctGuesses);
}

// ============================================================================
// Music Battle System (2 Contenders + Strict One-Vote-Per-User Arena)
// ============================================================================

function buildBattlePayload(client, battle) {
    const color = client.config?.embedColor || "#5865F2";
    const botName = client.config?.botName || "Lagukan";

    if (battle.phase === "submission") {
        const embed = new EmbedBuilder()
            .setColor(color)
            .setAuthor({ name: `${botName} • Music Battle Preparation` })
            .setTitle("⚔️ Music Battle — Pengajuan Lagu Contender")
            .setDescription(
                `🅰️ **Contender A (<@${battle.userAId}>):** ${battle.trackA ? `✅ **${truncateText(battle.trackA.title, 45)}** — ${truncateText(battle.trackA.author, 28)}` : "⏳ *Belum mengajukan lagu*"}\n` +
                    `🅱️ **Contender B (<@${battle.userBId}>):** ${battle.trackB ? `✅ **${truncateText(battle.trackB.title, 45)}** — ${truncateText(battle.trackB.author, 28)}` : "⏳ *Belum mengajukan lagu*"}\n\n` +
                    `Klik tombol di bawah sesuai posisimu untuk mengajukan lagu! Begitu kedua lagu siap, voting server langsung dibuka.`,
            );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("mbat:submit_a")
                .setLabel("Ajukan Lagu A")
                .setEmoji("🅰️")
                .setStyle(battle.trackA ? ButtonStyle.Success : ButtonStyle.Primary)
                .setDisabled(Boolean(battle.trackA)),
            new ButtonBuilder()
                .setCustomId("mbat:submit_b")
                .setLabel("Ajukan Lagu B")
                .setEmoji("🅱️")
                .setStyle(battle.trackB ? ButtonStyle.Success : ButtonStyle.Primary)
                .setDisabled(Boolean(battle.trackB)),
            new ButtonBuilder().setCustomId("mbat:cancel").setLabel("Batalkan").setStyle(ButtonStyle.Danger),
        );
        return { embeds: [embed], components: [row] };
    }

    let countA = 0;
    let countB = 0;
    for (const choice of battle.votes.values()) {
        if (choice === "A") countA += 1;
        else if (choice === "B") countB += 1;
    }

    const embed = new EmbedBuilder()
        .setColor(color)
        .setAuthor({ name: `${botName} • Live Music Battle Voting` })
        .setTitle("🔥 MUSIC BATTLE — PILIH LAGU FAVORITMU!")
        .setDescription(
            `Berikan suaramu melalui tombol di bawah! *(1 anggota hanya dihitung 1 suara)*\n\n` +
                `🅰️ **Pilihan A** *(oleh <@${battle.userAId}>)*\n` +
                `> **${truncateText(battle.trackA.title, 52)}** — ${truncateText(battle.trackA.author, 32)} (\`${convertTime(battle.trackA.duration || 0)}\` • ${formatTrackSourceLabel(battle.trackA)})\n` +
                `> Suara saat ini: **\`${countA}\`**\n\n` +
                `🅱️ **Pilihan B** *(oleh <@${battle.userBId}>)*\n` +
                `> **${truncateText(battle.trackB.title, 52)}** — ${truncateText(battle.trackB.author, 32)} (\`${convertTime(battle.trackB.duration || 0)}\` • ${formatTrackSourceLabel(battle.trackB)})\n` +
                `> Suara saat ini: **\`${countB}\`**\n\n` +
                `⏱️ Voting ditutup <t:${Math.floor(battle.endsAt / 1000)}:R>`,
        );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("mbat:vote:A").setEmoji("🅰️").setLabel(`Vote Lagu A (${countA})`).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("mbat:vote:B").setEmoji("🅱️").setLabel(`Vote Lagu B (${countB})`).setStyle(ButtonStyle.Success),
    );
    return { embeds: [embed], components: [row] };
}

async function finalizeMusicBattle(client, guildId) {
    const gid = String(guildId);
    const battle = activeBattleSessions.get(gid);
    if (!battle || battle.settled) return null;
    battle.settled = true;
    if (battle.timer) clearTimeout(battle.timer);
    activeBattleSessions.delete(gid);

    let votesA = 0;
    let votesB = 0;
    for (const choice of battle.votes.values()) {
        if (choice === "A") votesA += 1;
        else if (choice === "B") votesB += 1;
    }

    const isTie = votesA === votesB;
    const winnerSide = isTie ? null : votesA > votesB ? "A" : "B";
    const winnerId = winnerSide === "A" ? battle.userAId : winnerSide === "B" ? battle.userBId : null;
    const winnerTrack = winnerSide === "A" ? battle.trackA : winnerSide === "B" ? battle.trackB : null;

    if (client?.musicBattleData) {
        const recordContender = async (uid, myVotes, won, lost, tied) => {
            const existing = await client.musicBattleData.findOne({ guildId: gid, userId: uid }).catch(() => null);
            const plain = existing ? (typeof existing.toObject === "function" ? existing.toObject() : existing) : null;
            await client.musicBattleData
                .findOneAndUpdate(
                    { guildId: gid, userId: uid },
                    {
                        $set: {
                            wins: Number(plain?.wins || 0) + (won ? 1 : 0),
                            losses: Number(plain?.losses || 0) + (lost ? 1 : 0),
                            ties: Number(plain?.ties || 0) + (tied ? 1 : 0),
                            totalVotesReceived: Number(plain?.totalVotesReceived || 0) + myVotes,
                            battlesPlayed: Number(plain?.battlesPlayed || 0) + 1,
                            lastBattleAt: new Date(),
                        },
                    },
                    { upsert: true, returnDocument: "after" },
                )
                .catch(() => {});
        };

        await Promise.all([
            recordContender(battle.userAId, votesA, winnerSide === "A", winnerSide === "B", isTie),
            recordContender(battle.userBId, votesB, winnerSide === "B", winnerSide === "A", isTie),
        ]);
    }

    const resultEmbed = new EmbedBuilder()
        .setColor(client.config?.embedColor || "#5865F2")
        .setTitle("🏆 Hasil Akhir Music Battle!")
        .setDescription(
            (isTie
                ? `🤝 **Pertandingan Berakhir SERI (\`${votesA}\` vs \`${votesB}\`)!**\n\n`
                : `🎉 **Pemenang:** <@${winnerId}> dengan lagu **${winnerTrack.title}** — ${winnerTrack.author}!\n\n`) +
                `🅰️ <@${battle.userAId}> — **${truncateText(battle.trackA.title, 42)}**: **\`${votesA} suara\`**\n` +
                `🅱️ <@${battle.userBId}> — **${truncateText(battle.trackB.title, 42)}**: **\`${votesB} suara\`**`,
        )
        .setTimestamp();

    if (battle.message && typeof battle.message.edit === "function") {
        await battle.message.edit({ embeds: [resultEmbed], components: [] }).catch(() => {});
    }

    return { votesA, votesB, isTie, winnerSide, winnerId, resultEmbed };
}

function beginBattleVotingPhase(client, battle) {
    battle.phase = "voting";
    battle.endsAt = Date.now() + battle.voteSeconds * 1000;
    if (battle.timer) clearTimeout(battle.timer);
    battle.timer = setTimeout(() => {
        void finalizeMusicBattle(client, battle.guildId);
    }, battle.voteSeconds * 1000);
    if (typeof battle.timer.unref === "function") battle.timer.unref();
}

async function startMusicBattleSession(client, { guild, userA, userB, songQueryA = null, songQueryB = null, voteSeconds = 45 }) {
    const gid = String(guild.id);
    if (activeBattleSessions.has(gid)) {
        return { ok: false, error: "Masih ada sesi **Music Battle** yang sedang berlangsung di server ini!" };
    }

    if (!userB || userB.bot || String(userA.id) === String(userB.id)) {
        return { ok: false, error: "Pilih lawan anggota server (manusia, bukan dirimu sendiri atau bot) untuk Music Battle!" };
    }

    let trackA = null;
    let trackB = null;

    if (songQueryA) {
        const resA = await smartSearch(client, songQueryA, { requester: userA });
        if (!resA?.tracks?.[0]) {
            return { ok: false, error: `Lagu Contender A (\`${songQueryA}\`) tidak ditemukan.` };
        }
        trackA = resA.tracks[0];
    }

    if (songQueryB) {
        const resB = await smartSearch(client, songQueryB, { requester: userB });
        if (!resB?.tracks?.[0]) {
            return { ok: false, error: `Lagu Contender B (\`${songQueryB}\`) tidak ditemukan.` };
        }
        trackB = resB.tracks[0];
    }

    const clampedVoteSec = Math.min(Math.max(5, Number(voteSeconds || 45)), 180);

    const battle = {
        guildId: gid,
        userAId: String(userA.id),
        userBId: String(userB.id),
        trackA,
        trackB,
        phase: trackA && trackB ? "voting" : "submission",
        voteSeconds: clampedVoteSec,
        endsAt: 0,
        votes: new Map(),
        message: null,
        timer: null,
        settled: false,
    };

    if (battle.phase === "voting") {
        beginBattleVotingPhase(client, battle);
    } else {
        battle.timer = setTimeout(() => {
            const cur = activeBattleSessions.get(gid);
            if (cur && cur.phase === "submission") {
                activeBattleSessions.delete(gid);
                if (cur.message?.edit) {
                    cur.message
                        .edit({
                            embeds: [
                                new EmbedBuilder()
                                    .setColor(client.config?.embedColor || "#5865F2")
                                    .setDescription("⏰ Music Battle dibatalkan karena batas waktu pengajuan lagu habis."),
                            ],
                            components: [],
                        })
                        .catch(() => {});
                }
            }
        }, 120000);
        if (typeof battle.timer.unref === "function") battle.timer.unref();
    }

    activeBattleSessions.set(gid, battle);
    return { ok: true, battle, payload: buildBattlePayload(client, battle) };
}

async function handleMusicBattleInteraction(client, interaction) {
    const customId = String(interaction.customId || "");
    const gid = String(interaction.guild?.id || "");
    const color = client.config?.embedColor || "#5865F2";
    const battle = activeBattleSessions.get(gid);

    if (!battle || battle.settled) {
        return safeReply(interaction, {
            embeds: [new EmbedBuilder().setColor(color).setDescription("Sesi Music Battle ini sudah berakhir.")],
            flags: MessageFlags.Ephemeral,
        });
    }

    if (customId === "mbat:cancel") {
        if (String(interaction.user.id) !== battle.userAId && String(interaction.user.id) !== battle.userBId) {
            return safeReply(interaction, {
                embeds: [new EmbedBuilder().setColor(color).setDescription("Hanya peserta battle yang dapat membatalkan.")],
                flags: MessageFlags.Ephemeral,
            });
        }
        const ack = await safeDeferUpdate(interaction);
        if (!ack) return;
        if (battle.timer) clearTimeout(battle.timer);
        activeBattleSessions.delete(gid);
        if (battle.message?.edit) {
            await battle.message
                .edit({
                    embeds: [new EmbedBuilder().setColor(color).setDescription("🛑 Music Battle dibatalkan oleh peserta.")],
                    components: [],
                })
                .catch(() => {});
        }
        return;
    }

    if (customId === "mbat:submit_a" || customId === "mbat:submit_b") {
        const expectedUser = customId === "mbat:submit_a" ? battle.userAId : battle.userBId;
        if (String(interaction.user.id) !== expectedUser) {
            return safeReply(interaction, {
                embeds: [new EmbedBuilder().setColor(color).setDescription(`Tombol ini khusus untuk <@${expectedUser}>!`)],
                flags: MessageFlags.Ephemeral,
            });
        }
        if (typeof interaction.showModal !== "function") return;
        const modal = new ModalBuilder()
            .setCustomId(customId === "mbat:submit_a" ? "mbat:modal_a" : "mbat:modal_b")
            .setTitle("Ajukan Lagu Music Battle")
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId("song")
                        .setLabel("Judul Lagu atau Link Musik")
                        .setStyle(TextInputStyle.Short)
                        .setMinLength(2)
                        .setMaxLength(200)
                        .setRequired(true),
                ),
            );
        await interaction.showModal(modal).catch(() => {});
        return;
    }

    if (customId === "mbat:modal_a" || customId === "mbat:modal_b") {
        const isSideA = customId === "mbat:modal_a";
        const expectedUser = isSideA ? battle.userAId : battle.userBId;
        if (String(interaction.user.id) !== expectedUser) return;

        const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const query = interaction.fields?.getTextInputValue?.("song") || "";
        const searchRes = await smartSearch(client, query, { requester: interaction.user });
        const found = searchRes?.tracks?.[0];
        if (!found) {
            return safeEditReply(interaction, {
                embeds: [new EmbedBuilder().setColor(color).setDescription("Lagu tidak ditemukan. Coba judul/link lain.")],
            });
        }

        if (isSideA) battle.trackA = found;
        else battle.trackB = found;

        if (battle.trackA && battle.trackB && battle.phase === "submission") {
            beginBattleVotingPhase(client, battle);
        }

        if (battle.message?.edit) {
            await battle.message.edit(buildBattlePayload(client, battle)).catch(() => {});
        }

        return safeEditReply(interaction, {
            embeds: [new EmbedBuilder().setColor(color).setDescription(`✅ Lagu **${found.title}** berhasil diajukan!`)],
        });
    }

    if (customId === "mbat:vote:A" || customId === "mbat:vote:B") {
        if (battle.phase !== "voting") {
            return safeReply(interaction, {
                embeds: [new EmbedBuilder().setColor(color).setDescription("Voting belum dibuka.")],
                flags: MessageFlags.Ephemeral,
            });
        }

        const side = customId.endsWith(":A") ? "A" : "B";
        const voterId = String(interaction.user.id);

        if (battle.votes.has(voterId)) {
            const existingChoice = battle.votes.get(voterId);
            return safeReply(interaction, {
                embeds: [
                    new EmbedBuilder()
                        .setColor(color)
                        .setDescription(
                            `⚠️ Kamu sudah memberikan suara untuk **Pilihan ${existingChoice}**! Sistem menolak suara ganda dari user yang sama.`,
                        ),
                ],
                flags: MessageFlags.Ephemeral,
            });
        }

        battle.votes.set(voterId, side);
        const ack = await safeDeferUpdate(interaction);
        if (ack && battle.message?.edit) {
            await battle.message.edit(buildBattlePayload(client, battle)).catch(() => {});
        }
    }
}

async function getMusicBattleLeaderboard(client, guildId) {
    if (!client?.musicBattleData) return [];
    const raw = await client.musicBattleData.find({ guildId: String(guildId) }).catch(() => []);
    return (Array.isArray(raw) ? raw : [])
        .map((r) => (typeof r.toObject === "function" ? r.toObject() : r))
        .filter((r) => Number(r.battlesPlayed || 0) > 0)
        .sort((a, b) => b.wins - a.wins || b.totalVotesReceived - a.totalVotesReceived);
}

module.exports = {
    DIFFICULTY_SETTINGS,
    getActiveGuessSession,
    startGuessTheSongGame,
    stopGuessTheSongGame,
    handleGuessTheSongMessage,
    getGuessTheSongLeaderboard,
    startMusicBattleSession,
    finalizeMusicBattle,
    handleMusicBattleInteraction,
    getMusicBattleLeaderboard,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
