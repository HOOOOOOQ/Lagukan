const { PermissionsBitField } = require("discord.js");
const { convertTime } = require("../../functions/timeFormat.js");
const {
    checkSearchRateLimit,
    smartSearch,
    hydrateStoredTrack,
    formatTrackSourceLabel,
    enqueueTracksStaged,
} = require("../../functions/musicSourceResolver.js");
const {
    checkDjAccess,
    isGuildAutoplayEnabled,
    getGuildTrackHistory,
    getOrCreateGuildPlayer,
    isPlayerActivelyPlayingOrPausedTrack,
    startPlayerIfIdle,
} = require("../../functions/musicPermissions.js");
const { cleanupStalePlayerIfDisconnected, getGuildPlayer, performManualLeave } = require("../../functions/voiceSessionManager.js");
const {
    refreshNowPlayingDashboard,
    ensureNowPlayingDashboardVisible,
    cleanupNowPlayingMessage,
    formatRepeatLabel,
    truncateText,
} = require("../../functions/nowPlayingManager.js");
const { recordTrackRequest } = require("../../functions/musicStatsEngine.js");

function getPlaybackSnapshot(client, guildId) {
    const player = getGuildPlayer(client, guildId);
    const current = player?.queue?.current || null;
    const isQuizActive = Boolean(player?.data?.get?.("guessTheSongActive"));

    if (!player || (!player.playing && !player.paused) || !current) {
        return {
            active: false,
            statusLabel: "⏹️ Tidak Ada Musik Aktif",
            currentSongLabel: "Belum ada lagu yang sedang diputar",
            queueSize: player?.queue?.size || 0,
            volume: player?.volume ?? (client?.config?.defaultVolume || 100),
        };
    }

    const stateEmoji = player.paused ? "⏸️ Dijeda" : "▶️ Sedang Memutar";
    const vol = Number.isFinite(player.volume) ? player.volume : 100;
    const loopText = formatRepeatLabel(player.loop);

    if (isQuizActive) {
        return {
            active: true,
            statusLabel: `${stateEmoji} • Vol \`${vol}%\``,
            currentSongLabel: "🔒 Cuplikan Lagu Rahasia (Guess The Song Aktif)",
            queueSize: player.queue?.size || 0,
            volume: vol,
        };
    }

    const title = truncateText(current.title || "Judul Tidak Diketahui", 52);
    const artist = truncateText(current.author || "Artis Tidak Diketahui", 34);
    const dur = current.isStream ? "LIVE" : convertTime(current.duration || 0);

    return {
        active: true,
        statusLabel: `${stateEmoji} • Vol \`${vol}%\` • Loop \`${loopText}\``,
        currentSongLabel: `**${title}** — ${artist} (\`${dur}\`)`,
        queueSize: player.queue?.size || 0,
        volume: vol,
    };
}

function validateUserInSameVoice(client, message, player) {
    const botName = client.config?.botName || "Lagukan";
    const userVcId = message.member?.voice?.channelId || message.member?.voice?.channel?.id || null;

    if (!userVcId) {
        return {
            ok: false,
            error: "Kamu belum bergabung ke Voice Channel. Masuk ke voice channel terlebih dahulu ya!",
        };
    }

    if (player?.voiceId && String(userVcId) !== String(player.voiceId)) {
        return {
            ok: false,
            error: `Kamu harus berada di voice channel yang sama dengan ${botName} (<#${player.voiceId}>) untuk menjalankan perintah ini.`,
        };
    }

    return { ok: true, voiceChannelId: userVcId };
}

async function executeAssistantMusicAction(client, message, parsed) {
    const botName = client.config?.botName || "Lagukan";
    const minVol = Number.isFinite(client.config?.minVolume) ? client.config.minVolume : 1;
    const maxVol = Number.isFinite(client.config?.maxVolume) ? client.config.maxVolume : 100;

    // =========================================================================
    // 1. PLAY (`666 play <query>` / `666 putar lagu <query>`)
    // =========================================================================
    if (parsed.action === "play") {
        if (!parsed.query) {
            return {
                isError: true,
                emoji: "⚠️",
                title: "Judul Lagu Belum Disebutkan",
                description:
                    "Sebutkan judul lagu, nama artis, atau link musik yang ingin diputar.\n\n**Contoh:**\n• `666 play Teh Hijau`\n• `666 putar lagu Sheila On 7`",
            };
        }

        const voiceChannel = message.member?.voice?.channel || null;
        const userVcId = voiceChannel?.id || message.member?.voice?.channelId || null;

        if (!userVcId) {
            return {
                isError: true,
                emoji: "🔊",
                title: "Masuk ke Voice Channel Dulu",
                description: `Kamu harus masuk ke **Voice Channel** terlebih dahulu agar 666 bisa memutarkan **${truncateText(parsed.query, 60)}**.`,
            };
        }

        if (voiceChannel?.permissionsFor && message.guild?.members?.me) {
            const perms = voiceChannel.permissionsFor(message.guild.members.me);
            if (perms && (!perms.has(PermissionsBitField.Flags.Connect) || !perms.has(PermissionsBitField.Flags.Speak))) {
                return {
                    isError: true,
                    emoji: "🔒",
                    title: "Izin Voice Channel Kurang",
                    description: `${botName} membutuhkan izin \`Connect\` dan \`Speak\` pada voice channel <#${userVcId}>.`,
                };
            }
        }

        const rate = checkSearchRateLimit(message.author.id);
        if (!rate.allowed) {
            return {
                isError: true,
                emoji: "⏳",
                title: "Pencarian Terlalu Cepat",
                description: `Tunggu \`${Math.ceil(rate.retryAfterMs / 1000)} detik\` sebelum mencari lagu lagi ya.`,
            };
        }

        const existingPlayer = (await cleanupStalePlayerIfDisconnected(client, message.guild)) || null;
        if (existingPlayer?.voiceId && String(existingPlayer.voiceId) !== String(userVcId)) {
            return {
                isError: true,
                emoji: "⚠️",
                title: "Voice Channel Berbeda",
                description: `${botName} sedang aktif memutar musik di <#${existingPlayer.voiceId}>. Bergabunglah ke sana untuk menambahkan lagu.`,
            };
        }

        const searchResult = await smartSearch(client, parsed.query, {
            requester: message.author,
        });

        if (!searchResult || !Array.isArray(searchResult.tracks) || searchResult.tracks.length === 0) {
            return {
                isError: true,
                emoji: "🔍",
                title: "Lagu Tidak Ditemukan",
                description:
                    searchResult?.error ||
                    `666 tidak menemukan hasil untuk **${truncateText(parsed.query, 60)}**. Coba gunakan kata kunci judul dan nama artis yang lebih spesifik.`,
            };
        }

        let player;
        try {
            player = await getOrCreateGuildPlayer(client, {
                guild: message.guild,
                voiceChannelId: userVcId,
                textChannelId: message.channelId || message.channel?.id,
            });
        } catch (err) {
            return {
                isError: true,
                emoji: "❌",
                title: "Gagal Terhubung ke Voice Channel",
                description: err?.message || "Tidak dapat menghubungkan pemutar musik ke voice channel saat ini.",
            };
        }

        const wasPlaying = isPlayerActivelyPlayingOrPausedTrack(player);

        // Handle Playlist URLs
        if (searchResult.type === "PLAYLIST") {
            const staged = enqueueTracksStaged(client, player, searchResult.tracks, { chunkSize: 50 });
            await recordTrackRequest(client, {
                guildId: message.guild.id,
                userId: message.author.id,
                track: searchResult.tracks[0],
                count: staged.totalScheduled,
                requestOrigin: "666_assistant",
            }).catch(() => {});

            if (!wasPlaying) {
                const outcome = await startPlayerIfIdle(client, player, {
                    guild: message.guild,
                    userId: message.author.id,
                    command: "666_play_playlist",
                    waitForTrackStart: true,
                    timeoutMs: 9000,
                });

                if (!outcome.ok) {
                    return {
                        isError: true,
                        emoji: "❌",
                        title: "Gagal Memulai Playlist",
                        description: outcome.error || "Lavalink gagal memulai pemutaran playlist.",
                    };
                }

                await ensureNowPlayingDashboardVisible(client, player, outcome.track || searchResult.tracks[0]).catch(() => {});
            } else {
                await refreshNowPlayingDashboard(client, player).catch(() => {});
            }

            return {
                isError: false,
                emoji: "📚",
                title: "Playlist Ditambahkan ke Antrean",
                description: `Berhasil memuat **${staged.totalScheduled}** lagu dari playlist **${truncateText(searchResult.playlistName || "Playlist", 60)}** ke antrean musik!`,
            };
        }

        // Handle Single Track
        const track = searchResult.tracks[0];
        player.queue.add(track);
        await recordTrackRequest(client, {
            guildId: message.guild.id,
            userId: message.author.id,
            track,
            count: 1,
            requestOrigin: "666_assistant",
        }).catch(() => {});

        const title = truncateText(track.title || "Judul Tidak Diketahui", 60);
        const artist = truncateText(track.author || "Artis Tidak Diketahui", 42);
        const dur = track.isStream ? "LIVE" : convertTime(track.duration || 0);
        const source = formatTrackSourceLabel(track);
        const uri = track.pluginInfo?.originalUri || track.uri;
        const formattedTrack = uri ? `**[${title}](${uri})**` : `**${title}**`;

        if (wasPlaying) {
            await refreshNowPlayingDashboard(client, player).catch(() => {});
            return {
                isError: false,
                emoji: "📥",
                title: "Ditambahkan ke Antrean Musik",
                description: `${formattedTrack}\noleh **${artist}**\n\n• **Durasi:** \`${dur}\` • **Sumber:** \`${source}\` • **Posisi Antrean:** \`#${player.queue.size}\``,
                thumbnail: track.artworkUrl || null,
            };
        }

        const outcome = await startPlayerIfIdle(client, player, {
            guild: message.guild,
            userId: message.author.id,
            command: "666_play",
            waitForTrackStart: true,
            timeoutMs: 9000,
        });

        if (!outcome.ok) {
            return {
                isError: true,
                emoji: "❌",
                title: "Gagal Memutar Lagu",
                description: `666 tidak dapat memutar ${formattedTrack}.\n**Alasan:** ${outcome.error || "Stream audio gagal dimuat pada Lavalink."}`,
            };
        }

        const startedTrack = outcome.track || player.queue?.current || track;
        await ensureNowPlayingDashboardVisible(client, player, startedTrack).catch(() => {});

        return {
            isError: false,
            emoji: "🎵",
            title: "Mulai Memutar Musik",
            description: `${formattedTrack}\noleh **${artist}**\n\n• **Durasi:** \`${dur}\` • **Sumber:** \`${source}\` • **Diminta oleh:** <@${message.author.id}>`,
            thumbnail: startedTrack.artworkUrl || track.artworkUrl || null,
        };
    }

    // =========================================================================
    // Check Active Player for All Remaining Player Commands
    // =========================================================================
    const player = getGuildPlayer(client, message.guild?.id);
    if (!player) {
        return {
            isError: true,
            emoji: "⏹️",
            title: "Belum Ada Pemutar Musik Aktif",
            description: `${botName} saat ini belum berada di voice channel atau belum memutar lagu. Ketik \`666 play <judul lagu>\` untuk mulai memutar musik!`,
        };
    }

    // =========================================================================
    // 2. NOW PLAYING (`666 sekarang putar apa`) & QUEUE (`666 queue`) — Read-Only
    // =========================================================================
    if (parsed.action === "nowplaying") {
        const current = player.queue?.current;
        if (!current) {
            return {
                isError: true,
                emoji: "🔇",
                title: "Tidak Ada Lagu yang Diputar",
                description: "Saat ini tidak ada lagu yang sedang diputar. Ketik `666 play <judul lagu>` untuk memulai!",
            };
        }

        if (player.data?.get?.("guessTheSongActive")) {
            return {
                isError: false,
                emoji: "🎮",
                title: "Sesi Guess The Song Sedang Berlangsung",
                description: "Judul lagu sedang dirahasiakan sampai ronde tebak lagu berakhir!",
            };
        }

        await refreshNowPlayingDashboard(client, player).catch(() => {});
        const title = truncateText(current.title || "Judul Tidak Diketahui", 65);
        const artist = truncateText(current.author || "Artis Tidak Diketahui", 45);
        const elapsed = convertTime(player.position || 0);
        const total = current.isStream ? "LIVE" : convertTime(current.duration || 0);
        const source = formatTrackSourceLabel(current);
        const reqId = current.requester?.id;

        return {
            isError: false,
            emoji: "🎧",
            title: "Sedang Diputar Sekarang",
            description:
                `**${title}**\noleh **${artist}**\n\n` +
                `• **Waktu:** \`${elapsed} / ${total}\`\n` +
                `• **Sumber:** \`${source}\`\n` +
                `• **Volume:** \`${player.volume}%\`\n` +
                `• **Antrean Berikutnya:** \`${player.queue.size}\` lagu` +
                (reqId ? `\n• **Requester:** <@${reqId}>` : ""),
            thumbnail: current.artworkUrl || null,
        };
    }

    if (parsed.action === "queue") {
        const current = player.queue?.current;
        if (!current && player.queue.isEmpty) {
            return {
                isError: true,
                emoji: "📜",
                title: "Antrean Musik Kosong",
                description: "Belum ada lagu di dalam antrean. Tambahkan lagu dengan mengetik `666 play <judul lagu>`!",
            };
        }

        const lines = [];
        if (current) {
            const isQuiz = Boolean(player.data?.get?.("guessTheSongActive"));
            const curLabel = isQuiz
                ? "🔒 Cuplikan Lagu Rahasia"
                : `**${truncateText(current.title, 48)}** — ${truncateText(current.author || "Unknown", 28)} (\`${current.isStream ? "LIVE" : convertTime(current.duration || 0)}\`)`;
            lines.push(`**Sedang Diputar:**\n▶️ ${curLabel}`);
        }

        if (player.queue.size > 0) {
            const preview = player.queue.slice(0, 10).map((t, idx) => {
                const dur = t.isStream ? "LIVE" : convertTime(t.duration || 0);
                return `\`${idx + 1}.\` **${truncateText(t.title, 44)}** — ${truncateText(t.author || "Unknown", 24)} (\`${dur}\`)`;
            });
            lines.push(`\n**Antrean Berikutnya (${player.queue.size} lagu):**\n${preview.join("\n")}`);
            if (player.queue.size > 10) {
                lines.push(`\n*...dan \`${player.queue.size - 10}\` lagu lainnya (gunakan \`/queue\` untuk navigasi halaman penuh).*`);
            }
        } else {
            lines.push("\n*Belum ada lagu berikutnya di antrean.*");
        }

        return {
            isError: false,
            emoji: "📜",
            title: "Daftar Antrean Musik",
            description: lines.join("\n"),
        };
    }

    // Read-only volume check (`666 volume` without number)
    if (parsed.action === "volume" && parsed.value === null) {
        return {
            isError: false,
            emoji: "🔊",
            title: "Informasi Volume Pemutar",
            description: `Volume pemutar musik saat ini berada pada **\`${player.volume}%\`**.\nKetik \`666 volume <${minVol}-${maxVol}>\` untuk mengubahnya.`,
        };
    }

    // =========================================================================
    // 3. Mutating Controls — Require Same Voice Channel + DJ Permission Check
    // =========================================================================
    const sameVc = validateUserInSameVoice(client, message, player);
    if (!sameVc.ok) {
        return {
            isError: true,
            emoji: "🔊",
            title: "Akses Voice Channel Diperlukan",
            description: sameVc.error,
        };
    }

    const allowRequester = ["pause", "resume", "skip"].includes(parsed.action);
    const djCheck = checkDjAccess(client, {
        guild: message.guild,
        member: message.member,
        user: message.author,
        player,
        track: player.queue?.current || null,
        allowRequester,
        interaction: message,
    });

    if (!djCheck.allowed) {
        return {
            isError: true,
            emoji: "🛡️",
            title: "Akses DJ Diperlukan",
            description:
                djCheck.reason || "Server ini mengaktifkan DJ Mode. Hanya pemilik DJ Role atau Admin yang dapat menjalankan kontrol ini.",
        };
    }

    if (parsed.action === "leave") {
        await performManualLeave(client, message.guild, player);
        return {
            isError: false,
            emoji: "👋",
            title: "Keluar dari Voice Channel",
            description: "666 telah menghentikan musik dan keluar dari voice channel. Sampai jumpa lagi!",
        };
    }

    if (parsed.action === "previous") {
        const prevList = Array.isArray(player.queue?.previous) ? player.queue.previous : [];
        if (prevList.length > 0) {
            const target = prevList[prevList.length - 1];
            if (player.queue.current) {
                await Promise.resolve(player.previous());
            } else {
                prevList.pop();
                await Promise.resolve(player.play(target));
            }
            return {
                isError: false,
                emoji: "⏮️",
                title: "Memutar Lagu Sebelumnya",
                description: `Kembali memutar **${truncateText(target?.title || "Lagu Sebelumnya", 55)}**.`,
            };
        }

        const history = await getGuildTrackHistory(client, message.guild);
        const fallbackEntry = player.queue?.current ? history[1] : history[0];
        if (!fallbackEntry) {
            return {
                isError: true,
                emoji: "⏮️",
                title: "Belum Ada Lagu Sebelumnya",
                description: "Belum ada riwayat lagu sebelumnya pada sesi ini.",
            };
        }

        const hydrated = hydrateStoredTrack(client, fallbackEntry, message.author);
        await Promise.resolve(player.play(hydrated));
        return {
            isError: false,
            emoji: "⏮️",
            title: "Memutar Lagu Sebelumnya",
            description: `Memutar kembali dari riwayat: **${truncateText(fallbackEntry.title, 55)}**.`,
        };
    }

    // Remaining controls require a current track
    if (!player.queue?.current) {
        return {
            isError: true,
            emoji: "🔇",
            title: "Tidak Ada Lagu yang Sedang Diputar",
            description: "Saat ini belum ada lagu aktif di pemutar. Ketik `666 play <judul lagu>` terlebih dahulu.",
        };
    }

    if (parsed.action === "pause") {
        if (player.paused) {
            return {
                isError: true,
                emoji: "⏸️",
                title: "Musik Sudah Dijeda",
                description: "Pemutaran lagu saat ini memang sudah dalam keadaan dijeda. Ketik `666 resume` untuk melanjutkan.",
            };
        }

        await Promise.resolve(player.pause());
        await refreshNowPlayingDashboard(client, player).catch(() => {});
        return {
            isError: false,
            emoji: "⏸️",
            title: "Musik Berhasil Dijeda",
            description: `Pemutaran **${truncateText(player.queue.current.title, 55)}** telah dijeda. Ketik \`666 resume\` untuk melanjutkan kembali.`,
        };
    }

    if (parsed.action === "resume") {
        if (!player.paused) {
            return {
                isError: true,
                emoji: "▶️",
                title: "Musik Sedang Berjalan",
                description: "Lagu saat ini tidak sedang dijeda dan masih terus diputar.",
            };
        }

        await Promise.resolve(player.resume());
        await refreshNowPlayingDashboard(client, player).catch(() => {});
        return {
            isError: false,
            emoji: "▶️",
            title: "Pemutaran Musik Dilanjutkan",
            description: `Melanjutkan pemutaran **${truncateText(player.queue.current.title, 55)}**.`,
        };
    }

    if (parsed.action === "skip") {
        const skippedTitle = truncateText(player.queue.current.title || "Lagu Saat Ini", 52);
        const nextTrack = player.queue[0] || null;

        if (player.queue.isEmpty && !isGuildAutoplayEnabled(client, player.guildId)) {
            return {
                isError: true,
                emoji: "⏭️",
                title: "Antrean Berikutnya Kosong",
                description:
                    "Tidak ada lagu berikutnya di antrean. Tambahkan lagu baru lewat `666 play <judul>`, aktifkan `/autoplay`, atau gunakan `666 stop` untuk menghentikan musik.",
            };
        }

        await Promise.resolve(player.skip());
        const nextHint = nextTrack ? `\nLagu berikutnya: **${truncateText(nextTrack.title, 52)}**` : "";
        return {
            isError: false,
            emoji: "⏭️",
            title: "Lagu Berhasil Dilewati",
            description: `Melewati **${skippedTitle}**.${nextHint}`,
        };
    }

    if (parsed.action === "stop") {
        const stoppedTitle = truncateText(player.queue.current.title || "Lagu Saat Ini", 52);
        player._manualStopAt = Date.now();
        await cleanupNowPlayingMessage(player, true).catch(() => {});
        player.queue.clear();
        player.data?.set?.("shuffled", false);
        await Promise.resolve(player.stop());

        return {
            isError: false,
            emoji: "⏹️",
            title: "Pemutaran Musik Dihentikan",
            description: `Menghentikan **${stoppedTitle}** dan membersihkan seluruh antrean musik.`,
        };
    }

    if (parsed.action === "volume") {
        const targetVol = Number(parsed.value);
        if (!Number.isInteger(targetVol) || targetVol < minVol || targetVol > maxVol) {
            return {
                isError: true,
                emoji: "⚠️",
                title: "Nilai Volume Tidak Valid",
                description: `Masukkan angka volume antara **\`${minVol}\`** hingga **\`${maxVol}\`**. Contoh: \`666 volume 50\`.`,
            };
        }

        await Promise.resolve(player.setVolume(targetVol));
        await refreshNowPlayingDashboard(client, player).catch(() => {});

        return {
            isError: false,
            emoji: "🔊",
            title: "Volume Berhasil Diatur",
            description: `Volume pemutar musik telah diatur menjadi **\`${targetVol}%\`**.`,
        };
    }

    if (parsed.action === "shuffle") {
        if (player.queue.size <= 1) {
            return {
                isError: true,
                emoji: "🔀",
                title: "Belum Cukup Lagu untuk Diacak",
                description: "Dibutuhkan minimal 2 lagu di dalam antrean berikutnya untuk mengacak urutan.",
            };
        }

        player.queue.shuffle();
        player.data?.set?.("shuffled", true);
        await refreshNowPlayingDashboard(client, player).catch(() => {});

        return {
            isError: false,
            emoji: "🔀",
            title: "Antrean Berhasil Diacak",
            description: `Berhasil mengacak urutan **\`${player.queue.size}\`** lagu di dalam antrean.`,
        };
    }

    if (parsed.action === "loop") {
        const nextMode = parsed.mode || (player.loop === "none" ? "song" : player.loop === "song" ? "queue" : "none");
        player.setLoop(nextMode);
        await refreshNowPlayingDashboard(client, player).catch(() => {});

        const modeText =
            nextMode === "song"
                ? "Ulangi Lagu Saat Ini (Track)"
                : nextMode === "queue"
                  ? "Ulangi Seluruh Antrean (Queue)"
                  : "Nonaktif (Off)";
        return {
            isError: false,
            emoji: "🔁",
            title: "Mode Loop Diperbarui",
            description: `Mode perulangan musik diatur ke: **${modeText}**.`,
        };
    }

    return {
        isError: true,
        emoji: "❓",
        title: "Perintah Musik Tidak Dikenali",
        description: "Ketik `666 help` untuk melihat daftar perintah musik yang tersedia.",
    };
}

module.exports = {
    getPlaybackSnapshot,
    executeAssistantMusicAction,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
