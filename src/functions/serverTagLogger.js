const mongoose = require("mongoose");
const { ChannelType, EmbedBuilder, GatewayIntentBits, PermissionsBitField, escapeMarkdown } = require("discord.js");
const { createDataGuild, normalizeGuildData } = require("./createData.js");
const ServerTagMember = require("../databases/schema/serverTagMember.js");
const Logger = require("../utils/logger");

const TAG_COLORS = {
    INSTALLED: 0x06b6d4, // Lagukan Signature Cyan
    REINSTALLED: 0x00d2ff, // Lagukan Bright Electric Cyan
    CHANGED: 0x0ea5e9, // Lagukan Electric Sky-Blue
    REMOVED: 0x0891b2, // Lagukan Deep Cyan-Teal
    INFO: 0x06b6d4, // Lagukan Cyan
    WARNING: 0xf59e0b, // Amber Warning
    ERROR: 0xef4444, // Soft Crimson Error
};

const FOOTER_TEXT = "LAGUKAN • SERVER TAG LOGGER";
const MAX_MEMBER_HISTORY = 20;
const MAX_GUILD_RECENT_HISTORY = 25;
const WIB_TIMEZONE = "Asia/Jakarta";

const REQUIRED_CHANNEL_PERMISSIONS = [
    {
        flag: PermissionsBitField.Flags.ViewChannel,
        key: "ViewChannel",
        label: "Lihat Channel (`ViewChannel`)",
    },
    {
        flag: PermissionsBitField.Flags.SendMessages,
        key: "SendMessages",
        label: "Kirim Pesan (`SendMessages`)",
    },
    {
        flag: PermissionsBitField.Flags.EmbedLinks,
        key: "EmbedLinks",
        label: "Sematkan Tautan (`EmbedLinks`)",
    },
];

// Per-(guildId:userId) serialization lock to prevent duplicate notifications on simultaneous Gateway events
const memberLocks = new Map();
const warnedLogChannels = new Map();
const WARN_COOLDOWN_MS = 60_000;

function withMemberLock(guildId, userId, task) {
    const key = `${guildId}:${userId}`;
    const prev = memberLocks.get(key) || Promise.resolve();

    const next = prev
        .catch(() => {})
        .then(() => task())
        .finally(() => {
            if (memberLocks.get(key) === next) {
                memberLocks.delete(key);
            }
        });

    memberLocks.set(key, next);
    return next;
}

function isMongoReady() {
    return mongoose.connection?.readyState === 1;
}

function getModel(client) {
    return client?.serverTagMemberData || ServerTagMember;
}

function hasServerMembersIntent(client) {
    try {
        if (client?.serverMembersIntentFallback) return false;
        return Boolean(client?.options?.intents?.has?.(GatewayIntentBits.GuildMembers));
    } catch {
        return false;
    }
}

function escapeInlineCode(value) {
    return String(value ?? "").replace(/`/g, "ˋ");
}

function formatWibDateTime(date = new Date()) {
    try {
        const formatted = new Intl.DateTimeFormat("id-ID", {
            timeZone: WIB_TIMEZONE,
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23",
        }).format(date);

        return `${formatted.replace(/\./g, ":")} WIB`;
    } catch {
        return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
    }
}

/**
 * Extracts active Server Tag (Guild Tag) information strictly from official Discord API v10 User.primaryGuild.
 * Returns null if the user currently has no enabled Server Tag.
 */
function extractActiveTag(user) {
    if (!user) return null;

    const raw = user.primaryGuild ?? user.primary_guild ?? null;
    if (!raw) return null;

    const identityEnabled = raw.identityEnabled ?? raw.identity_enabled ?? null;
    const tag = typeof raw.tag === "string" ? raw.tag.trim() : "";
    const identityGuildId = raw.identityGuildId ?? raw.identity_guild_id ?? null;
    const badge = raw.badge ?? null;

    if (identityEnabled !== true || !tag) {
        return null;
    }

    let badgeUrl = null;
    if (typeof user.guildTagBadgeURL === "function") {
        try {
            badgeUrl = user.guildTagBadgeURL({ size: 128, extension: "png" }) || null;
        } catch {
            badgeUrl = null;
        }
    }

    if (!badgeUrl && identityGuildId && badge) {
        badgeUrl = `https://cdn.discordapp.com/guild-tag-badges/${identityGuildId}/${badge}.png?size=128`;
    }

    return {
        identityGuildId: identityGuildId ? String(identityGuildId) : null,
        identityEnabled: true,
        tag,
        badge: badge ? String(badge) : null,
        badgeUrl,
    };
}

function normalizeStoredTag(stored) {
    if (!stored || stored.identityEnabled !== true || !stored.tag) {
        return null;
    }

    const identityGuildId = stored.identityGuildId ? String(stored.identityGuildId) : null;
    const badge = stored.badge ? String(stored.badge) : null;
    const badgeUrl =
        stored.badgeUrl ||
        (identityGuildId && badge ? `https://cdn.discordapp.com/guild-tag-badges/${identityGuildId}/${badge}.png?size=128` : null);

    return {
        identityGuildId,
        identityEnabled: true,
        tag: String(stored.tag),
        badge,
        badgeUrl,
    };
}

function toStoredTagObject(activeTag) {
    if (!activeTag) {
        return {
            identityGuildId: null,
            identityEnabled: false,
            tag: null,
            badge: null,
        };
    }

    return {
        identityGuildId: activeTag.identityGuildId || null,
        identityEnabled: true,
        tag: activeTag.tag,
        badge: activeTag.badge || null,
    };
}

function isSameActiveTag(tagA, tagB) {
    const a = tagA && tagA.identityEnabled && tagA.tag ? tagA : null;
    const b = tagB && tagB.identityEnabled && tagB.tag ? tagB : null;

    if (!a && !b) return true;
    if (!a || !b) return false;

    return a.tag === b.tag && (a.identityGuildId || null) === (b.identityGuildId || null);
}

function hasAdminPermission(member) {
    return Boolean(member?.permissions?.has?.(PermissionsBitField.Flags.Administrator));
}

function getBotAvatarUrl(client) {
    return client?.user?.displayAvatarURL?.({ size: 128 }) || undefined;
}

function buildAdminDeniedEmbed(client, commandName) {
    return new EmbedBuilder()
        .setColor(TAG_COLORS.ERROR)
        .setTitle("⛔ Akses Ditolak")
        .setDescription(`Command \`/${commandName}\` hanya dapat digunakan oleh anggota dengan izin **Administrator** di server ini.`)
        .setFooter({ text: FOOTER_TEXT, iconURL: getBotAvatarUrl(client) })
        .setTimestamp();
}

function validateLogChannel(guild, channel) {
    if (!guild || !channel) {
        return {
            valid: false,
            code: "CHANNEL_NOT_FOUND",
            missingPermissions: [],
            message: "Channel tidak ditemukan di server ini. Silakan pilih channel teks yang valid.",
        };
    }

    if (channel.guildId && channel.guildId !== guild.id) {
        return {
            valid: false,
            code: "WRONG_GUILD",
            missingPermissions: [],
            message: "Channel yang dipilih bukan berasal dari server ini.",
        };
    }

    const allowedTypes = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
    if (!allowedTypes.includes(channel.type)) {
        return {
            valid: false,
            code: "INVALID_CHANNEL_TYPE",
            missingPermissions: [],
            message: "Channel log harus berupa **Text Channel** atau **Announcement Channel** biasa (bukan Voice/Category/Forum).",
        };
    }

    const me = guild.members?.me;
    if (!me) {
        return {
            valid: false,
            code: "BOT_MEMBER_UNAVAILABLE",
            missingPermissions: [],
            message: "Data member bot belum siap di server ini. Silakan coba beberapa saat lagi.",
        };
    }

    const perms = channel.permissionsFor?.(me);
    const missing = [];

    for (const req of REQUIRED_CHANNEL_PERMISSIONS) {
        if (!perms || !perms.has(req.flag)) {
            missing.push(req);
        }
    }

    if (missing.length > 0) {
        const listText = missing.map((item) => `• ${item.label}`).join("\n");
        return {
            valid: false,
            code: "MISSING_PERMISSIONS",
            missingPermissions: missing,
            message: `Bot tidak memiliki izin yang dibutuhkan pada channel <#${channel.id}>:\n${listText}\n\nSilakan aktifkan izin tersebut pada pengaturan channel atau role **Lagukan**, lalu jalankan kembali command ini.`,
        };
    }

    return {
        valid: true,
        code: "OK",
        missingPermissions: [],
        message: null,
    };
}

async function ensureGuildRecord(client, guild) {
    if (!guild?.id) return null;

    let guildData = client.data.get(`guildData_${guild.id}`);
    if (!guildData) {
        guildData = await createDataGuild(client, guild);
    }

    const normalized = normalizeGuildData(client, guild, guildData || { id: guild.id });
    client.data.set(`guildData_${guild.id}`, normalized);

    return normalized;
}

async function persistGuildServerTagLog(client, guild, nextServerTagLog) {
    const current = (await ensureGuildRecord(client, guild)) || normalizeGuildData(client, guild, { id: guild.id });
    const updatedGuildData = normalizeGuildData(client, guild, {
        ...current,
        serverTagLog: nextServerTagLog,
    });

    client.data.set(`guildData_${guild.id}`, updatedGuildData);

    if (isMongoReady() && client.guildData?.findOneAndUpdate) {
        await client.guildData
            .findOneAndUpdate(
                { id: guild.id },
                { $set: { serverTagLog: updatedGuildData.serverTagLog } },
                { upsert: true, returnDocument: "after" },
            )
            .catch((err) => {
                Logger.error(`[ServerTagLogger] Gagal menyimpan konfigurasi guild ${guild.id} ke MongoDB:`, err);
            });
    }

    return updatedGuildData.serverTagLog;
}

async function setServerTagLogChannel(client, guild, channelId, actorUserId) {
    const guildData = await ensureGuildRecord(client, guild);
    const prevTagLog = guildData.serverTagLog || {};

    const nextTagLog = {
        ...prevTagLog,
        enabled: true,
        channelId: String(channelId),
        updatedBy: actorUserId ? String(actorUserId) : null,
        updatedAt: new Date(),
    };

    const saved = await persistGuildServerTagLog(client, guild, nextTagLog);

    // Seed baseline tag states for currently known/reachable guild members without spamming notifications
    const syncedCount = await syncGuildMemberTagsBaseline(client, guild).catch(() => 0);

    return {
        config: saved,
        syncedCount,
    };
}

async function resetServerTagLogChannel(client, guild, actorUserId) {
    const guildData = await ensureGuildRecord(client, guild);
    const prevTagLog = guildData.serverTagLog || {};
    const wasConfigured = Boolean(prevTagLog.enabled || prevTagLog.channelId);
    const previousChannelId = prevTagLog.channelId || null;

    const nextTagLog = {
        ...prevTagLog,
        enabled: false,
        channelId: null,
        updatedBy: actorUserId ? String(actorUserId) : null,
        updatedAt: new Date(),
    };

    const saved = await persistGuildServerTagLog(client, guild, nextTagLog);

    return {
        wasConfigured,
        previousChannelId,
        config: saved,
    };
}

function getMemberCacheKey(guildId, userId) {
    return `tagMember_${guildId}_${userId}`;
}

async function getMemberTagRecord(client, guildId, userId) {
    const cacheKey = getMemberCacheKey(guildId, userId);
    const cached = client.data.get(cacheKey);
    if (cached) return cached;

    if (isMongoReady()) {
        const Model = getModel(client);
        const doc = await Model.findOne({ guildId: String(guildId), userId: String(userId) })
            .lean()
            .catch(() => null);

        if (doc) {
            const { _id, __v, ...clean } = doc;
            client.data.set(cacheKey, clean);
            return clean;
        }
    }

    return null;
}

async function saveMemberTagRecord(client, record) {
    const cacheKey = getMemberCacheKey(record.guildId, record.userId);
    const cleanRecord = {
        guildId: String(record.guildId),
        userId: String(record.userId),
        username: record.username || null,
        currentTag: toStoredTagObject(normalizeStoredTag(record.currentTag)),
        installCount: Math.max(0, Number(record.installCount) || 0),
        changeCount: Math.max(0, Number(record.changeCount) || 0),
        removeCount: Math.max(0, Number(record.removeCount) || 0),
        hadTagBefore: Boolean(record.hadTagBefore),
        firstInstalledAt: record.firstInstalledAt || null,
        lastAction: record.lastAction || "baseline",
        lastUpdatedAt: record.lastUpdatedAt || new Date(),
        history: Array.isArray(record.history) ? record.history.slice(0, MAX_MEMBER_HISTORY) : [],
    };

    client.data.set(cacheKey, cleanRecord);

    if (isMongoReady()) {
        const Model = getModel(client);
        await Model.findOneAndUpdate(
            { guildId: cleanRecord.guildId, userId: cleanRecord.userId },
            { $set: cleanRecord },
            { upsert: true, returnDocument: "after" },
        ).catch((err) => {
            Logger.error(`[ServerTagLogger] Gagal menyimpan riwayat member ${cleanRecord.userId} di guild ${cleanRecord.guildId}:`, err);
        });
    }

    return cleanRecord;
}

async function countActiveTaggedMembers(client, guildId) {
    const gId = String(guildId);

    if (isMongoReady()) {
        const Model = getModel(client);
        const docs = await Model.find({ guildId: gId, "currentTag.identityEnabled": true }, { userId: 1, currentTag: 1 })
            .lean()
            .catch(() => null);

        if (Array.isArray(docs)) {
            const validDocs = docs.filter((d) => d.currentTag?.identityEnabled && d.currentTag?.tag);
            const sameServerCount = validDocs.filter((d) => d.currentTag?.identityGuildId === gId).length;
            return {
                totalActive: validDocs.length,
                sameServerActive: sameServerCount,
                externalServerActive: Math.max(0, validDocs.length - sameServerCount),
            };
        }
    }

    // Fallback to in-memory cache when MongoDB is offline
    const prefix = `tagMember_${gId}_`;
    let totalActive = 0;
    let sameServerActive = 0;

    for (const [key, val] of client.data.entries()) {
        if (!key.startsWith(prefix)) continue;
        if (val?.currentTag?.identityEnabled && val?.currentTag?.tag) {
            totalActive += 1;
            if (val.currentTag.identityGuildId === gId) {
                sameServerActive += 1;
            }
        }
    }

    return {
        totalActive,
        sameServerActive,
        externalServerActive: Math.max(0, totalActive - sameServerActive),
    };
}

/**
 * Seeds baseline Server Tag state for guild members without sending notifications.
 * Prevents false-positive spam on bot startup or when /setlogs is first configured.
 */
async function syncGuildMemberTagsBaseline(client, guild) {
    if (!guild?.id) return 0;

    let membersCollection = guild.members?.cache;

    if (hasServerMembersIntent(client) && typeof guild.members?.fetch === "function") {
        const fetched = await guild.members.fetch({ time: 15_000 }).catch(() => null);
        if (fetched) membersCollection = fetched;
    }

    if (!membersCollection || membersCollection.size === 0) return 0;

    let synced = 0;
    const now = new Date();

    for (const [, member] of membersCollection) {
        const user = member?.user;
        if (!user || user.bot) continue;

        await withMemberLock(guild.id, user.id, async () => {
            const existing = await getMemberTagRecord(client, guild.id, user.id);
            const activeTag = extractActiveTag(user);

            if (!existing) {
                await saveMemberTagRecord(client, {
                    guildId: guild.id,
                    userId: user.id,
                    username: user.username || null,
                    currentTag: activeTag,
                    installCount: 0,
                    changeCount: 0,
                    removeCount: 0,
                    hadTagBefore: Boolean(activeTag),
                    firstInstalledAt: activeTag ? now : null,
                    lastAction: "baseline",
                    lastUpdatedAt: now,
                    history: [],
                });
                synced += 1;
            } else {
                // Refresh baseline silently on startup so offline changes don't burst-spam
                const prevStored = normalizeStoredTag(existing.currentTag);
                if (!isSameActiveTag(prevStored, activeTag)) {
                    await saveMemberTagRecord(client, {
                        ...existing,
                        username: user.username || existing.username || null,
                        currentTag: activeTag,
                        hadTagBefore: Boolean(existing.hadTagBefore || prevStored || activeTag),
                        lastUpdatedAt: now,
                    });
                }
                synced += 1;
            }
        });
    }

    return synced;
}

function resolveTagOriginLabel(client, guild, tagInfo) {
    if (!tagInfo) return "`Tidak Diketahui`";

    if (tagInfo.identityGuildId && tagInfo.identityGuildId === guild.id) {
        return `Server Ini (**${escapeMarkdown(guild.name)}**)`;
    }

    if (tagInfo.identityGuildId) {
        const cachedGuild = client?.guilds?.cache?.get?.(tagInfo.identityGuildId);
        if (cachedGuild?.name) {
            return `**${escapeMarkdown(cachedGuild.name)}** (\`${tagInfo.identityGuildId}\`)`;
        }
        return `Server Eksternal (\`${tagInfo.identityGuildId}\`)`;
    }

    return "`Profil Discord`";
}

function formatMemberHistorySummary(memberRecord, actionType) {
    const installs = Number(memberRecord?.installCount) || 0;
    const changes = Number(memberRecord?.changeCount) || 0;
    const removes = Number(memberRecord?.removeCount) || 0;

    if (actionType === "installed" && installs === 1 && changes === 0 && removes === 0) {
        return "Pemasangan pertama yang tercatat di server ini";
    }

    const parts = [`\`${installs}x\` pasang`];
    if (changes > 0) parts.push(`\`${changes}x\` ganti`);
    if (removes > 0) parts.push(`\`${removes}x\` lepas`);

    return parts.join(" • ");
}

function buildServerTagActivityEmbed({
    client,
    guild,
    user,
    member,
    actionType,
    prevTag,
    nextTag,
    memberRecord,
    guildStats,
    activeSummary,
    timestamp = new Date(),
}) {
    const unixSec = Math.floor(timestamp.getTime() / 1000);
    const wibText = formatWibDateTime(timestamp);
    const botAvatar = getBotAvatarUrl(client);
    const guildIcon = guild.iconURL?.({ size: 128 }) || null;
    const activeBadgeUrl = nextTag?.badgeUrl || prevTag?.badgeUrl || null;
    const authorIcon = activeBadgeUrl || guildIcon || botAvatar;
    const userAvatar = user.displayAvatarURL?.({ size: 256 }) || botAvatar;
    const isThisGuildTag = Boolean(nextTag?.identityGuildId && nextTag.identityGuildId === guild.id);

    let embedColor = TAG_COLORS.INSTALLED;
    let title = "🏷️ Server Tag Baru Terpasang";
    let description = "";
    let tagFieldLines = [];

    if (actionType === "installed") {
        embedColor = TAG_COLORS.INSTALLED;
        title = "🏷️ Server Tag Baru Terpasang";
        description = isThisGuildTag
            ? `Terima kasih <@${user.id}> telah menyematkan **Server Tag** komunitas **${escapeMarkdown(guild.name)}** pada profil Discord kamu!`
            : `<@${user.id}> baru saja menyematkan **Server Tag** pada profil Discord-nya.`;

        tagFieldLines = [
            `• **Nama Tag:** \`${escapeInlineCode(nextTag.tag)}\`${nextTag.badgeUrl ? ` • [Lihat Badge](${nextTag.badgeUrl})` : ""}`,
            `• **Status Tag:** 🟢 Aktif Terpasang`,
            `• **Asal Tag:** ${resolveTagOriginLabel(client, guild, nextTag)}`,
            `• **Waktu (WIB):** \`${wibText}\` (<t:${unixSec}:R>)`,
        ];
    } else if (actionType === "reinstalled") {
        embedColor = TAG_COLORS.REINSTALLED;
        title = "✨ Server Tag Dipasang Kembali";
        description = isThisGuildTag
            ? `Selamat datang kembali! <@${user.id}> kembali menyematkan **Server Tag** **${escapeMarkdown(guild.name)}** pada profil Discord-nya.`
            : `<@${user.id}> kembali menyematkan **Server Tag** pada profil Discord-nya.`;

        tagFieldLines = [
            `• **Nama Tag:** \`${escapeInlineCode(nextTag.tag)}\`${nextTag.badgeUrl ? ` • [Lihat Badge](${nextTag.badgeUrl})` : ""}`,
            `• **Status Tag:** 🟢 Aktif Kembali di Profil`,
            `• **Asal Tag:** ${resolveTagOriginLabel(client, guild, nextTag)}`,
            `• **Waktu (WIB):** \`${wibText}\` (<t:${unixSec}:R>)`,
        ];
    } else if (actionType === "changed") {
        embedColor = TAG_COLORS.CHANGED;
        title = "🔄 Server Tag Diperbarui";
        description = `<@${user.id}> baru saja mengganti **Server Tag** yang ditampilkan pada profil Discord-nya.`;

        tagFieldLines = [
            `• **Perubahan Tag:** \`${escapeInlineCode(prevTag.tag)}\` ➜ \`${escapeInlineCode(nextTag.tag)}\`${nextTag.badgeUrl ? ` • [Lihat Badge](${nextTag.badgeUrl})` : ""}`,
            `• **Status Tag:** 🔵 Diperbarui & Aktif`,
            `• **Asal Tag Baru:** ${resolveTagOriginLabel(client, guild, nextTag)}`,
            `• **Waktu (WIB):** \`${wibText}\` (<t:${unixSec}:R>)`,
        ];
    } else if (actionType === "removed") {
        embedColor = TAG_COLORS.REMOVED;
        title = "🔓 Server Tag Dilepas";
        description = `<@${user.id}> telah melepas **Server Tag** dari tampilan profil Discord-nya.`;

        tagFieldLines = [
            `• **Tag Sebelumnya:** \`${escapeInlineCode(prevTag.tag)}\``,
            `• **Status Tag:** ⚪ Tidak Aktif / Dilepas`,
            `• **Asal Tag Sebelumnya:** ${resolveTagOriginLabel(client, guild, prevTag)}`,
            `• **Waktu (WIB):** \`${wibText}\` (<t:${unixSec}:R>)`,
        ];
    }

    const memberLines = [`• **Member:** <@${user.id}>`, `• **Username & ID:** \`@${escapeInlineCode(user.username)}\` (\`${user.id}\`)`];

    if (member?.joinedTimestamp) {
        memberLines.push(`• **Bergabung di Server:** <t:${Math.floor(member.joinedTimestamp / 1000)}:D>`);
    }

    memberLines.push(`• **Riwayat Aktivitas:** ${formatMemberHistorySummary(memberRecord, actionType)}`);

    const totalInstalled = Number(guildStats?.totalInstalled) || 0;
    const totalReinstalled = Number(guildStats?.totalReinstalled) || 0;
    const totalChanged = Number(guildStats?.totalChanged) || 0;
    const totalRemoved = Number(guildStats?.totalRemoved) || 0;
    const activeTotal = Number(activeSummary?.totalActive) || 0;

    const statsLines = [
        `• **Total Pemasangan di Server:** \`${totalInstalled}\` kali${totalReinstalled > 0 ? ` *(termasuk \`${totalReinstalled}\` pasang kembali)*` : ""}`,
        `• **Pergantian & Pelepasan:** \`${totalChanged}\` diganti • \`${totalRemoved}\` dilepas`,
        `• **Member Bertag Saat Ini:** \`${activeTotal}\` member aktif terpantau`,
    ];

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({
            name: `${guild.name} • Pemantau Server Tag`,
            iconURL: authorIcon || undefined,
        })
        .setTitle(title)
        .setDescription(description)
        .addFields(
            {
                name: "🏷️ Informasi Server Tag",
                value: tagFieldLines.join("\n"),
                inline: false,
            },
            {
                name: "👤 Informasi Member",
                value: memberLines.join("\n"),
                inline: false,
            },
            {
                name: "📊 Statistik Server",
                value: statsLines.join("\n"),
                inline: false,
            },
        )
        .setFooter({
            text: FOOTER_TEXT,
            iconURL: botAvatar,
        })
        .setTimestamp(timestamp);

    if (userAvatar) {
        embed.setThumbnail(userAvatar);
    }

    return embed;
}

function logChannelWarningOnce(guildId, channelId, message) {
    const key = `${guildId}:${channelId}`;
    const last = warnedLogChannels.get(key) || 0;
    const now = Date.now();
    if (now - last < WARN_COOLDOWN_MS) return;

    warnedLogChannels.set(key, now);
    Logger.warn(`[ServerTagLogger] ${message}`);
}

async function sendTagEmbedToLogChannel(client, guild, channelId, embed) {
    if (!channelId) return false;

    let channel = guild.channels?.cache?.get?.(channelId) || client.channels?.cache?.get?.(channelId) || null;
    if (!channel && typeof guild.channels?.fetch === "function") {
        channel = await guild.channels.fetch(channelId).catch(() => null);
    }

    if (!channel) {
        logChannelWarningOnce(
            guild.id,
            channelId,
            `Channel log (${channelId}) di server "${guild.name}" tidak ditemukan atau sudah dihapus.`,
        );
        return false;
    }

    const check = validateLogChannel(guild, channel);
    if (!check.valid) {
        logChannelWarningOnce(
            guild.id,
            channelId,
            `Tidak dapat mengirim log Server Tag ke #${channel.name || channelId} di "${guild.name}": ${check.code}`,
        );
        return false;
    }

    const sent = await channel.send({ embeds: [embed] }).catch((err) => {
        logChannelWarningOnce(guild.id, channelId, `Gagal mengirim embed Server Tag ke #${channel.name || channelId}: ${err.message}`);
        return null;
    });

    return Boolean(sent);
}

/**
 * Core per-guild member Server Tag transition evaluator.
 * Classifies into one of: "installed" | "changed" | "removed" | "reinstalled" | "baseline" | "no_change"
 */
async function evaluateGuildMemberTag(client, guild, user, options = {}) {
    if (!client || !guild?.id || !user?.id || user.bot) {
        return { status: "ignored" };
    }

    const guildData = await ensureGuildRecord(client, guild);
    const tagConfig = guildData?.serverTagLog;

    if (!tagConfig?.enabled || !tagConfig?.channelId) {
        return { status: "disabled" };
    }

    return withMemberLock(guild.id, user.id, async () => {
        const now = options.timestamp instanceof Date ? options.timestamp : new Date();
        const nextTag = extractActiveTag(user);
        let existing = await getMemberTagRecord(client, guild.id, user.id);

        // If this member has never been recorded yet:
        // - If triggered by a live Gateway diff where non-partial oldUser existed and genuinely differed, seed from oldUser!
        // - Otherwise (first passive sighting on messageCreate / guildMemberAdd), record baseline without false-positive spam!
        if (!existing) {
            const oldUser = options.oldUser && !options.oldUser.partial ? options.oldUser : null;
            const oldUserTag = oldUser ? extractActiveTag(oldUser) : undefined;
            const hasVerifiedGatewayTransition = oldUser !== null && !isSameActiveTag(oldUserTag, nextTag);

            if (!hasVerifiedGatewayTransition) {
                const seeded = await saveMemberTagRecord(client, {
                    guildId: guild.id,
                    userId: user.id,
                    username: user.username || null,
                    currentTag: nextTag,
                    installCount: 0,
                    changeCount: 0,
                    removeCount: 0,
                    hadTagBefore: Boolean(nextTag),
                    firstInstalledAt: nextTag ? now : null,
                    lastAction: "baseline",
                    lastUpdatedAt: now,
                    history: [],
                });

                return { status: "baseline", memberRecord: seeded };
            }

            existing = {
                guildId: guild.id,
                userId: user.id,
                username: oldUser.username || user.username || null,
                currentTag: toStoredTagObject(oldUserTag),
                installCount: 0,
                changeCount: 0,
                removeCount: 0,
                hadTagBefore: Boolean(oldUserTag),
                firstInstalledAt: oldUserTag ? now : null,
                lastAction: "baseline",
                lastUpdatedAt: now,
                history: [],
            };
        }

        const prevTag = normalizeStoredTag(existing.currentTag);

        if (isSameActiveTag(prevTag, nextTag)) {
            return { status: "no_change", memberRecord: existing };
        }

        // Determine exact activity type among the 4 supported Server Tag transitions
        let actionType = null;
        let installCount = Number(existing.installCount) || 0;
        let changeCount = Number(existing.changeCount) || 0;
        let removeCount = Number(existing.removeCount) || 0;
        const hadPriorHistory = Boolean(existing.hadTagBefore || installCount > 0 || removeCount > 0 || changeCount > 0);

        if (!prevTag && nextTag) {
            if (hadPriorHistory) {
                actionType = "reinstalled";
            } else {
                actionType = "installed";
            }
            installCount += 1;
        } else if (prevTag && nextTag) {
            actionType = "changed";
            changeCount += 1;
        } else if (prevTag && !nextTag) {
            actionType = "removed";
            removeCount += 1;
        }

        if (!actionType) {
            return { status: "no_change", memberRecord: existing };
        }

        const historyEntry = {
            action: actionType,
            previousTag: prevTag ? prevTag.tag : null,
            previousGuildId: prevTag ? prevTag.identityGuildId : null,
            newTag: nextTag ? nextTag.tag : null,
            newGuildId: nextTag ? nextTag.identityGuildId : null,
            timestamp: now.toISOString(),
        };

        const updatedMemberRecord = await saveMemberTagRecord(client, {
            ...existing,
            guildId: guild.id,
            userId: user.id,
            username: user.username || existing.username || null,
            currentTag: nextTag,
            installCount,
            changeCount,
            removeCount,
            hadTagBefore: Boolean(hadPriorHistory || prevTag || nextTag),
            firstInstalledAt: existing.firstInstalledAt || (nextTag ? now : null),
            lastAction: actionType,
            lastUpdatedAt: now,
            history: [historyEntry, ...(Array.isArray(existing.history) ? existing.history : [])].slice(0, MAX_MEMBER_HISTORY),
        });

        // Re-fetch latest guildData inside lock before incrementing stats
        const latestGuildData = await ensureGuildRecord(client, guild);
        const latestTagLog = latestGuildData.serverTagLog || {};
        const prevStats = latestTagLog.stats || {};

        const nextStats = {
            totalInstalled: (Number(prevStats.totalInstalled) || 0) + (actionType === "installed" || actionType === "reinstalled" ? 1 : 0),
            totalChanged: (Number(prevStats.totalChanged) || 0) + (actionType === "changed" ? 1 : 0),
            totalRemoved: (Number(prevStats.totalRemoved) || 0) + (actionType === "removed" ? 1 : 0),
            totalReinstalled: (Number(prevStats.totalReinstalled) || 0) + (actionType === "reinstalled" ? 1 : 0),
        };

        const guildHistoryItem = {
            userId: user.id,
            username: user.username || "Unknown",
            action: actionType,
            previousTag: prevTag ? prevTag.tag : null,
            newTag: nextTag ? nextTag.tag : null,
            tagGuildId: nextTag?.identityGuildId || prevTag?.identityGuildId || null,
            timestamp: now.toISOString(),
        };

        const nextRecentHistory = [
            guildHistoryItem,
            ...(Array.isArray(latestTagLog.recentHistory) ? latestTagLog.recentHistory : []),
        ].slice(0, MAX_GUILD_RECENT_HISTORY);

        const savedGuildTagLog = await persistGuildServerTagLog(client, guild, {
            ...latestTagLog,
            stats: nextStats,
            recentHistory: nextRecentHistory,
        });

        const member =
            options.member ||
            guild.members?.cache?.get?.(user.id) ||
            (hasServerMembersIntent(client) && typeof guild.members?.fetch === "function"
                ? await guild.members.fetch(user.id).catch(() => null)
                : null);

        const activeSummary = await countActiveTaggedMembers(client, guild.id);

        const embed = buildServerTagActivityEmbed({
            client,
            guild,
            user,
            member,
            actionType,
            prevTag,
            nextTag,
            memberRecord: updatedMemberRecord,
            guildStats: savedGuildTagLog.stats,
            activeSummary,
            timestamp: now,
        });

        const sent = await sendTagEmbedToLogChannel(client, guild, savedGuildTagLog.channelId, embed);

        return {
            status: actionType,
            sent,
            embed,
            memberRecord: updatedMemberRecord,
            guildStats: savedGuildTagLog.stats,
        };
    });
}

/**
 * Handles official Discord Gateway `userUpdate(oldUser, newUser)` event across all configured guilds.
 */
async function handleUserTagUpdate(client, oldUser, newUser) {
    if (!newUser || newUser.bot) return;

    // Fast-path: if oldUser was non-partial and primaryGuild didn't change at all, skip unless needed
    if (oldUser && !oldUser.partial) {
        const oldTag = extractActiveTag(oldUser);
        const newTag = extractActiveTag(newUser);
        if (isSameActiveTag(oldTag, newTag)) return;
    }

    for (const [, guild] of client.guilds.cache) {
        const cachedGuildData = client.data.get(`guildData_${guild.id}`);
        if (cachedGuildData && !cachedGuildData.serverTagLog?.enabled) continue;

        let member = guild.members?.cache?.get?.(newUser.id) || null;
        if (!member && hasServerMembersIntent(client) && typeof guild.members?.fetch === "function") {
            member = await guild.members.fetch(newUser.id).catch(() => null);
        }

        if (!member) continue;

        await evaluateGuildMemberTag(client, guild, newUser, {
            oldUser,
            member,
        }).catch((err) => {
            Logger.error(`[ServerTagLogger] Gagal memproses userUpdate di server ${guild.id}:`, err);
        });
    }
}

/**
 * Handles official Discord Gateway `guildMemberUpdate(oldMember, newMember)` event.
 * Catches updates even when the user wasn't previously in `client.users.cache`.
 */
async function handleGuildMemberTagUpdate(client, oldMember, newMember) {
    const guild = newMember?.guild || oldMember?.guild;
    const user = newMember?.user;
    if (!guild || !user || user.bot) return;

    const cachedGuildData = client.data.get(`guildData_${guild.id}`);
    if (cachedGuildData && !cachedGuildData.serverTagLog?.enabled) return;

    await evaluateGuildMemberTag(client, guild, user, {
        oldUser: oldMember && !oldMember.partial ? oldMember.user : null,
        member: newMember,
    }).catch((err) => {
        Logger.error(`[ServerTagLogger] Gagal memproses guildMemberUpdate di server ${guild.id}:`, err);
    });
}

/**
 * Passive observation helper called on `guildMemberAdd`, `messageCreate`, `interactionCreate`, and `voiceStateUpdate`.
 * Seeds unseen members safely and detects tag transitions if `Server Members Intent` is disabled.
 */
async function handlePassiveMemberObservation(client, guild, user, member = null) {
    if (!guild?.id || !user?.id || user.bot) return;

    const cachedGuildData = client.data.get(`guildData_${guild.id}`);
    if (!cachedGuildData?.serverTagLog?.enabled || !cachedGuildData?.serverTagLog?.channelId) return;

    await evaluateGuildMemberTag(client, guild, user, {
        member: member || guild.members?.cache?.get?.(user.id) || null,
    }).catch(() => {});
}

/**
 * Initializes baseline member Server Tag states on `clientReady` for all guilds with active `/setlogs`.
 */
async function initializeServerTagLogger(client) {
    if (!client?.guilds?.cache) return;

    for (const [, guild] of client.guilds.cache) {
        const guildData = await ensureGuildRecord(client, guild).catch(() => null);
        if (!guildData?.serverTagLog?.enabled || !guildData?.serverTagLog?.channelId) continue;

        await syncGuildMemberTagsBaseline(client, guild).catch((err) => {
            Logger.debug(`[ServerTagLogger] Lewati baseline awal untuk server ${guild.name}: ${err.message}`);
        });
    }
}

async function getServerTagStatsSnapshot(client, guild, targetUser = null) {
    const guildData = await ensureGuildRecord(client, guild);
    const tagLog = guildData.serverTagLog || {};
    const stats = tagLog.stats || {
        totalInstalled: 0,
        totalChanged: 0,
        totalRemoved: 0,
        totalReinstalled: 0,
    };
    const activeSummary = await countActiveTaggedMembers(client, guild.id);

    let memberDetail = null;
    if (targetUser) {
        const record = await getMemberTagRecord(client, guild.id, targetUser.id);
        const liveTag = extractActiveTag(targetUser);
        memberDetail = {
            user: targetUser,
            liveTag,
            record,
        };
    }

    return {
        enabled: Boolean(tagLog.enabled && tagLog.channelId),
        channelId: tagLog.channelId || null,
        updatedBy: tagLog.updatedBy || null,
        updatedAt: tagLog.updatedAt || null,
        stats: {
            totalInstalled: Number(stats.totalInstalled) || 0,
            totalChanged: Number(stats.totalChanged) || 0,
            totalRemoved: Number(stats.totalRemoved) || 0,
            totalReinstalled: Number(stats.totalReinstalled) || 0,
        },
        activeSummary,
        recentHistory: Array.isArray(tagLog.recentHistory) ? tagLog.recentHistory : [],
        memberDetail,
    };
}

module.exports = {
    TAG_COLORS,
    FOOTER_TEXT,
    REQUIRED_CHANNEL_PERMISSIONS,
    hasServerMembersIntent,
    hasAdminPermission,
    buildAdminDeniedEmbed,
    formatWibDateTime,
    extractActiveTag,
    isSameActiveTag,
    validateLogChannel,
    ensureGuildRecord,
    setServerTagLogChannel,
    resetServerTagLogChannel,
    getMemberTagRecord,
    countActiveTaggedMembers,
    syncGuildMemberTagsBaseline,
    buildServerTagActivityEmbed,
    evaluateGuildMemberTag,
    handleUserTagUpdate,
    handleGuildMemberTagUpdate,
    handlePassiveMemberObservation,
    initializeServerTagLogger,
    getServerTagStatsSnapshot,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
