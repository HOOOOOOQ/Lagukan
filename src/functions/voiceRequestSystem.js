const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags,
    ModalBuilder,
    PermissionsBitField,
    StringSelectMenuBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");
const {
    sanitizeMusicQuery,
    checkSearchRateLimit,
    smartSearch,
    enqueueTracksStaged,
    formatTrackSourceLabel,
    detectMusicQuery,
} = require("./musicSourceResolver.js");
const { getOrCreateGuildPlayer, isPlayerActivelyPlayingOrPausedTrack, startPlayerIfIdle } = require("./musicPermissions.js");
const { getPremiumAccess } = require("./premiumSystem.js");
const { recordTrackRequest } = require("./musicStatsEngine.js");
const { getGuildPlayer } = require("./voiceSessionManager.js");
const { refreshNowPlayingDashboard, ensureNowPlayingDashboardVisible, truncateText } = require("./nowPlayingManager.js");
const { convertTime } = require("./timeFormat.js");
const { safeReply, safeEditReply, safeDeferReply, safeDeferUpdate } = require("./interactionResponder.js");

// Cache: Map<guildId, ConfigPlainObject>
const requestConfigCache = new Map();
// Cooldown: Map<`${guildId}:${userId}`, number>
const requestUserCooldowns = new Map();

async function getGuildRequestConfig(client, guildId) {
    if (!guildId || !client?.musicRequestConfigData) return null;
    const gid = String(guildId);
    if (requestConfigCache.has(gid)) {
        return requestConfigCache.get(gid);
    }
    const doc = await client.musicRequestConfigData.findOne({ guildId: gid }).catch(() => null);
    const plain = doc ? (typeof doc.toObject === "function" ? doc.toObject() : doc) : null;
    requestConfigCache.set(gid, plain);
    return plain;
}

async function saveGuildRequestConfig(client, guildId, patch = {}) {
    if (!guildId || !client?.musicRequestConfigData) return null;
    const gid = String(guildId);
    const updated = await client.musicRequestConfigData.findOneAndUpdate(
        { guildId: gid },
        { $set: { guildId: gid, ...patch } },
        { upsert: true, returnDocument: "after" },
    );
    const plain = typeof updated?.toObject === "function" ? updated.toObject() : updated;
    requestConfigCache.set(gid, plain);
    return plain;
}

function buildRequestPanelPayload(client, guild, configDoc) {
    const botName = client.config?.botName || "Lagukan";
    const iconUrl = client.user?.displayAvatarURL?.() || undefined;
    const color = client.config?.embedColor || "#5865F2";
    const player = getGuildPlayer(client, guild.id);
    const current = player?.queue?.current || null;

    const statusBlock = current
        ? `▶️ **Sedang Diputar:** **${truncateText(current.title, 48)}** — ${truncateText(current.author, 32)}\n` +
          `📋 **Antrean:** \`${player.queue?.size || 0}\` lagu berikutnya • 🔊 Volume: \`${player.volume ?? 100}%\``
        : `⏹️ **Status Player:** Belum ada musik diputar. Kirim judul lagu/link di channel ini atau klik tombol di bawah!`;

    const embed = new EmbedBuilder()
        .setColor(color)
        .setAuthor({ name: `${botName} • Voice Channel Music Request Panel`, iconURL: iconUrl })
        .setTitle("🎧 Request Musik Tanpa Perlu Ketik /play")
        .setDescription(
            `${statusBlock}\n\n` +
                `**Cara Request Lagu:**\n` +
                `1️⃣ Ketik langsung **judul lagu** atau **tempel link musik** di channel ini, **ATAU**\n` +
                `2️⃣ Klik **Request Judul / Link** untuk mengirim lewat form, **ATAU**\n` +
                `3️⃣ Klik **Cari & Pilih Lagu** untuk memilih dari daftar hasil pencarian.\n\n` +
                `**Batas & Proteksi Aktif:**\n` +
                `• Cooldown Request: \`${configDoc?.cooldownSec ?? 10} detik\`\n` +
                `• Maks. Antrean Aktif per User: \`${configDoc?.maxQueuePerUser ?? 5} lagu\` *(2x untuk Premium)*\n` +
                `• Mode Input: \`${configDoc?.linksOnly ? "Hanya Link Musik Didukung" : "Judul Lagu & Link Musik"}\``,
        )
        .setFooter({
            text: `Sumber didukung: YouTube • YT Music • Spotify • SoundCloud • Deezer • Bandcamp • Direct Audio`,
            iconURL: iconUrl,
        })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("mreq:modal_play").setEmoji("🎵").setLabel("Request Judul / Link").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("mreq:modal_search").setEmoji("🔎").setLabel("Cari & Pilih Lagu").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("mreq:status").setEmoji("📋").setLabel("Status Request & Queue").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("mreq:refresh").setEmoji("🔄").setLabel("Refresh Panel").setStyle(ButtonStyle.Success),
    );

    return { embeds: [embed], components: [row] };
}

async function refreshRequestPanelMessage(client, guildId) {
    const cfg = await getGuildRequestConfig(client, guildId);
    if (!cfg?.enabled || !cfg.channelId || !cfg.messageId) return false;
    const guild = client.guilds?.cache?.get?.(String(guildId));
    const channel = guild?.channels?.cache?.get?.(cfg.channelId) || client.channels?.cache?.get?.(cfg.channelId);
    if (!channel?.messages?.fetch) return false;

    const msg = await channel.messages.fetch(cfg.messageId).catch(() => null);
    if (!msg || typeof msg.edit !== "function") return false;

    const payload = buildRequestPanelPayload(client, guild || { id: guildId }, cfg);
    await msg.edit(payload).catch(() => {});
    return true;
}

function validateVoiceAndPermissionsForRequest(client, guild, member) {
    const voiceChannel = member?.voice?.channel;
    if (!voiceChannel) {
        return { ok: false, error: "Kamu harus masuk ke **Voice Channel** terlebih dahulu untuk request lagu." };
    }

    const existingPlayer = getGuildPlayer(client, guild.id);
    if (existingPlayer?.voiceId && String(existingPlayer.voiceId) !== String(voiceChannel.id)) {
        return {
            ok: false,
            error: ` Kamu harus berada di voice channel yang sama dengan bot (<#${existingPlayer.voiceId}>).`,
        };
    }

    const botMember = guild?.members?.me;
    if (botMember && typeof voiceChannel.permissionsFor === "function") {
        const perms = voiceChannel.permissionsFor(botMember);
        if (perms) {
            const missing = [];
            if (!perms.has(PermissionsBitField.Flags.ViewChannel)) missing.push("ViewChannel");
            if (!perms.has(PermissionsBitField.Flags.Connect)) missing.push("Connect");
            if (voiceChannel.type !== 13 && !perms.has(PermissionsBitField.Flags.Speak)) missing.push("Speak");
            if (missing.length > 0) {
                return {
                    ok: false,
                    error: `Bot kekurangan izin \`${missing.join(", ")}\` di voice channel ${voiceChannel}.`,
                };
            }
        }
    }

    return { ok: true, voiceChannel };
}

function validateRequestInputAndLimits(client, { guildId, userId, query, cfg, effectiveMaxQueue }) {
    const clean = sanitizeMusicQuery(query);
    if (!clean || clean.length < 2) {
        return { ok: false, error: "Masukkan judul lagu atau link musik yang valid (minimal 2 karakter)." };
    }

    const rate = checkSearchRateLimit(userId);
    if (!rate.allowed) {
        return {
            ok: false,
            error: `Proteksi anti-spam aktif. Tunggu \`${Math.ceil(rate.retryAfterMs / 1000)}d\` sebelum mengirim request lagi.`,
        };
    }

    const cdSec = Math.max(2, Number(cfg?.cooldownSec ?? 10));
    const cdKey = `${guildId}:${userId}`;
    const lastReqAt = requestUserCooldowns.get(cdKey) || 0;
    const now = Date.now();
    if (now - lastReqAt < cdSec * 1000) {
        const waitSec = Math.ceil((cdSec * 1000 - (now - lastReqAt)) / 1000);
        return { ok: false, error: `Cooldown request aktif. Tunggu \`${waitSec} detik\` lagi.` };
    }

    const isUrl = /^https?:\/\//i.test(clean);
    if (cfg?.linksOnly && !isUrl) {
        return { ok: false, error: "Channel request ini diatur hanya menerima **link musik resmi**." };
    }

    if (isUrl) {
        const detected = detectMusicQuery ? detectMusicQuery(clean) : null;
        if (detected && (detected.type === "unsupported_url" || detected.type === "blocked_url")) {
            return { ok: false, error: detected.reason || "Link tersebut tidak didukung atau diblokir demi keamanan." };
        }
    }

    const player = getGuildPlayer(client, guildId);
    if (player && Array.isArray(player.queue)) {
        const userQueuedCount = player.queue.filter((t) => String(t?.requester?.id || "") === String(userId)).length;
        if (userQueuedCount >= effectiveMaxQueue) {
            return {
                ok: false,
                error: `Kamu sudah memiliki \`${userQueuedCount}/${effectiveMaxQueue}\` lagu di antrean saat ini. Tunggu lagu sebelumnya diputar dulu ya!`,
            };
        }
    }

    return { ok: true, cleanQuery: clean };
}

async function processValidatedSongRequest(client, { guild, member, user, textChannelId, cleanQuery, cfg, effectiveMaxQueue }) {
    const voiceCheck = validateVoiceAndPermissionsForRequest(client, guild, member);
    if (!voiceCheck.ok) return voiceCheck;

    const searchRes = await smartSearch(client, cleanQuery, { requester: user });
    if (!searchRes?.tracks?.length) {
        return { ok: false, error: searchRes?.error || `Tidak ditemukan hasil lagu yang cocok untuk \`${cleanQuery}\`.` };
    }

    let player;
    try {
        player = await getOrCreateGuildPlayer(client, {
            guild,
            voiceChannelId: voiceCheck.voiceChannel.id,
            textChannelId,
        });
    } catch (err) {
        return { ok: false, error: err?.message || "Gagal menghubungkan player ke voice channel." };
    }

    requestUserCooldowns.set(`${guild.id}:${user.id}`, Date.now());

    const wasActive = isPlayerActivelyPlayingOrPausedTrack(player);
    const isPlaylist = searchRes.type === "PLAYLIST" && searchRes.tracks.length > 1;
    const currentUserQueued = Array.isArray(player.queue)
        ? player.queue.filter((t) => String(t?.requester?.id || "") === String(user.id)).length
        : 0;
    const remainingUserSlots = Math.max(1, effectiveMaxQueue - currentUserQueued);

    if (isPlaylist) {
        const slice = searchRes.tracks.slice(0, remainingUserSlots);
        enqueueTracksStaged(client, player, slice, { chunkSize: 50 });
        await recordTrackRequest(client, { guildId: guild.id, userId: user.id, count: slice.length });
    } else {
        player.queue.add(searchRes.tracks[0]);
        await recordTrackRequest(client, { guildId: guild.id, userId: user.id, count: 1 });
    }

    if (!wasActive) {
        const startRes = await startPlayerIfIdle(client, player, {
            guild,
            userId: user.id,
            command: "musicrequest",
            waitForTrackStart: true,
            timeoutMs: 8000,
        });
        if (!startRes.ok) {
            return { ok: false, error: startRes.error || "Gagal memulai audio pada Lavalink." };
        }
        await ensureNowPlayingDashboardVisible(client, player, startRes.track || searchRes.tracks[0]);
    } else {
        await refreshNowPlayingDashboard(client, player).catch(() => {});
    }

    await refreshRequestPanelMessage(client, guild.id).catch(() => {});

    const first = searchRes.tracks[0];
    return {
        ok: true,
        wasActive,
        isPlaylist,
        track: first,
        addedCount: isPlaylist ? Math.min(searchRes.tracks.length, remainingUserSlots) : 1,
        sourceLabel: formatTrackSourceLabel(first),
        queueSize: player.queue?.size || 0,
    };
}

/**
 * Handles plain text / URL messages sent inside a configured Music Request Channel.
 */
async function handleRequestChannelMessage(client, message) {
    if (!message?.guild || !message?.channel || message.author?.bot) return false;
    const cfg = await getGuildRequestConfig(client, message.guild.id);
    if (!cfg?.enabled || !cfg.channelId || String(cfg.channelId) !== String(message.channel.id)) {
        return false;
    }

    // Do not intercept prefix commands like 666!cek or !eval
    const rawContent = String(message.content || "").trim();
    if (!rawContent || /^666!cek\b/i.test(rawContent) || rawContent.startsWith(client.config?.prefix || "!")) {
        return false;
    }

    if (cfg.autoDeleteUserMessage !== false && typeof message.delete === "function") {
        await message.delete().catch(() => {});
    }

    const premium = await getPremiumAccess(client, { userId: message.author.id, guildId: message.guild.id });
    const baseMax = Math.max(1, Number(cfg.maxQueuePerUser || 5));
    const effectiveMaxQueue = premium.isPremium ? Math.max(baseMax * 2, 15) : baseMax;

    const inputCheck = validateRequestInputAndLimits(client, {
        guildId: message.guild.id,
        userId: message.author.id,
        query: rawContent,
        cfg,
        effectiveMaxQueue,
    });

    const color = client.config?.embedColor || "#5865F2";
    const sendTempNotice = async (embed, ms = 10000) => {
        const sent = await message.channel.send({ content: `<@${message.author.id}>`, embeds: [embed] }).catch(() => null);
        if (sent && typeof sent.delete === "function") {
            const t = setTimeout(() => sent.delete().catch(() => {}), ms);
            if (typeof t.unref === "function") t.unref();
        }
    };

    if (!inputCheck.ok) {
        await sendTempNotice(new EmbedBuilder().setColor(color).setDescription(`⚠️ ${inputCheck.error}`));
        return true;
    }

    const res = await processValidatedSongRequest(client, {
        guild: message.guild,
        member: message.member,
        user: message.author,
        textChannelId: message.channel.id,
        cleanQuery: inputCheck.cleanQuery,
        cfg,
        effectiveMaxQueue,
    });

    if (!res.ok) {
        await sendTempNotice(new EmbedBuilder().setColor(color).setDescription(`❌ **Request Gagal:** ${res.error}`));
        return true;
    }

    const okEmbed = new EmbedBuilder()
        .setColor(color)
        .setDescription(
            res.isPlaylist
                ? `✅ **Request Berhasil!** Menambahkan \`${res.addedCount}\` lagu ke antrean.`
                : res.wasActive
                  ? `✅ **Ditambahkan ke Antrean:** **${truncateText(res.track.title, 48)}** — ${truncateText(res.track.author, 30)} (\`${res.sourceLabel}\`)`
                  : `▶️ **Mulai Memutar Request:** **${truncateText(res.track.title, 48)}** — ${truncateText(res.track.author, 30)} (\`${res.sourceLabel}\`)`,
        );
    await sendTempNotice(okEmbed, 12000);
    return true;
}

/**
 * Handles permanent Request Panel button & modal interactions (`customId.startsWith("mreq:")`).
 */
async function handleRequestPanelInteraction(client, interaction) {
    const customId = String(interaction.customId || "");
    const guild = interaction.guild;
    const color = client.config?.embedColor || "#5865F2";
    const cfg = await getGuildRequestConfig(client, guild.id);

    if (!cfg?.enabled) {
        const offEmbed = new EmbedBuilder()
            .setColor(color)
            .setDescription("Sistem Voice Channel Request sedang dinonaktifkan oleh admin server.");
        return safeReply(interaction, { embeds: [offEmbed], flags: MessageFlags.Ephemeral });
    }

    if (customId === "mreq:refresh") {
        const ack = await safeDeferUpdate(interaction);
        if (!ack) return;
        const payload = buildRequestPanelPayload(client, guild, cfg);
        if (interaction.message?.edit) {
            await interaction.message.edit(payload).catch(() => {});
        }
        return;
    }

    if (customId === "mreq:status") {
        const player = getGuildPlayer(client, guild.id);
        const current = player?.queue?.current;
        const userCount = Array.isArray(player?.queue)
            ? player.queue.filter((t) => String(t?.requester?.id || "") === String(interaction.user.id)).length
            : 0;
        const premium = await getPremiumAccess(client, { userId: interaction.user.id, guildId: guild.id });
        const maxQ = premium.isPremium ? Math.max((cfg.maxQueuePerUser || 5) * 2, 15) : cfg.maxQueuePerUser || 5;

        const statusEmbed = new EmbedBuilder()
            .setColor(color)
            .setTitle("📋 Status Request & Player Server")
            .setDescription(
                (current
                    ? `▶️ **Lagu Aktif:** **${current.title}** — ${current.author}\n`
                    : `⏹️ **Lagu Aktif:** Tidak ada lagu diputar\n`) +
                    `📚 **Total Antrean Server:** \`${player?.queue?.size || 0}\` lagu\n` +
                    `🙋 **Request Aktif Milikmu:** \`${userCount} / ${maxQ}\` lagu`,
            );
        return safeReply(interaction, { embeds: [statusEmbed], flags: MessageFlags.Ephemeral });
    }

    if (customId === "mreq:modal_play" || customId === "mreq:modal_search") {
        if (typeof interaction.showModal !== "function") return;
        const isSearchMode = customId === "mreq:modal_search";
        const modal = new ModalBuilder()
            .setCustomId(isSearchMode ? "mreq:submit_search" : "mreq:submit_play")
            .setTitle(isSearchMode ? "Cari & Pilih Lagu" : "Request Judul / Link Musik")
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId("query")
                        .setLabel(isSearchMode ? "Kata Kunci Pencarian (Judul / Artis)" : "Judul Lagu atau Link Musik")
                        .setStyle(TextInputStyle.Short)
                        .setMinLength(2)
                        .setMaxLength(300)
                        .setPlaceholder("Contoh: Hindia Secukupnya atau https://open.spotify.com/track/...")
                        .setRequired(true),
                ),
            );
        await interaction.showModal(modal).catch(() => {});
        return;
    }

    if (customId === "mreq:submit_play" || customId === "mreq:submit_search") {
        const rawQuery = interaction.fields?.getTextInputValue?.("query") || "";
        const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const premium = await getPremiumAccess(client, { userId: interaction.user.id, guildId: guild.id });
        const baseMax = Math.max(1, Number(cfg.maxQueuePerUser || 5));
        const effectiveMaxQueue = premium.isPremium ? Math.max(baseMax * 2, 15) : baseMax;

        const inputCheck = validateRequestInputAndLimits(client, {
            guildId: guild.id,
            userId: interaction.user.id,
            query: rawQuery,
            cfg,
            effectiveMaxQueue,
        });
        if (!inputCheck.ok) {
            return safeEditReply(interaction, {
                embeds: [new EmbedBuilder().setColor(color).setDescription(`⚠️ ${inputCheck.error}`)],
            });
        }

        if (customId === "mreq:submit_play") {
            const res = await processValidatedSongRequest(client, {
                guild,
                member: interaction.member,
                user: interaction.user,
                textChannelId: cfg.channelId || interaction.channelId,
                cleanQuery: inputCheck.cleanQuery,
                cfg,
                effectiveMaxQueue,
            });

            if (!res.ok) {
                return safeEditReply(interaction, {
                    embeds: [new EmbedBuilder().setColor(color).setDescription(`❌ **Request Gagal:** ${res.error}`)],
                });
            }

            return safeEditReply(interaction, {
                embeds: [
                    new EmbedBuilder()
                        .setColor(color)
                        .setDescription(
                            res.isPlaylist
                                ? `✅ Menambahkan \`${res.addedCount}\` lagu ke antrean server!`
                                : `✅ **${truncateText(res.track.title, 48)}** — ${truncateText(res.track.author, 32)} berhasil diproses (\`${res.sourceLabel}\`).`,
                        ),
                ],
            });
        }

        // Interactive search & pick mode
        const voiceCheck = validateVoiceAndPermissionsForRequest(client, guild, interaction.member);
        if (!voiceCheck.ok) {
            return safeEditReply(interaction, {
                embeds: [new EmbedBuilder().setColor(color).setDescription(`⚠️ ${voiceCheck.error}`)],
            });
        }

        const searchRes = await smartSearch(client, inputCheck.cleanQuery, { requester: interaction.user });
        const candidates = (searchRes?.tracks || []).slice(0, 8);
        if (!candidates.length) {
            return safeEditReply(interaction, {
                embeds: [new EmbedBuilder().setColor(color).setDescription("Tidak ditemukan kandidat lagu untuk pencarian tersebut.")],
            });
        }

        const selectRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId("mreq:pick_candidate")
                .setPlaceholder("Pilih lagu untuk dimasukkan ke antrean...")
                .addOptions(
                    candidates.map((t, idx) => ({
                        label: `${idx + 1}. ${truncateText(t.title, 85)}`,
                        description: `${truncateText(t.author, 55)} • ${t.isStream ? "LIVE" : convertTime(t.duration || 0)}`,
                        value: String(idx),
                    })),
                ),
        );

        const listDesc = candidates
            .map(
                (t, i) =>
                    `\`${i + 1}.\` **${truncateText(t.title, 48)}** — ${truncateText(t.author, 30)} (\`${t.isStream ? "LIVE" : convertTime(t.duration || 0)}\`)`,
            )
            .join("\n");

        const pickMsg = await safeEditReply(interaction, {
            embeds: [
                new EmbedBuilder()
                    .setColor(color)
                    .setTitle(`🔎 Hasil Pencarian: "${truncateText(inputCheck.cleanQuery, 40)}"`)
                    .setDescription(listDesc),
            ],
            components: [selectRow],
        });

        if (pickMsg && typeof pickMsg.createMessageComponentCollector === "function") {
            const collector = pickMsg.createMessageComponentCollector({ time: 60000 });
            collector.on("collect", (sel) => {
                void (async () => {
                    if (sel.user.id !== interaction.user.id) return;
                    const ack = await safeDeferUpdate(sel);
                    if (!ack) return;
                    collector.stop("picked");

                    const chosen = candidates[Number.parseInt(sel.values?.[0] || "0", 10)];
                    if (!chosen) return;

                    const vCheck2 = validateVoiceAndPermissionsForRequest(client, guild, sel.member || interaction.member);
                    if (!vCheck2.ok) {
                        await safeEditReply(interaction, {
                            embeds: [new EmbedBuilder().setColor(color).setDescription(`⚠️ ${vCheck2.error}`)],
                            components: [],
                        });
                        return;
                    }

                    const player = await getOrCreateGuildPlayer(client, {
                        guild,
                        voiceChannelId: vCheck2.voiceChannel.id,
                        textChannelId: cfg.channelId || interaction.channelId,
                    });
                    requestUserCooldowns.set(`${guild.id}:${interaction.user.id}`, Date.now());
                    const wasActive = isPlayerActivelyPlayingOrPausedTrack(player);
                    player.queue.add(chosen);
                    await recordTrackRequest(client, { guildId: guild.id, userId: interaction.user.id, count: 1 });

                    if (!wasActive) {
                        const startRes = await startPlayerIfIdle(client, player, {
                            guild,
                            userId: interaction.user.id,
                            command: "musicrequest",
                            waitForTrackStart: true,
                            timeoutMs: 8000,
                        });
                        if (startRes.ok) {
                            await ensureNowPlayingDashboardVisible(client, player, chosen);
                        }
                    } else {
                        await refreshNowPlayingDashboard(client, player).catch(() => {});
                    }
                    await refreshRequestPanelMessage(client, guild.id).catch(() => {});

                    await safeEditReply(interaction, {
                        embeds: [
                            new EmbedBuilder()
                                .setColor(color)
                                .setDescription(`✅ **${truncateText(chosen.title, 48)}** berhasil ditambahkan ke antrean!`),
                        ],
                        components: [],
                    });
                })().catch(() => {});
            });
        }
    }
}

module.exports = {
    getGuildRequestConfig,
    saveGuildRequestConfig,
    buildRequestPanelPayload,
    refreshRequestPanelMessage,
    handleRequestChannelMessage,
    handleRequestPanelInteraction,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
