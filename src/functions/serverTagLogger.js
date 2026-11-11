const mongoose = require("mongoose");
const { ChannelType, EmbedBuilder, GatewayIntentBits, PermissionsBitField, escapeMarkdown } = require("discord.js");
const ServerTagConfig = require("../databases/schema/serverTagConfig.js");
const ServerTagMember = require("../databases/schema/serverTagMember.js");
const Logger = require("../utils/logger");

const TAG_COLORS = {
    INSTALLED: 0x06b6d4, // Lagukan Signature Cyan
    CHANGED: 0x0ea5e9, // Lagukan Electric Blue
    REMOVED: 0x0891b2, // Lagukan Deep Cyan-Teal
    INFO: 0x06b6d4, // Lagukan Cyan
    WARNING: 0xf59e0b, // Warning Amber
    ERROR: 0xef4444, // Error Red
};

const FOOTER_TEXT = "LAGUKAN SERVER TAG LOGGER";
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

// Per-(guildId:userId) async lock to guarantee atomic state transitions without duplicate logs
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

const { isCloudDatabaseReady } = require("../databases/cloudAdapter");

function isMongoReady() {
    return mongoose.connection?.readyState === 1 || isCloudDatabaseReady();
}

function getConfigModel(client) {
    return client?.serverTagConfigData || ServerTagConfig;
}

function getMemberModel(client) {
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

function formatWibTimeShort(date = new Date()) {
    try {
        const formatted = new Intl.DateTimeFormat("id-ID", {
            timeZone: WIB_TIMEZONE,
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
        }).format(date);

        return `${formatted.replace(/\./g, ":")} WIB`;
    } catch {
        return `${date.toISOString().slice(11, 16)} UTC`;
    }
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

function buildTagBadgeUrl(identityGuildId, badge) {
    if (!identityGuildId || !badge) return null;
    return `https://cdn.discordapp.com/guild-tag-badges/${identityGuildId}/${badge}.png?size=128`;
}

/**
 * Dynamically extracts active Server Tag data strictly from official Discord API v10 `User.primaryGuild`.
 * Never uses static or hardcoded tag values.
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
        badgeUrl = buildTagBadgeUrl(identityGuildId, badge);
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
    const badgeUrl = stored.badgeUrl || buildTagBadgeUrl(identityGuildId, badge);

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

/**
 * Dynamically detects a guild's own Server Tag if exposed on the guild object or worn by any member of that guild.
 */
function detectGuildOwnTagFromMembers(guild, membersCollection) {
    if (!guild?.id) return null;

    const rawGuildTag = guild.clan?.tag || guild.profile?.tag || null;
    const rawGuildBadge = guild.clan?.badge || guild.profile?.badge || null;
    if (typeof rawGuildTag === "string" && rawGuildTag.trim()) {
        return {
            tag: rawGuildTag.trim(),
            badge: rawGuildBadge ? String(rawGuildBadge) : null,
            updatedAt: new Date(),
        };
    }

    if (membersCollection && typeof membersCollection.values === "function") {
        for (const member of membersCollection.values()) {
            if (!member?.user || member.user.bot) continue;
            const active = extractActiveTag(member.user);
            if (active && active.identityGuildId === String(guild.id)) {
                return {
                    tag: active.tag,
                    badge: active.badge || null,
                    updatedAt: new Date(),
                };
            }
        }
    }

    return null;
}

function normalizeServerTagConfig(guildId, raw = {}, guild = null) {
    const gId = String(raw.guildId || guildId || guild?.id || "");
    const rawStats = raw.statistics || raw.stats || {};
    const rawDetected = raw.detectedServerTag || {};
    const logChannelId = raw.logChannelId ?? raw.channelId ?? null;

    return {
        guildId: gId,
        guildName: guild?.name || raw.guildName || null,
        logChannelId: logChannelId ? String(logChannelId) : null,
        enabled: Boolean(raw.enabled && logChannelId),
        detectedServerTag: {
            tag: rawDetected.tag ? String(rawDetected.tag) : null,
            badge: rawDetected.badge ? String(rawDetected.badge) : null,
            updatedAt: rawDetected.updatedAt || null,
        },
        statistics: {
            installed: Math.max(0, Number(rawStats.installed ?? rawStats.totalInstalled) || 0),
            changed: Math.max(0, Number(rawStats.changed ?? rawStats.totalChanged) || 0),
            removed: Math.max(0, Number(rawStats.removed ?? rawStats.totalRemoved) || 0),
        },
        recentHistory: Array.isArray(raw.recentHistory) ? raw.recentHistory.slice(0, MAX_GUILD_RECENT_HISTORY) : [],
        updatedBy: raw.updatedBy ? String(raw.updatedBy) : null,
        updatedAt: raw.updatedAt || null,
    };
}

function getConfigCacheKey(guildId) {
    return `tagConfig_${guildId}`;
}

function getMemberCacheKey(guildId, userId) {
    return `tagMember_${guildId}_${userId}`;
}

function hasAdminPermission(memberOrInteraction, guild = null) {
    if (!memberOrInteraction) return false;

    const targetGuild = guild || memberOrInteraction.guild || null;
    const userId = memberOrInteraction.user?.id || memberOrInteraction.member?.user?.id || memberOrInteraction.id || null;

    if (targetGuild?.ownerId && userId && String(targetGuild.ownerId) === String(userId)) {
        return true;
    }

    if (typeof memberOrInteraction.memberPermissions?.has === "function") {
        return memberOrInteraction.memberPermissions.has(PermissionsBitField.Flags.Administrator);
    }

    const rawPerms = memberOrInteraction.permissions ?? memberOrInteraction.member?.permissions;
    if (typeof rawPerms?.has === "function") {
        return rawPerms.has(PermissionsBitField.Flags.Administrator);
    }

    if (typeof rawPerms === "string" || typeof rawPerms === "bigint" || typeof rawPerms === "number") {
        try {
            return new PermissionsBitField(BigInt(rawPerms)).has(PermissionsBitField.Flags.Administrator);
        } catch {
            return false;
        }
    }

    return false;
}

function getBotAvatarUrl(client) {
    return client?.user?.displayAvatarURL?.({ size: 128 }) || undefined;
}

function buildAdminDeniedEmbed(client, commandName) {
    return new EmbedBuilder()
        .setColor(TAG_COLORS.ERROR)
        .setTitle("⛔ Akses Ditolak")
        .setDescription(`Command \`/${commandName}\` hanya dapat dijalankan oleh **Administrator** pada server ini.`)
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

    if (channel.guildId && String(channel.guildId) !== String(guild.id)) {
        return {
            valid: false,
            code: "WRONG_GUILD",
            missingPermissions: [],
            message: "Channel yang dipilih bukan milik server ini.",
        };
    }

    const allowedTypes = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
    if (!allowedTypes.includes(channel.type)) {
        return {
            valid: false,
            code: "INVALID_CHANNEL_TYPE",
            missingPermissions: [],
            message: "Channel log harus berupa **Text Channel** atau **Announcement Channel** server (bukan Voice/Category/Forum).",
        };
    }

    const me = guild.members?.me;
    if (!me) {
        return {
            valid: false,
            code: "BOT_MEMBER_UNAVAILABLE",
            missingPermissions: [],
            message: "Data member bot pada server ini belum siap. Silakan coba beberapa saat lagi.",
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
            message: `Bot belum memiliki izin yang diperlukan pada channel <#${channel.id}>:\n${listText}\n\nSilakan berikan izin tersebut pada pengaturan channel atau role **Lagukan**, lalu coba kembali.`,
        };
    }

    return {
        valid: true,
        code: "OK",
        missingPermissions: [],
        message: null,
    };
}

/**
 * Retrieves or automatically initializes per-guild ServerTagConfig using MongoDB upsert keyed strictly by `guildId`.
 */
async function ensureServerTagConfig(client, guildOrId) {
    const guild = typeof guildOrId === "object" && guildOrId !== null ? guildOrId : client?.guilds?.cache?.get?.(String(guildOrId)) || null;
    const guildId = String(typeof guildOrId === "string" ? guildOrId : guild?.id || "");
    if (!guildId) return null;

    const cacheKey = getConfigCacheKey(guildId);
    const cached = client.data.get(cacheKey);
    if (cached) {
        if (guild?.name && cached.guildName !== guild.name) {
            cached.guildName = guild.name;
        }
        return cached;
    }

    // Check legacy guildData.serverTagLog for seamless migration if present
    const legacyTagLog = client.data.get(`guildData_${guildId}`)?.serverTagLog || null;
    const initialDefaults = normalizeServerTagConfig(
        guildId,
        legacyTagLog
            ? {
                  guildId,
                  guildName: guild?.name || null,
                  logChannelId: legacyTagLog.channelId || null,
                  enabled: Boolean(legacyTagLog.enabled && legacyTagLog.channelId),
                  statistics: {
                      installed: legacyTagLog.stats?.totalInstalled || 0,
                      changed: legacyTagLog.stats?.totalChanged || 0,
                      removed: legacyTagLog.stats?.totalRemoved || 0,
                  },
                  recentHistory: legacyTagLog.recentHistory || [],
                  updatedBy: legacyTagLog.updatedBy || null,
                  updatedAt: legacyTagLog.updatedAt || null,
              }
            : { guildId, guildName: guild?.name || null },
        guild,
    );

    if (isMongoReady()) {
        const ConfigModel = getConfigModel(client);
        const doc = await ConfigModel.findOneAndUpdate(
            { guildId },
            {
                $setOnInsert: initialDefaults,
            },
            { upsert: true, returnDocument: "after" },
        )
            .lean()
            .catch((err) => {
                Logger.error(`[ServerTagLogger] Gagal melakukan upsert konfigurasi awal untuk guild ${guildId}:`, err);
                return null;
            });

        if (doc) {
            const { _id, __v, ...raw } = doc;
            const normalized = normalizeServerTagConfig(guildId, raw, guild);
            client.data.set(cacheKey, normalized);
            return normalized;
        }
    }

    client.data.set(cacheKey, initialDefaults);
    return initialDefaults;
}

async function withMongoTimeout(promise, ms = 8000) {
    let timer = null;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    const timeoutErr = new Error("Waktu tunggu koneksi ke database MongoDB habis (timeout).");
                    timeoutErr.code = "MONGO_TIMEOUT";
                    reject(timeoutErr);
                }, ms);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function saveServerTagConfig(client, guildId, nextData, guild = null, options = {}) {
    const gId = String(guildId);
    const cacheKey = getConfigCacheKey(gId);
    const normalized = normalizeServerTagConfig(gId, { ...nextData, guildId: gId }, guild);
    const strictMongo = Boolean(options?.strictMongo);

    if (strictMongo) {
        if (!isMongoReady()) {
            const connErr = new Error("Database MongoDB sedang tidak terhubung. Pastikan MONGO_URI aktif dan koneksi jaringan stabil.");
            connErr.code = "MONGO_NOT_CONNECTED";
            throw connErr;
        }

        const ConfigModel = getConfigModel(client);
        let savedDoc;
        try {
            savedDoc = await withMongoTimeout(
                ConfigModel.findOneAndUpdate({ guildId: gId }, { $set: normalized }, { upsert: true, returnDocument: "after" }).lean(),
                8000,
            );
        } catch (err) {
            Logger.error(`[ServerTagLogger] Gagal menyimpan konfigurasi Server Tag ke MongoDB untuk guild ${gId}:`, err);
            const saveErr = new Error(
                err?.code === "MONGO_TIMEOUT"
                    ? err.message
                    : `Gagal menyimpan data ke database MongoDB (${err?.message || "kesalahan database"}).`,
            );
            saveErr.code = err?.code || "MONGO_WRITE_FAILED";
            throw saveErr;
        }

        if (!savedDoc) {
            const emptyErr = new Error("Database MongoDB tidak mengembalikan konfirmasi penyimpanan konfigurasi.");
            emptyErr.code = "MONGO_EMPTY_RESULT";
            throw emptyErr;
        }

        const { _id, __v, ...rawSaved } = savedDoc;
        const verified = normalizeServerTagConfig(gId, rawSaved, guild);
        client.data.set(cacheKey, verified);
        return verified;
    }

    client.data.set(cacheKey, normalized);

    if (isMongoReady()) {
        const ConfigModel = getConfigModel(client);
        await ConfigModel.findOneAndUpdate({ guildId: gId }, { $set: normalized }, { upsert: true, returnDocument: "after" }).catch(
            (err) => {
                Logger.error(`[ServerTagLogger] Gagal menyimpan konfigurasi Server Tag untuk guild ${gId}:`, err);
            },
        );
    }

    return normalized;
}

async function setServerTagLogChannel(client, guild, channelId, actorUserId, options = { strictMongo: true }) {
    const guildId = String(guild.id);
    const current = await ensureServerTagConfig(client, guild);

    const updated = await saveServerTagConfig(
        client,
        guildId,
        {
            ...current,
            guildId,
            guildName: guild.name || current.guildName,
            logChannelId: String(channelId),
            enabled: true,
            updatedBy: actorUserId ? String(actorUserId) : null,
            updatedAt: new Date(),
        },
        guild,
        { strictMongo: options?.strictMongo !== false },
    );

    // Run a fast bounded baseline check (max 2.5s) and let full member sync continue in background if needed
    const baselinePromise = syncGuildMemberTagsBaseline(client, guild).catch(() => ({
        syncedCount: guild.members?.cache ? [...guild.members.cache.values()].filter((m) => !m.user?.bot).length : 0,
        detectedTag: null,
    }));

    const { syncedCount, detectedTag } = await Promise.race([
        baselinePromise,
        new Promise((resolve) => {
            const cachedMembers = guild.members?.cache;
            const quickTag = detectGuildOwnTagFromMembers(guild, cachedMembers);
            const quickCount = cachedMembers ? [...cachedMembers.values()].filter((m) => !m.user?.bot).length : 0;
            setTimeout(() => resolve({ syncedCount: quickCount, detectedTag: quickTag?.tag || null }), 2500);
        }),
    ]);

    const finalConfig = await ensureServerTagConfig(client, guild);

    return {
        config: finalConfig || updated,
        syncedCount,
        detectedTag: detectedTag || finalConfig?.detectedServerTag?.tag || null,
    };
}

async function resetServerTagLogChannel(client, guild, actorUserId, options = { strictMongo: true }) {
    const guildId = String(guild.id);
    const current = await ensureServerTagConfig(client, guild);
    const wasConfigured = Boolean(current.enabled || current.logChannelId);
    const previousChannelId = current.logChannelId || null;

    const saved = await saveServerTagConfig(
        client,
        guildId,
        {
            ...current,
            guildId,
            guildName: guild.name || current.guildName,
            logChannelId: null,
            enabled: false,
            updatedBy: actorUserId ? String(actorUserId) : null,
            updatedAt: new Date(),
        },
        guild,
        { strictMongo: options?.strictMongo !== false },
    );

    return {
        wasConfigured,
        previousChannelId,
        config: saved,
    };
}

async function getMemberTagRecord(client, guildId, userId) {
    const gId = String(guildId);
    const uId = String(userId);
    const cacheKey = getMemberCacheKey(gId, uId);
    const cached = client.data.get(cacheKey);
    if (cached) return cached;

    if (isMongoReady()) {
        const MemberModel = getMemberModel(client);
        const doc = await MemberModel.findOne({ guildId: gId, userId: uId })
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
    const gId = String(record.guildId);
    const uId = String(record.userId);
    const cacheKey = getMemberCacheKey(gId, uId);

    const cleanRecord = {
        guildId: gId,
        userId: uId,
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
        const MemberModel = getMemberModel(client);
        await MemberModel.findOneAndUpdate(
            { guildId: gId, userId: uId },
            { $set: cleanRecord },
            { upsert: true, returnDocument: "after" },
        ).catch((err) => {
            Logger.error(`[ServerTagLogger] Gagal menyimpan riwayat member ${uId} pada guild ${gId}:`, err);
        });
    }

    return cleanRecord;
}

/**
 * Counts members in `guildId` who currently wear THIS server's own Server Tag (`identityGuildId === guildId`).
 */
async function countGuildOwnTaggedMembers(client, guildId) {
    const gId = String(guildId);

    if (isMongoReady()) {
        const MemberModel = getMemberModel(client);
        const docs = await MemberModel.find({ guildId: gId, "currentTag.identityEnabled": true }, { userId: 1, currentTag: 1 })
            .lean()
            .catch(() => null);

        if (Array.isArray(docs)) {
            const ownTagged = docs.filter(
                (d) => d.currentTag?.identityEnabled && d.currentTag?.tag && String(d.currentTag?.identityGuildId) === gId,
            );
            return ownTagged.length;
        }
    }

    const prefix = `tagMember_${gId}_`;
    let ownCount = 0;

    for (const [key, val] of client.data.entries()) {
        if (!key.startsWith(prefix)) continue;
        if (val?.currentTag?.identityEnabled && val?.currentTag?.tag && String(val.currentTag.identityGuildId) === gId) {
            ownCount += 1;
        }
    }

    return ownCount;
}

/**
 * Seeds baseline Server Tag states for a specific guild and dynamically detects the guild's own Server Tag.
 * Never sends notifications during baseline sync.
 */
async function syncGuildMemberTagsBaseline(client, guild) {
    if (!guild?.id) return { syncedCount: 0, detectedTag: null };

    const guildId = String(guild.id);
    let membersCollection = guild.members?.cache;

    if (hasServerMembersIntent(client) && typeof guild.members?.fetch === "function") {
        const fetched = await guild.members.fetch({ time: 15_000 }).catch(() => null);
        if (fetched) membersCollection = fetched;
    }

    const discoveredOwnTag = detectGuildOwnTagFromMembers(guild, membersCollection);
    if (discoveredOwnTag?.tag) {
        const currentCfg = await ensureServerTagConfig(client, guild);
        if (currentCfg.detectedServerTag?.tag !== discoveredOwnTag.tag || currentCfg.detectedServerTag?.badge !== discoveredOwnTag.badge) {
            await saveServerTagConfig(
                client,
                guildId,
                {
                    ...currentCfg,
                    detectedServerTag: discoveredOwnTag,
                },
                guild,
            );
        }
    }

    if (!membersCollection || membersCollection.size === 0) {
        return { syncedCount: 0, detectedTag: discoveredOwnTag?.tag || null };
    }

    let syncedCount = 0;
    const now = new Date();

    for (const [, member] of membersCollection) {
        const user = member?.user;
        if (!user || user.bot) continue;

        await withMemberLock(guildId, user.id, async () => {
            const existing = await getMemberTagRecord(client, guildId, user.id);
            const activeTag = extractActiveTag(user);
            const wearsThisGuildTag = Boolean(activeTag && activeTag.identityGuildId === guildId);

            if (!existing) {
                await saveMemberTagRecord(client, {
                    guildId,
                    userId: user.id,
                    username: user.username || null,
                    currentTag: activeTag,
                    installCount: 0,
                    changeCount: 0,
                    removeCount: 0,
                    hadTagBefore: wearsThisGuildTag,
                    firstInstalledAt: wearsThisGuildTag ? now : null,
                    lastAction: "baseline",
                    lastUpdatedAt: now,
                    history: [],
                });
                syncedCount += 1;
            } else {
                const prevStored = normalizeStoredTag(existing.currentTag);
                if (!isSameActiveTag(prevStored, activeTag)) {
                    await saveMemberTagRecord(client, {
                        ...existing,
                        username: user.username || existing.username || null,
                        currentTag: activeTag,
                        hadTagBefore: Boolean(existing.hadTagBefore || wearsThisGuildTag),
                        lastUpdatedAt: now,
                    });
                }
                syncedCount += 1;
            }
        });
    }

    return {
        syncedCount,
        detectedTag: discoveredOwnTag?.tag || null,
    };
}

/**
 * Automatically ensures a new or existing guild has its isolated ServerTagConfig and detects its own tag if available.
 */
async function initializeGuildServerTag(client, guild) {
    if (!guild?.id) return null;

    const config = await ensureServerTagConfig(client, guild);
    const discovered = detectGuildOwnTagFromMembers(guild, guild.members?.cache);

    if (discovered?.tag && config.detectedServerTag?.tag !== discovered.tag) {
        await saveServerTagConfig(
            client,
            guild.id,
            {
                ...config,
                detectedServerTag: discovered,
            },
            guild,
        );
    }

    if (config.enabled && config.logChannelId) {
        await syncGuildMemberTagsBaseline(client, guild).catch(() => {});
    }

    return config;
}

/**
 * Builds the Original Lagukan Cyan / Electric-Blue Notification Embed using 100% real Discord & MongoDB data.
 */
function buildServerTagActivityEmbed({ client, guild, user, actionType, prevTag, nextTag, statistics, timestamp = new Date() }) {
    const unixSec = Math.floor(timestamp.getTime() / 1000);
    const wibShort = formatWibTimeShort(timestamp);
    const wibFull = formatWibDateTime(timestamp);
    const botAvatar = getBotAvatarUrl(client);
    const guildIcon = guild.iconURL?.({ size: 128 }) || null;
    const relevantTagForBadge =
        (nextTag?.identityGuildId === String(guild.id) ? nextTag : null) ||
        (prevTag?.identityGuildId === String(guild.id) ? prevTag : null) ||
        nextTag ||
        prevTag;
    const authorIcon = relevantTagForBadge?.badgeUrl || guildIcon || botAvatar;
    const userAvatar = user.displayAvatarURL?.({ size: 256 }) || botAvatar;

    let embedColor = TAG_COLORS.INSTALLED;
    let title = "🏷️ SERVER TAG DIPASANG!";
    let activityLabel = "Memasang Server Tag";
    let description = `<@${user.id}> (\`@${escapeInlineCode(user.username)}\`) memasang **Server Tag** baru.`;
    const activityLines = [];

    if (actionType === "installed") {
        embedColor = TAG_COLORS.INSTALLED;
        title = "🏷️ SERVER TAG DIPASANG!";
        activityLabel = "Memasang Server Tag";
        description = `<@${user.id}> (\`@${escapeInlineCode(user.username)}\`) memasang **Server Tag** di **${escapeMarkdown(guild.name)}**.`;

        activityLines.push(`• **Jenis Aktivitas:** ${activityLabel}`);
        if (nextTag?.tag) {
            activityLines.push(
                `• **Server Tag Baru:** \`[${escapeInlineCode(nextTag.tag)}]\`${nextTag.badgeUrl ? ` • [Badge](${nextTag.badgeUrl})` : ""}`,
            );
        }
        activityLines.push(`• **Waktu:** \`${wibShort}\` (\`${wibFull}\` • <t:${unixSec}:R>)`);
    } else if (actionType === "changed") {
        embedColor = TAG_COLORS.CHANGED;
        title = "🔄 SERVER TAG DIGANTI!";
        activityLabel = "Mengganti Server Tag";
        description = `<@${user.id}> (\`@${escapeInlineCode(user.username)}\`) mengganti **Server Tag** pada profil Discord-nya.`;

        activityLines.push(`• **Jenis Aktivitas:** ${activityLabel}`);
        if (prevTag?.tag) {
            activityLines.push(`• **Server Tag Lama:** \`[${escapeInlineCode(prevTag.tag)}]\``);
        }
        if (nextTag?.tag) {
            activityLines.push(
                `• **Server Tag Baru:** \`[${escapeInlineCode(nextTag.tag)}]\`${nextTag.badgeUrl ? ` • [Badge](${nextTag.badgeUrl})` : ""}`,
            );
        }
        activityLines.push(`• **Waktu:** \`${wibShort}\` (\`${wibFull}\` • <t:${unixSec}:R>)`);
    } else if (actionType === "removed") {
        embedColor = TAG_COLORS.REMOVED;
        title = "🗑️ SERVER TAG DIHAPUS!";
        activityLabel = "Menghapus Server Tag";
        description = `<@${user.id}> (\`@${escapeInlineCode(user.username)}\`) menghapus **Server Tag** dari profil Discord-nya.`;

        activityLines.push(`• **Jenis Aktivitas:** ${activityLabel}`);
        if (prevTag?.tag) {
            activityLines.push(`• **Server Tag Lama:** \`[${escapeInlineCode(prevTag.tag)}]\``);
        }
        activityLines.push(`• **Waktu:** \`${wibShort}\` (\`${wibFull}\` • <t:${unixSec}:R>)`);
    }

    const serverMemberLines = [
        `• **Server:** **${escapeMarkdown(guild.name)}**`,
        `• **Server ID:** \`${guild.id}\``,
        `• **Member:** <@${user.id}> (\`@${escapeInlineCode(user.username)}\`)`,
        `• **User ID:** \`${user.id}\``,
    ];

    const installedTotal = Number(statistics?.installed) || 0;
    const changedTotal = Number(statistics?.changed) || 0;
    const removedTotal = Number(statistics?.removed) || 0;

    const statsLines = [`• **Dipasang:** \`${installedTotal}\` • **Diganti:** \`${changedTotal}\` • **Dihapus:** \`${removedTotal}\``];

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({
            name: `${guild.name} • Server Tag Logger`,
            iconURL: authorIcon || undefined,
        })
        .setTitle(title)
        .setDescription(description)
        .addFields(
            {
                name: "🏷️ Informasi Aktivitas",
                value: activityLines.join("\n"),
                inline: false,
            },
            {
                name: "🛡️ Informasi Server & Member",
                value: serverMemberLines.join("\n"),
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

async function sendTagEmbedToGuildLogChannel(client, guild, channelId, embed) {
    if (!guild?.id || !channelId) return false;

    let channel = guild.channels?.cache?.get?.(channelId) || null;
    if (!channel && typeof guild.channels?.fetch === "function") {
        channel = await guild.channels.fetch(channelId).catch(() => null);
    }

    // Strict multi-server guard: never send to a channel belonging to another guild
    if (!channel || (channel.guildId && String(channel.guildId) !== String(guild.id))) {
        logChannelWarningOnce(
            guild.id,
            channelId,
            `Channel log (${channelId}) pada server "${guild.name}" (${guild.id}) tidak ditemukan atau tidak valid.`,
        );
        return false;
    }

    const check = validateLogChannel(guild, channel);
    if (!check.valid) {
        logChannelWarningOnce(
            guild.id,
            channelId,
            `Izin bot kurang pada channel #${channel.name || channelId} di server "${guild.name}" (${guild.id}): ${check.code}`,
        );
        return false;
    }

    const sent = await channel.send({ embeds: [embed] }).catch((err) => {
        logChannelWarningOnce(
            guild.id,
            channelId,
            `Gagal mengirim log Server Tag ke #${channel.name || channelId} (${guild.id}): ${err.message}`,
        );
        return null;
    });

    return Boolean(sent);
}

/**
 * Evaluates a member's Server Tag state strictly within the context of `guild` (`guild.id`).
 * Multi-Server Isolation Guarantee:
 * - Only logs an activity in `guild` when `prevTag.identityGuildId === guild.id` OR `nextTag.identityGuildId === guild.id`.
 * - Never leaks Server A's tag events into Server B's log channel or statistics.
 */
async function evaluateGuildMemberTag(client, guild, user, options = {}) {
    if (!client || !guild?.id || !user?.id || user.bot) {
        return { status: "ignored" };
    }

    const guildId = String(guild.id);
    const tagConfig = await ensureServerTagConfig(client, guild);

    return withMemberLock(guildId, user.id, async () => {
        const now = options.timestamp instanceof Date ? options.timestamp : new Date();
        const nextTag = extractActiveTag(user);

        // Dynamically learn/refresh this guild's own Server Tag whenever a member wears `identityGuildId === guildId`
        if (nextTag && nextTag.identityGuildId === guildId) {
            const latestCfg = await ensureServerTagConfig(client, guild);
            if (latestCfg.detectedServerTag?.tag !== nextTag.tag || latestCfg.detectedServerTag?.badge !== nextTag.badge) {
                await saveServerTagConfig(
                    client,
                    guildId,
                    {
                        ...latestCfg,
                        detectedServerTag: {
                            tag: nextTag.tag,
                            badge: nextTag.badge || null,
                            updatedAt: now,
                        },
                    },
                    guild,
                );
            }
        }

        if (!tagConfig?.enabled || !tagConfig?.logChannelId) {
            return { status: "disabled" };
        }

        let existing = await getMemberTagRecord(client, guildId, user.id);
        const hasAuthoritativeOldUser = Boolean(options.oldUser && !options.oldUser.partial);
        const authoritativeOldTag = hasAuthoritativeOldUser ? extractActiveTag(options.oldUser) : undefined;

        if (!existing) {
            const hasVerifiedGatewayDiff = hasAuthoritativeOldUser && !isSameActiveTag(authoritativeOldTag, nextTag);

            if (!hasVerifiedGatewayDiff) {
                const seeded = await saveMemberTagRecord(client, {
                    guildId,
                    userId: user.id,
                    username: user.username || null,
                    currentTag: nextTag,
                    installCount: 0,
                    changeCount: 0,
                    removeCount: 0,
                    hadTagBefore: Boolean(nextTag && nextTag.identityGuildId === guildId),
                    firstInstalledAt: nextTag && nextTag.identityGuildId === guildId ? now : null,
                    lastAction: "baseline",
                    lastUpdatedAt: now,
                    history: [],
                });

                return { status: "baseline", memberRecord: seeded };
            }

            existing = {
                guildId,
                userId: user.id,
                username: options.oldUser.username || user.username || null,
                currentTag: toStoredTagObject(authoritativeOldTag),
                installCount: 0,
                changeCount: 0,
                removeCount: 0,
                hadTagBefore: Boolean(authoritativeOldTag && authoritativeOldTag.identityGuildId === guildId),
                firstInstalledAt: authoritativeOldTag && authoritativeOldTag.identityGuildId === guildId ? now : null,
                lastAction: "baseline",
                lastUpdatedAt: now,
                history: [],
            };
        }

        const storedPrevTag = normalizeStoredTag(existing.currentTag);

        // Dedup guard: if stored state already matches `nextTag`, this transition was already processed
        if (isSameActiveTag(storedPrevTag, nextTag)) {
            return { status: "no_change", memberRecord: existing };
        }

        // Use authoritative `oldUser` tag when available so unseen external changes never cause stale transitions
        const prevTag = hasAuthoritativeOldUser ? authoritativeOldTag : storedPrevTag;

        if (isSameActiveTag(prevTag, nextTag)) {
            const synced = await saveMemberTagRecord(client, {
                ...existing,
                username: user.username || existing.username || null,
                currentTag: nextTag,
                lastUpdatedAt: now,
            });
            return { status: "no_change", memberRecord: synced };
        }

        // MULTI-SERVER ISOLATION RULE:
        // Only emit logs & count statistics for `guildId` if either the previous tag OR the new tag belongs to `guildId`.
        const prevBelongsToGuild = Boolean(prevTag && prevTag.identityGuildId === guildId);
        const nextBelongsToGuild = Boolean(nextTag && nextTag.identityGuildId === guildId);
        const involvesThisGuild = prevBelongsToGuild || nextBelongsToGuild;

        if (!involvesThisGuild) {
            // Silently keep member's currentTag snapshot accurate without logging or touching statistics in unrelated servers
            const updatedSilent = await saveMemberTagRecord(client, {
                ...existing,
                username: user.username || existing.username || null,
                currentTag: nextTag,
                lastUpdatedAt: now,
            });
            return { status: "unrelated_guild", memberRecord: updatedSilent };
        }

        let actionType = null;
        let installCount = Number(existing.installCount) || 0;
        let changeCount = Number(existing.changeCount) || 0;
        let removeCount = Number(existing.removeCount) || 0;

        if (!prevTag && nextTag && nextBelongsToGuild) {
            actionType = "installed";
            installCount += 1;
        } else if (prevTag && nextTag) {
            actionType = "changed";
            changeCount += 1;
        } else if (prevTag && !nextTag && prevBelongsToGuild) {
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
            guildId,
            userId: user.id,
            username: user.username || existing.username || null,
            currentTag: nextTag,
            installCount,
            changeCount,
            removeCount,
            hadTagBefore: Boolean(existing.hadTagBefore || prevBelongsToGuild || nextBelongsToGuild),
            firstInstalledAt: existing.firstInstalledAt || (nextBelongsToGuild ? now : null),
            lastAction: actionType,
            lastUpdatedAt: now,
            history: [historyEntry, ...(Array.isArray(existing.history) ? existing.history : [])].slice(0, MAX_MEMBER_HISTORY),
        });

        // Re-read latest guild config inside lock & increment isolated statistics for THIS guildId only
        const latestConfig = await ensureServerTagConfig(client, guild);
        const prevStats = latestConfig.statistics || { installed: 0, changed: 0, removed: 0 };

        const nextStatistics = {
            installed: (Number(prevStats.installed) || 0) + (actionType === "installed" ? 1 : 0),
            changed: (Number(prevStats.changed) || 0) + (actionType === "changed" ? 1 : 0),
            removed: (Number(prevStats.removed) || 0) + (actionType === "removed" ? 1 : 0),
        };

        const guildHistoryItem = {
            userId: user.id,
            username: user.username || "Unknown",
            action: actionType,
            previousTag: prevTag ? prevTag.tag : null,
            newTag: nextTag ? nextTag.tag : null,
            timestamp: now.toISOString(),
        };

        const nextDetectedServerTag =
            nextBelongsToGuild && nextTag
                ? {
                      tag: nextTag.tag,
                      badge: nextTag.badge || null,
                      updatedAt: now,
                  }
                : prevBelongsToGuild && prevTag && !latestConfig.detectedServerTag?.tag
                  ? {
                        tag: prevTag.tag,
                        badge: prevTag.badge || null,
                        updatedAt: now,
                    }
                  : latestConfig.detectedServerTag;

        const savedConfig = await saveServerTagConfig(
            client,
            guildId,
            {
                ...latestConfig,
                guildName: guild.name || latestConfig.guildName,
                detectedServerTag: nextDetectedServerTag,
                statistics: nextStatistics,
                recentHistory: [guildHistoryItem, ...(Array.isArray(latestConfig.recentHistory) ? latestConfig.recentHistory : [])].slice(
                    0,
                    MAX_GUILD_RECENT_HISTORY,
                ),
            },
            guild,
        );

        const embed = buildServerTagActivityEmbed({
            client,
            guild,
            user,
            actionType,
            prevTag,
            nextTag,
            statistics: savedConfig.statistics,
            timestamp: now,
        });

        const sent = await sendTagEmbedToGuildLogChannel(client, guild, savedConfig.logChannelId, embed);

        return {
            status: actionType,
            sent,
            embed,
            memberRecord: updatedMemberRecord,
            statistics: savedConfig.statistics,
        };
    });
}

/**
 * Finds guild IDs where `userId` previously had a stored active tag (used when `oldUser` was partial).
 */
async function findStoredGuildIdsForUser(client, userId) {
    const uId = String(userId);
    const guildIds = new Set();

    for (const [key, val] of client.data.entries()) {
        if (!key.startsWith("tagMember_") || !key.endsWith(`_${uId}`)) continue;
        if (val?.currentTag?.identityEnabled && val?.guildId) {
            guildIds.add(String(val.guildId));
        }
    }

    if (isMongoReady()) {
        const MemberModel = getMemberModel(client);
        const docs = await MemberModel.find({ userId: uId, "currentTag.identityEnabled": true }, { guildId: 1, currentTag: 1 })
            .lean()
            .catch(() => null);

        if (Array.isArray(docs)) {
            for (const d of docs) {
                if (d?.guildId) guildIds.add(String(d.guildId));
            }
        }
    }

    return guildIds;
}

/**
 * Handles official Discord Gateway `userUpdate(oldUser, newUser)` with strict multi-server routing:
 * Only targets guilds directly matching `oldTag.identityGuildId`, `newTag.identityGuildId`, or stored active tag records.
 */
async function handleUserTagUpdate(client, oldUser, newUser) {
    if (!newUser || newUser.bot) return;

    const hasFullOldUser = Boolean(oldUser && !oldUser.partial);
    const oldTag = hasFullOldUser ? extractActiveTag(oldUser) : undefined;
    const newTag = extractActiveTag(newUser);

    if (hasFullOldUser && isSameActiveTag(oldTag, newTag)) {
        return;
    }

    const candidateGuildIds = new Set();

    if (newTag?.identityGuildId && client.guilds.cache.has(newTag.identityGuildId)) {
        candidateGuildIds.add(String(newTag.identityGuildId));
    }

    if (oldTag?.identityGuildId && client.guilds.cache.has(oldTag.identityGuildId)) {
        candidateGuildIds.add(String(oldTag.identityGuildId));
    }

    // Also include guilds where this user had an active stored tag record so partial-oldUser removals & state sync stay exact
    const storedGuildIds = await findStoredGuildIdsForUser(client, newUser.id);
    for (const gId of storedGuildIds) {
        if (client.guilds.cache.has(gId)) {
            candidateGuildIds.add(gId);
        }
    }

    for (const guildId of candidateGuildIds) {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) continue;

        let member = guild.members?.cache?.get?.(newUser.id) || null;
        if (!member && hasServerMembersIntent(client) && typeof guild.members?.fetch === "function") {
            member = await guild.members.fetch(newUser.id).catch(() => null);
        }

        if (!member) continue;

        await evaluateGuildMemberTag(client, guild, newUser, {
            oldUser: hasFullOldUser ? oldUser : null,
            member,
        }).catch((err) => {
            Logger.error(`[ServerTagLogger] Gagal memproses perubahan tag pada server ${guildId}:`, err);
        });
    }
}

/**
 * Handles official Discord Gateway `guildMemberUpdate(oldMember, newMember)` scoped strictly to `newMember.guild`.
 */
async function handleGuildMemberTagUpdate(client, oldMember, newMember) {
    const guild = newMember?.guild || oldMember?.guild;
    const user = newMember?.user;
    if (!guild?.id || !user?.id || user.bot) return;

    const config = await ensureServerTagConfig(client, guild);
    if (!config?.enabled || !config?.logChannelId) {
        // Still allow dynamic tag discovery if member wears this guild's own tag
        const active = extractActiveTag(user);
        if (active && active.identityGuildId === String(guild.id) && config.detectedServerTag?.tag !== active.tag) {
            await saveServerTagConfig(
                client,
                guild.id,
                {
                    ...config,
                    detectedServerTag: {
                        tag: active.tag,
                        badge: active.badge || null,
                        updatedAt: new Date(),
                    },
                },
                guild,
            );
        }
        return;
    }

    // Note: in discord.js, `oldMember.user` is the same User reference mutated by UserUpdateAction,
    // so we do NOT pass `oldMember.user` as `oldUser`; stored per-guild state handles uncached transitions cleanly.
    await evaluateGuildMemberTag(client, guild, user, {
        oldUser: null,
        member: newMember,
    }).catch((err) => {
        Logger.error(`[ServerTagLogger] Gagal memproses guildMemberUpdate pada server ${guild.id}:`, err);
    });
}

/**
 * Passive per-guild observation on `guildMemberAdd`, `messageCreate`, `interactionCreate`, and `voiceStateUpdate`.
 */
async function handlePassiveMemberObservation(client, guild, user, member = null) {
    if (!guild?.id || !user?.id || user.bot) return;

    const cachedConfig = client.data.get(getConfigCacheKey(guild.id));
    if (cachedConfig && (!cachedConfig.enabled || !cachedConfig.logChannelId)) {
        const active = extractActiveTag(user);
        if (active && active.identityGuildId === String(guild.id) && cachedConfig.detectedServerTag?.tag !== active.tag) {
            await saveServerTagConfig(
                client,
                guild.id,
                {
                    ...cachedConfig,
                    detectedServerTag: {
                        tag: active.tag,
                        badge: active.badge || null,
                        updatedAt: new Date(),
                    },
                },
                guild,
            ).catch(() => {});
        }
        return;
    }

    await evaluateGuildMemberTag(client, guild, user, {
        oldUser: null,
        member: member || guild.members?.cache?.get?.(user.id) || null,
    }).catch(() => {});
}

/**
 * Initializes Server Tag Logger configs & baselines across all joined servers on `clientReady`.
 */
async function initializeServerTagLogger(client) {
    if (!client?.guilds?.cache) return;

    for (const [, guild] of client.guilds.cache) {
        await initializeGuildServerTag(client, guild).catch((err) => {
            Logger.debug(`[ServerTagLogger] Inisialisasi awal dilewati untuk server ${guild.id}: ${err.message}`);
        });
    }
}

/**
 * Returns an isolated snapshot of Server Tag Logger configuration & statistics strictly for `guild`.
 */
async function getServerTagStatsSnapshot(client, guild, targetUser = null) {
    const guildId = String(guild.id);
    const config = await ensureServerTagConfig(client, guild);

    // Refresh detected tag from cached members if not yet recorded
    let detectedTag = config.detectedServerTag?.tag || null;
    if (!detectedTag) {
        const discovered = detectGuildOwnTagFromMembers(guild, guild.members?.cache);
        if (discovered?.tag) {
            detectedTag = discovered.tag;
            await saveServerTagConfig(
                client,
                guildId,
                {
                    ...config,
                    detectedServerTag: discovered,
                },
                guild,
            );
        }
    }

    const activeOwnTagMembers = await countGuildOwnTaggedMembers(client, guildId);
    const hasGuildTagsFeature = Array.isArray(guild.features) && guild.features.includes("GUILD_TAGS");

    let memberDetail = null;
    if (targetUser) {
        const record = await getMemberTagRecord(client, guildId, targetUser.id);
        const liveTag = extractActiveTag(targetUser);
        memberDetail = {
            user: targetUser,
            liveTag,
            wearsThisGuildTag: Boolean(liveTag && liveTag.identityGuildId === guildId),
            record,
        };
    }

    return {
        guildId,
        guildName: guild.name,
        enabled: Boolean(config.enabled && config.logChannelId),
        logChannelId: config.logChannelId || null,
        detectedServerTag: detectedTag,
        hasGuildTagsFeature,
        updatedBy: config.updatedBy || null,
        updatedAt: config.updatedAt || null,
        statistics: {
            installed: Number(config.statistics?.installed) || 0,
            changed: Number(config.statistics?.changed) || 0,
            removed: Number(config.statistics?.removed) || 0,
        },
        activeOwnTagMembers,
        recentHistory: Array.isArray(config.recentHistory) ? config.recentHistory : [],
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
    formatWibTimeShort,
    formatWibDateTime,
    extractActiveTag,
    isSameActiveTag,
    detectGuildOwnTagFromMembers,
    validateLogChannel,
    ensureServerTagConfig,
    setServerTagLogChannel,
    resetServerTagLogChannel,
    getMemberTagRecord,
    countGuildOwnTaggedMembers,
    syncGuildMemberTagsBaseline,
    initializeGuildServerTag,
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
