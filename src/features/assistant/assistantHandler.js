const { EmbedBuilder } = require("discord.js");
const { parseAssistantCommand } = require("./commandParser.js");
const { FALLBACK_UNKNOWN_MESSAGE, pickVariedResponse } = require("./responses.js");
const { pickStoryForUser } = require("./stories.js");
const { getPlaybackSnapshot, executeAssistantMusicAction } = require("./musicActions.js");
const { peekCachedGuildPremiumTheme } = require("../../functions/premiumSystem.js");
const Logger = require("../../utils/logger");

const MAX_PROCESSED_MESSAGE_IDS = 2000;
const DUPLICATE_TEXT_COOLDOWN_MS = 1500;
const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX_REQUESTS = 8;

const processedMessageIds = new Set();
const userBurstMap = new Map();
const userRateBuckets = new Map();

function sanitizeOutgoingText(input) {
    if (!input) return "";
    let text = String(input);
    text = text.replace(/mongodb(?:\+srv)?:\/\/[^\s"'`]+/gi, "[REDACTED]");
    text = text.replace(/lgk_sk_[a-f0-9]{16,}/gi, "[REDACTED]");
    text = text.replace(/[A-Za-z0-9_-]{22,36}\.[A-Za-z0-9_-]{6,10}\.[A-Za-z0-9_-]{25,64}/g, "[REDACTED]");
    return text;
}

function trackProcessedMessageId(messageId) {
    if (!messageId) return false;
    const key = String(messageId);
    if (processedMessageIds.has(key)) {
        return true; // Already processed
    }
    if (processedMessageIds.size >= MAX_PROCESSED_MESSAGE_IDS) {
        const oldest = processedMessageIds.values().next().value;
        if (oldest) processedMessageIds.delete(oldest);
    }
    processedMessageIds.add(key);
    return false;
}

function checkAssistantSpamGuard(userId, normalizedText, bypassRateLimit = false) {
    const uid = String(userId || "anon");
    const now = Date.now();

    // 1. Prevent accidental duplicate burst of identical command within 1.5s
    const prevBurst = userBurstMap.get(uid);
    if (!bypassRateLimit && prevBurst && prevBurst.text === normalizedText && now - prevBurst.at < DUPLICATE_TEXT_COOLDOWN_MS) {
        return { allowed: false, silent: true };
    }
    userBurstMap.set(uid, { text: normalizedText, at: now });
    if (userBurstMap.size > 1500) {
        const oldest = userBurstMap.keys().next().value;
        if (oldest) userBurstMap.delete(oldest);
    }

    if (bypassRateLimit) {
        return { allowed: true };
    }

    // 2. Sliding window per-user rate limit
    let bucket = userRateBuckets.get(uid);
    if (!bucket || now > bucket.resetAt) {
        bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS, warned: false };
        userRateBuckets.set(uid, bucket);
    }

    bucket.count += 1;
    if (userRateBuckets.size > 1500) {
        const oldest = userRateBuckets.keys().next().value;
        if (oldest) userRateBuckets.delete(oldest);
    }

    if (bucket.count > RATE_LIMIT_MAX_REQUESTS) {
        if (bucket.warned) {
            return { allowed: false, silent: true };
        }
        bucket.warned = true;
        const waitSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
        return {
            allowed: false,
            silent: false,
            retryAfterSec: waitSec,
        };
    }

    return { allowed: true };
}

function buildAssistantEmbed(client, message, options = {}) {
    const botName = client.config?.botName || "Lagukan";
    const guildId = message.guild?.id;
    const premiumTheme = guildId ? peekCachedGuildPremiumTheme(guildId) : null;
    const defaultColor = premiumTheme?.embedColor || client.config?.embedColor || 0x5865f2;
    const baseColor = options.isError ? 0xef4444 : defaultColor;
    const snapshot = getPlaybackSnapshot(client, guildId);

    const embed = new EmbedBuilder()
        .setColor(baseColor)
        .setAuthor({
            name: `🤖 666 Text Assistant • ${botName}`,
            iconURL: client.user?.displayAvatarURL?.(),
        })
        .setTitle(`${options.emoji || "✨"} ${sanitizeOutgoingText(options.title || "666 Text Assistant")}`)
        .setDescription(sanitizeOutgoingText(options.description || ""))
        .addFields(
            {
                name: "🧭 Perintah",
                value: `\`${sanitizeOutgoingText(options.commandLabel || "666")}\``,
                inline: true,
            },
            {
                name: "📡 Status Pemutaran",
                value: snapshot.statusLabel,
                inline: true,
            },
            {
                name: "🎶 Lagu Sedang Diputar",
                value: snapshot.currentSongLabel,
                inline: false,
            },
        )
        .setFooter({
            text: `666 Text Assistant • Sistem Lokal ${botName} (Ketik "666 help" untuk daftar perintah)`,
        })
        .setTimestamp();

    if (options.thumbnail && /^https?:\/\//i.test(String(options.thumbnail))) {
        embed.setThumbnail(options.thumbnail);
    }

    return embed;
}

function buildHelpDescription() {
    return [
        "Halo! Aku **666**, asisten teks lokal milik **Lagukan** yang berjalan langsung di dalam bot tanpa layanan AI eksternal.",
        "",
        "**🎵 Kontrol Musik (Terhubung ke Player Lagukan)**",
        "• `666 play <judul / artis / URL>` atau `666 putar lagu <judul>`",
        "• `666 pause` / `666 jeda` — Menjeda lagu saat ini",
        "• `666 resume` / `666 lanjut` — Melanjutkan pemutaran lagu",
        "• `666 skip` / `666 ganti lagu` — Melewati lagu saat ini",
        "• `666 previous` — Memutar lagu sebelumnya",
        "• `666 stop` — Menghentikan musik & membersihkan antrean",
        "• `666 leave` — Mengeluarkan bot dari voice channel",
        "• `666 volume <1-100>` — Mengatur volume suara (contoh: `666 volume 50`)",
        "• `666 queue` / `666 antrean` — Melihat daftar antrean lagu",
        "• `666 sekarang putar apa` — Info lagu yang sedang diputar",
        "• `666 shuffle` & `666 loop <off|lagu|queue>` — Acak & ulangi antrean",
        "",
        "**📖 Dongeng & Koleksi Cerita Lokal (60 Cerita)**",
        "• `666 dongengin aku` — Dongeng hangat penuh hikmah",
        "• `666 cerita horor` — Cerita misteri & horor",
        "• `666 cerita romantis` — Kisah manis & hangat",
        "• `666 cerita lucu` — Cerita komedi penghibur suasana",
        "• `666 cerita fantasi` — Kisah petualangan dunia imajinasi",
        "• `666 buat cerita pendek` — Cerita pendek (cerpen) inspiratif",
        "",
        "**💬 Percakapan Lokal**",
        "• `666 halo`, `666 apa kabar`, `666 siapa kamu`, `666 terima kasih`, `666 kamu lucu`, `666 selamat malam`, `666 rekomendasi lagu`",
        "",
        "*Tips: Gunakan `666!cek` untuk melihat Kartu Profil Musik & Level XP kamu, atau `/help` untuk daftar Slash Command lengkap!*",
    ].join("\n");
}

/**
 * Main entry point called from `messageCreate.js`.
 * Returns `true` if the message was addressed to `666` and handled, otherwise `false`.
 */
async function handleAssistantMessage(client, message, options = {}) {
    try {
        if (!message || message.author?.bot || !message.guild || message.system || message.webhookId) {
            return false;
        }

        const parsed = parseAssistantCommand(message.content);
        if (!parsed.triggered) {
            return false;
        }

        // Deduplicate message ID so the same message is never processed twice
        if (message.id && trackProcessedMessageId(message.id)) {
            return true;
        }

        const normalizedSig = String(message.content || "")
            .trim()
            .toLowerCase();
        const spamCheck = checkAssistantSpamGuard(message.author.id, normalizedSig, Boolean(options.bypassRateLimit));
        if (!spamCheck.allowed) {
            if (!spamCheck.silent) {
                const warnEmbed = buildAssistantEmbed(client, message, {
                    isError: true,
                    emoji: "⏳",
                    title: "Terlalu Banyak Perintah",
                    commandLabel: parsed.label || "666",
                    description: `Pelan-pelan ya! Tunggu sekitar **${spamCheck.retryAfterSec} detik** sebelum mengirim perintah ke 666 lagi.`,
                });
                await message.reply({ embeds: [warnEmbed] }).catch(() => {});
            }
            return true;
        }

        // Check ban & maintenance status
        const userData = client.data?.get?.(`userData_${message.author.id}`);
        if (userData?.ban?.status) {
            const banEmbed = buildAssistantEmbed(client, message, {
                isError: true,
                emoji: "🚫",
                title: "Akses Dibatasi",
                commandLabel: parsed.label || "666",
                description: `Kamu sedang dibatasi dari penggunaan bot.\n\`\`\`${sanitizeOutgoingText(userData.ban.reason || "Tidak ada alasan")}\`\`\``,
            });
            await message.reply({ embeds: [banEmbed] }).catch(() => {});
            return true;
        }

        if (client.data?.get?.("maintenance") && !client.config?.dev?.includes?.(message.author.id)) {
            const maintEmbed = buildAssistantEmbed(client, message, {
                isError: true,
                emoji: "🛠️",
                title: "Mode Pemeliharaan",
                commandLabel: parsed.label || "666",
                description: `${client.config?.botName || "Lagukan"} sedang dalam pemeliharaan. Silakan coba kembali nanti ya!`,
            });
            await message.reply({ embeds: [maintEmbed] }).catch(() => {});
            return true;
        }

        // 1. Help Command (`666 help`)
        if (parsed.type === "help") {
            const helpEmbed = buildAssistantEmbed(client, message, {
                isError: false,
                emoji: "📘",
                title: "Panduan Lengkap 666 Text Assistant",
                commandLabel: parsed.label,
                description: buildHelpDescription(),
            });
            await message.reply({ embeds: [helpEmbed] }).catch(() => {});
            return true;
        }

        // 2. Story & Dongeng (`666 dongengin aku`, `666 cerita horor`, etc.)
        if (parsed.type === "story") {
            const picked = pickStoryForUser(message.author.id, parsed.category);
            const storyEmbed = buildAssistantEmbed(client, message, {
                isError: false,
                emoji: picked.category.emoji,
                title: `${picked.category.label} — "${picked.story.title}"`,
                commandLabel: parsed.label,
                description: `${picked.story.content}\n\n*Ingin membaca cerita lainnya? Ketik lagi \`${picked.category.commandHint}\`!*`,
            });
            await message.reply({ embeds: [storyEmbed] }).catch(() => {});
            return true;
        }

        // 3. Local Conversation (`666 halo`, `666 siapa kamu`, etc.)
        if (parsed.type === "chat") {
            const replyText = pickVariedResponse(message.author.id, parsed.action);
            const chatEmbed = buildAssistantEmbed(client, message, {
                isError: false,
                emoji: "💬",
                title: "666 Text Assistant",
                commandLabel: parsed.label,
                description: replyText,
            });
            await message.reply({ embeds: [chatEmbed] }).catch(() => {});
            return true;
        }

        // 4. Music Player Integration (`666 play`, `666 pause`, `666 volume 50`, etc.)
        if (parsed.type === "music") {
            const outcome = await executeAssistantMusicAction(client, message, parsed);
            const musicEmbed = buildAssistantEmbed(client, message, {
                isError: Boolean(outcome.isError),
                emoji: outcome.emoji || "🎵",
                title: outcome.title || "Kontrol Musik 666",
                commandLabel: parsed.label,
                description: outcome.description || "",
                thumbnail: outcome.thumbnail || null,
            });
            await message.reply({ embeds: [musicEmbed] }).catch(() => {});
            return true;
        }

        // 5. Fallback Unknown Command
        const unknownEmbed = buildAssistantEmbed(client, message, {
            isError: true,
            emoji: "🤔",
            title: "Perintah Belum Dipahami",
            commandLabel: parsed.label,
            description: FALLBACK_UNKNOWN_MESSAGE,
        });
        await message.reply({ embeds: [unknownEmbed] }).catch(() => {});
        return true;
    } catch (error) {
        Logger.error("[666Assistant] Terjadi kesalahan saat memproses pesan:", sanitizeOutgoingText(error?.message || error));
        try {
            const fallbackErrEmbed = buildAssistantEmbed(client, message, {
                isError: true,
                emoji: "⚠️",
                title: "Terjadi Kendala Sementara",
                commandLabel: "666",
                description: "Maaf, terjadi kendala saat menjalankan perintahmu. Silakan coba lagi sesaat lagi.",
            });
            await message.reply({ embeds: [fallbackErrEmbed] }).catch(() => {});
        } catch {
            // Ignore secondary reply failure
        }
        return true;
    }
}

function resetAssistantRateStateForTest() {
    processedMessageIds.clear();
    userBurstMap.clear();
    userRateBuckets.clear();
}

module.exports = {
    handleAssistantMessage,
    buildAssistantEmbed,
    buildHelpDescription,
    resetAssistantRateStateForTest,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
