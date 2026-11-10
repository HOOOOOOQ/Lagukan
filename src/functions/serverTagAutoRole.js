const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags,
    PermissionsBitField,
    RoleSelectMenuBuilder,
    escapeMarkdown,
} = require("discord.js");
const mongoose = require("mongoose");
const ServerTagAutoRole = require("../databases/schema/serverTagAutoRole.js");
const { hasAdminPermission, hasServerMembersIntent, buildAdminDeniedEmbed, detectGuildOwnTagFromMembers } = require("./serverTagLogger.js");
const { safeDeferUpdate, safeEditReply, safeReply } = require("./interactionResponder.js");
const Logger = require("../utils/logger");

const AUTO_ROLE_COLORS = {
    PRIMARY: 0x00e5ff, // Lagukan Electric Cyan
    ACTIVE: 0x00b4d8, // Electric Blue
    INACTIVE: 0x2f3542, // Modern Dark Slate
    WARNING: 0xffa502, // Amber Warning
    ERROR: 0xff4757, // Alert Red
};

const AUTO_ROLE_FOOTER = "LAGUKAN SERVER TAG AUTO ROLE";
const COMPONENT_PREFIX = "tagrole";

// Per-(guildId, userId) mutex so concurrent Gateway events never grant/revoke roles twice
const autoRoleLocks = new Map();

function withAutoRoleLock(guildId, userId, task) {
    const key = `${guildId}:${userId}`;
    const prev = autoRoleLocks.get(key) || Promise.resolve();
    const next = prev
        .catch(() => {})
        .then(() => task())
        .finally(() => {
            if (autoRoleLocks.get(key) === next) {
                autoRoleLocks.delete(key);
            }
        });

    autoRoleLocks.set(key, next);
    return next;
}

function isMongoReady() {
    return mongoose.connection?.readyState === 1;
}

function getAutoRoleModel(client) {
    return client?.serverTagAutoRoleData || ServerTagAutoRole;
}

function getAutoRoleCacheKey(guildId) {
    return `tagAutoRole_${guildId}`;
}

function getLastTagGuildCacheKey(userId) {
    return `lastTagGuild_${userId}`;
}

function getBotAvatarUrl(client) {
    return client?.user?.displayAvatarURL?.({ size: 128 }) || undefined;
}

function escapeInline(value) {
    return String(value ?? "").replace(/`/g, "ˋ");
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

/**
 * Extracts Server Tag identity strictly from official Discord API v10 / Gateway user fields:
 * `primaryGuild` (discord.js camelCase), `primary_guild` (Gateway snake_case), or `clan`.
 */
function extractUserTagIdentity(userLike) {
    if (!userLike || typeof userLike !== "object") {
        return {
            hasIdentityField: false,
            identityGuildId: null,
            identityEnabled: false,
            tag: null,
            badge: null,
        };
    }

    const hasField = "primaryGuild" in userLike || "primary_guild" in userLike || "clan" in userLike;
    const raw = userLike.primaryGuild ?? userLike.primary_guild ?? userLike.clan ?? null;

    if (!raw || typeof raw !== "object") {
        return {
            hasIdentityField: hasField,
            identityGuildId: null,
            identityEnabled: false,
            tag: null,
            badge: null,
        };
    }

    const rawGuildId = raw.identityGuildId ?? raw.identity_guild_id ?? null;
    const rawEnabled = raw.identityEnabled ?? raw.identity_enabled ?? false;
    const rawTag = typeof raw.tag === "string" && raw.tag.trim() ? raw.tag.trim() : null;
    const rawBadge = raw.badge ? String(raw.badge) : null;

    return {
        hasIdentityField: true,
        identityGuildId: rawGuildId ? String(rawGuildId) : null,
        identityEnabled: rawEnabled === true,
        tag: rawTag,
        badge: rawBadge,
    };
}

/**
 * Matches strictly by Discord Server ID (`identity_guild_id === guildId`) AND `identity_enabled === true`.
 * Never relies solely on tag text so another server with a similar tag name can never trigger Auto Role.
 */
function doesIdentityMatchGuild(identity, guildId) {
    if (!identity || !guildId) return false;
    return Boolean(identity.identityEnabled === true && identity.identityGuildId && String(identity.identityGuildId) === String(guildId));
}

function normalizeAutoRoleConfig(guildId, raw = {}) {
    const gId = String(raw?.guildId || guildId || "");
    const roleId = raw?.roleId ? String(raw.roleId) : null;
    const assigned = Array.isArray(raw?.assignedUsers) ? [...new Set(raw.assignedUsers.filter(Boolean).map((id) => String(id)))] : [];

    return {
        guildId: gId,
        enabled: Boolean(raw?.enabled && roleId),
        roleId,
        configuredBy: raw?.configuredBy ? String(raw.configuredBy) : null,
        assignedUsers: assigned,
        createdAt: raw?.createdAt ? new Date(raw.createdAt) : null,
        updatedAt: raw?.updatedAt ? new Date(raw.updatedAt) : null,
    };
}

/**
 * Loads per-guild Auto Role configuration from cache or MongoDB without creating unnecessary empty rows unless requested.
 */
async function ensureTagRoleConfig(client, guildOrId) {
    const guildId = String(typeof guildOrId === "string" ? guildOrId : guildOrId?.id || "");
    if (!guildId) return null;

    const cacheKey = getAutoRoleCacheKey(guildId);
    const cached = client.data.get(cacheKey);
    if (cached) return cached;

    if (isMongoReady()) {
        const AutoRoleModel = getAutoRoleModel(client);
        const doc = await AutoRoleModel.findOne({ guildId })
            .lean()
            .catch((err) => {
                Logger.error(`[ServerTagAutoRole] Gagal membaca konfigurasi Auto Role untuk guild ${guildId}:`, err);
                return null;
            });

        if (doc) {
            const normalized = normalizeAutoRoleConfig(guildId, doc);
            client.data.set(cacheKey, normalized);
            for (const uid of normalized.assignedUsers) {
                if (!client.data.has(getLastTagGuildCacheKey(uid))) {
                    client.data.set(getLastTagGuildCacheKey(uid), guildId);
                }
            }
            return normalized;
        }
    }

    const emptyConfig = normalizeAutoRoleConfig(guildId, { guildId });
    client.data.set(cacheKey, emptyConfig);
    return emptyConfig;
}

/**
 * Persists per-guild Auto Role configuration to MongoDB.
 * When `options.strictMongo` is true, verifies MongoDB connection & write completion before returning.
 */
async function saveTagRoleConfig(client, guildId, nextData, options = {}) {
    const gId = String(guildId);
    const cacheKey = getAutoRoleCacheKey(gId);
    const strictMongo = Boolean(options?.strictMongo);
    const now = new Date();

    const existing = client.data.get(cacheKey);
    const createdAt = existing?.createdAt || nextData?.createdAt || now;
    const payload = normalizeAutoRoleConfig(gId, {
        ...existing,
        ...nextData,
        guildId: gId,
        createdAt,
        updatedAt: now,
    });

    if (strictMongo) {
        if (!isMongoReady()) {
            const connErr = new Error(
                "Database MongoDB sedang tidak terhubung. Pastikan variabel MONGO_URI aktif dan koneksi internet stabil.",
            );
            connErr.code = "MONGO_NOT_CONNECTED";
            throw connErr;
        }

        const AutoRoleModel = getAutoRoleModel(client);
        let savedDoc;
        try {
            savedDoc = await withMongoTimeout(
                AutoRoleModel.findOneAndUpdate(
                    { guildId: gId },
                    {
                        $set: {
                            guildId: gId,
                            enabled: payload.enabled,
                            roleId: payload.roleId,
                            configuredBy: payload.configuredBy,
                            assignedUsers: payload.assignedUsers,
                            updatedAt: now,
                        },
                        $setOnInsert: {
                            createdAt,
                        },
                    },
                    { upsert: true, returnDocument: "after" },
                ).lean(),
                8000,
            );
        } catch (err) {
            Logger.error(`[ServerTagAutoRole] Gagal menyimpan konfigurasi Auto Role ke MongoDB untuk guild ${gId}:`, err);
            const saveErr = new Error(
                err?.code === "MONGO_TIMEOUT"
                    ? err.message
                    : `Gagal menyimpan konfigurasi Auto Role ke MongoDB (${err?.message || "kesalahan database"}).`,
            );
            saveErr.code = err?.code || "MONGO_WRITE_FAILED";
            throw saveErr;
        }

        if (!savedDoc) {
            const emptyErr = new Error("Database MongoDB tidak mengembalikan konfirmasi penyimpanan Auto Role.");
            emptyErr.code = "MONGO_EMPTY_RESULT";
            throw emptyErr;
        }

        const verified = normalizeAutoRoleConfig(gId, savedDoc);
        client.data.set(cacheKey, verified);
        return verified;
    }

    client.data.set(cacheKey, payload);

    if (isMongoReady()) {
        const AutoRoleModel = getAutoRoleModel(client);
        try {
            await AutoRoleModel.findOneAndUpdate(
                { guildId: gId },
                {
                    $set: {
                        guildId: gId,
                        enabled: payload.enabled,
                        roleId: payload.roleId,
                        configuredBy: payload.configuredBy,
                        assignedUsers: payload.assignedUsers,
                        updatedAt: now,
                    },
                    $setOnInsert: {
                        createdAt,
                    },
                },
                { upsert: true, returnDocument: "after" },
            ).lean();
        } catch (err) {
            Logger.error(`[ServerTagAutoRole] Gagal sinkronisasi konfigurasi Auto Role untuk guild ${gId}:`, err);
        }
    }

    return payload;
}

/**
 * Resets / removes Auto Role configuration for a specific guild in MongoDB.
 */
async function resetTagRoleConfig(client, guildId, actorUserId, options = { strictMongo: true }) {
    const gId = String(guildId);
    const current = await ensureTagRoleConfig(client, gId);
    const wasConfigured = Boolean(current?.roleId || current?.enabled);
    const previousRoleId = current?.roleId || null;

    if (options?.strictMongo !== false) {
        if (!isMongoReady()) {
            const connErr = new Error(
                "Database MongoDB sedang tidak terhubung. Pastikan variabel MONGO_URI aktif dan koneksi internet stabil.",
            );
            connErr.code = "MONGO_NOT_CONNECTED";
            throw connErr;
        }

        const AutoRoleModel = getAutoRoleModel(client);
        try {
            await withMongoTimeout(AutoRoleModel.deleteOne({ guildId: gId }), 8000);
        } catch (err) {
            Logger.error(`[ServerTagAutoRole] Gagal menghapus konfigurasi Auto Role pada guild ${gId}:`, err);
            const delErr = new Error(
                err?.code === "MONGO_TIMEOUT"
                    ? err.message
                    : `Gagal mereset konfigurasi Auto Role di MongoDB (${err?.message || "kesalahan database"}).`,
            );
            delErr.code = err?.code || "MONGO_DELETE_FAILED";
            throw delErr;
        }
    } else if (isMongoReady()) {
        const AutoRoleModel = getAutoRoleModel(client);
        await AutoRoleModel.deleteOne({ guildId: gId }).catch(() => {});
    }

    const cleared = normalizeAutoRoleConfig(gId, {
        guildId: gId,
        enabled: false,
        roleId: null,
        configuredBy: actorUserId ? String(actorUserId) : null,
        assignedUsers: [],
        createdAt: null,
        updatedAt: null,
    });

    client.data.set(getAutoRoleCacheKey(gId), cleared);

    return {
        wasConfigured,
        previousRoleId,
        config: cleared,
    };
}

/**
 * Resolves a guild role by ID from cache or Discord API.
 */
async function resolveGuildRole(guild, roleId) {
    if (!guild || !roleId) return null;
    const rId = String(roleId);

    const cached = guild.roles?.cache?.get?.(rId);
    if (cached) return cached;

    if (typeof guild.roles?.fetch === "function") {
        const fetched = await guild.roles.fetch(rId).catch(() => null);
        if (fetched) return fetched;
    }

    return null;
}

async function resolveBotMember(guild) {
    if (!guild) return null;
    if (guild.members?.me) return guild.members.me;
    if (typeof guild.members?.fetchMe === "function") {
        return guild.members.fetchMe().catch(() => null);
    }
    return null;
}

/**
 * Validates security, permissions, `@everyone` ban, managed-role check, and role hierarchy for Auto Role.
 */
async function validateAutoRoleTarget(guild, roleOrId) {
    if (!guild) {
        return {
            valid: false,
            code: "GUILD_NOT_FOUND",
            role: null,
            message: "Server Discord tidak ditemukan di cache bot.",
        };
    }

    const role =
        typeof roleOrId === "object" && roleOrId !== null
            ? (await resolveGuildRole(guild, roleOrId.id)) || roleOrId
            : await resolveGuildRole(guild, roleOrId);

    if (!role) {
        return {
            valid: false,
            code: "ROLE_NOT_FOUND",
            role: null,
            message: "Role tidak ditemukan di server ini (kemungkinan sudah dihapus). Silakan pilih role lain.",
        };
    }

    if (role.guild?.id && String(role.guild.id) !== String(guild.id)) {
        return {
            valid: false,
            code: "WRONG_GUILD",
            role: null,
            message: "Role yang dipilih bukan milik server ini.",
        };
    }

    if (String(role.id) === String(guild.id)) {
        return {
            valid: false,
            code: "EVERYONE_FORBIDDEN",
            role,
            message: "Role `@everyone` tidak diizinkan sebagai **Server Tag Auto Role**. Silakan pilih role khusus lainnya.",
        };
    }

    if (role.managed) {
        return {
            valid: false,
            code: "MANAGED_ROLE",
            role,
            message: `Role <@&${role.id}> dikelola secara otomatis oleh integrasi eksternal atau Discord (misalnya role Bot atau Server Booster) sehingga tidak dapat diberikan oleh bot. Silakan pilih role server biasa.`,
        };
    }

    const botMember = await resolveBotMember(guild);
    if (!botMember) {
        return {
            valid: false,
            code: "BOT_MEMBER_UNAVAILABLE",
            role,
            message: "Data member bot pada server ini belum tersedia. Silakan coba beberapa saat lagi.",
        };
    }

    if (!botMember.permissions?.has?.(PermissionsBitField.Flags.ManageRoles)) {
        return {
            valid: false,
            code: "BOT_MISSING_MANAGE_ROLES",
            role,
            message:
                "Bot **Lagukan** belum memiliki permission **`Manage Roles`** pada server ini. Aktifkan izin **`Manage Roles`** pada role Lagukan di **Pengaturan Server → Roles** terlebih dahulu.",
        };
    }

    const botHighestRole = botMember.roles?.highest;
    if (botHighestRole && typeof role.position === "number" && typeof botHighestRole.position === "number") {
        if (role.position >= botHighestRole.position) {
            return {
                valid: false,
                code: "ROLE_ABOVE_BOT",
                role,
                message: `Role <@&${role.id}> berada di atas atau sejajar dengan role tertinggi **Lagukan** (<@&${botHighestRole.id}>). Pindahkan posisi role **Lagukan** ke atas <@&${role.id}> pada **Pengaturan Server → Roles**, atau pilih role yang posisinya lebih rendah.`,
            };
        }
    }

    if (role.editable === false) {
        return {
            valid: false,
            code: "ROLE_NOT_EDITABLE",
            role,
            message: `Role <@&${role.id}> tidak dapat dikelola oleh **Lagukan**. Pastikan izin **Manage Roles** aktif dan posisi role Lagukan berada di atas role tersebut.`,
        };
    }

    return {
        valid: true,
        code: "OK",
        role,
        message: null,
    };
}

/**
 * Inspects overall bot permission & configured role health for `/settagrole` and `/cektagrole`.
 */
async function inspectAutoRoleHealth(guild, roleId) {
    const botMember = await resolveBotMember(guild);
    const hasManageRoles = Boolean(botMember?.permissions?.has?.(PermissionsBitField.Flags.ManageRoles));
    const botHighestRole = botMember?.roles?.highest || null;

    if (!roleId) {
        return {
            hasManageRoles,
            botHighestRole,
            roleExists: false,
            role: null,
            hierarchyOk: true,
            valid: false,
            warning: hasManageRoles
                ? null
                : "Bot belum memiliki permission **`Manage Roles`**. Berikan izin tersebut agar fitur Auto Role dapat bekerja.",
        };
    }

    const validation = await validateAutoRoleTarget(guild, roleId);
    return {
        hasManageRoles,
        botHighestRole,
        roleExists: validation.code !== "ROLE_NOT_FOUND",
        role: validation.role,
        hierarchyOk: validation.code !== "ROLE_ABOVE_BOT" && validation.code !== "ROLE_NOT_EDITABLE",
        valid: validation.valid,
        code: validation.code,
        warning: validation.valid ? null : validation.message,
    };
}

async function addTrackedAssignedUser(client, guildId, userId) {
    const gId = String(guildId);
    const uId = String(userId);
    client.data.set(getLastTagGuildCacheKey(uId), gId);

    const current = await ensureTagRoleConfig(client, gId);
    if (!current) return;

    if (!current.assignedUsers.includes(uId)) {
        const updatedList = [...current.assignedUsers, uId];
        await saveTagRoleConfig(client, gId, {
            ...current,
            assignedUsers: updatedList,
        });
    }
}

async function removeTrackedAssignedUser(client, guildId, userId) {
    const gId = String(guildId);
    const uId = String(userId);

    if (client.data.get(getLastTagGuildCacheKey(uId)) === gId) {
        client.data.delete(getLastTagGuildCacheKey(uId));
    }

    const current = await ensureTagRoleConfig(client, gId);
    if (!current) return;

    if (current.assignedUsers.includes(uId)) {
        const updatedList = current.assignedUsers.filter((id) => id !== uId);
        await saveTagRoleConfig(client, gId, {
            ...current,
            assignedUsers: updatedList,
        });
    }
}

/**
 * Evaluates a single member's Server Tag identity for `guild` and automatically grants or revokes the configured Auto Role.
 * - Matches strictly by `identity_guild_id === guild.id` AND `identity_enabled === true`.
 * - Never grants roles to bots.
 * - Prevents duplicate role assignments.
 * - Never removes roles not managed by Auto Role.
 * - Gracefully handles deleted roles or missing permissions.
 */
async function evaluateMemberTagAutoRole(client, guild, userLike, options = {}) {
    if (!guild?.id || !userLike) return { action: "ignored" };

    const userId = String(userLike.id || options?.userId || "");
    if (!userId) return { action: "ignored" };

    if (userLike.bot || options?.member?.user?.bot) {
        return { action: "skipped_bot" };
    }

    const guildId = String(guild.id);

    return withAutoRoleLock(guildId, userId, async () => {
        const config = await ensureTagRoleConfig(client, guild);
        if (!config?.enabled || !config?.roleId) {
            return { action: "disabled" };
        }

        const roleId = String(config.roleId);
        if (roleId === guildId) {
            return { action: "forbidden_everyone" };
        }

        const identity = extractUserTagIdentity(userLike);
        // If payload carried no identity information at all (partial user without primary_guild), avoid false revocations
        if (!identity.hasIdentityField && !options.forceEvaluateWithoutField) {
            return { action: "no_identity_field" };
        }

        const qualifies = doesIdentityMatchGuild(identity, guildId);
        const wasManaged =
            config.assignedUsers.includes(userId) ||
            client.data.get(getLastTagGuildCacheKey(userId)) === guildId ||
            Boolean(options.forceManagedRevoke);

        // Fast exit when member neither qualifies nor holds an Auto-Role-managed assignment in this server
        if (!qualifies && !wasManaged) {
            return { action: "noop" };
        }

        const validation = await validateAutoRoleTarget(guild, roleId);
        if (!validation.valid) {
            if (validation.code === "ROLE_NOT_FOUND") {
                Logger.warn(
                    `[ServerTagAutoRole] Role ${roleId} di server "${guild.name}" (${guildId}) sudah dihapus — menonaktifkan Auto Role secara otomatis.`,
                );
                await saveTagRoleConfig(client, guildId, {
                    ...config,
                    enabled: false,
                });
                return { action: "role_deleted" };
            }

            Logger.warn(`[ServerTagAutoRole] Lewati perubahan Auto Role di server "${guild.name}" (${guildId}): ${validation.code}`);
            return { action: "invalid_role_or_perm", code: validation.code };
        }

        let member = options.member || guild.members?.cache?.get?.(userId) || null;
        if (!member && typeof guild.members?.fetch === "function") {
            member = await guild.members.fetch(userId).catch(() => null);
        }

        if (!member) {
            if (!qualifies && wasManaged) {
                await removeTrackedAssignedUser(client, guildId, userId);
            }
            return { action: "member_not_in_guild" };
        }

        if (member.user?.bot) {
            return { action: "skipped_bot" };
        }

        const rawRoleIds = Array.isArray(options.rawRoles) ? options.rawRoles.map(String) : null;
        const memberHasConfiguredRole = Boolean(member.roles?.cache?.has?.(roleId) || (rawRoleIds && rawRoleIds.includes(roleId)));

        if (qualifies) {
            if (memberHasConfiguredRole) {
                await addTrackedAssignedUser(client, guildId, userId);
                return { action: "already_has_role", roleId };
            }

            try {
                await member.roles.add(
                    roleId,
                    `Lagukan Server Tag Auto Role: Memasang Server Tag server ini${identity.tag ? ` [${identity.tag}]` : ""}`,
                );
                await addTrackedAssignedUser(client, guildId, userId);
                Logger.info(
                    `[ServerTagAutoRole] Memberikan role ${validation.role.name} (${roleId}) kepada user ${userId} di server "${guild.name}" (${guildId})`,
                );
                return { action: "granted", roleId };
            } catch (err) {
                Logger.error(`[ServerTagAutoRole] Gagal memberikan role ${roleId} kepada user ${userId} di server ${guildId}:`, err);
                return { action: "error", error: err };
            }
        }

        // Member no longer wears this server's Server Tag (`qualifies === false`) AND role was managed by Auto Role
        await removeTrackedAssignedUser(client, guildId, userId);

        if (!memberHasConfiguredRole) {
            return { action: "already_removed", roleId };
        }

        try {
            await member.roles.remove(roleId, "Lagukan Server Tag Auto Role: Member tidak lagi menggunakan Server Tag server ini");
            Logger.info(
                `[ServerTagAutoRole] Mencabut role ${validation.role.name} (${roleId}) dari user ${userId} di server "${guild.name}" (${guildId})`,
            );
            return { action: "revoked", roleId };
        } catch (err) {
            Logger.error(`[ServerTagAutoRole] Gagal mencabut role ${roleId} dari user ${userId} di server ${guildId}:`, err);
            return { action: "error", error: err };
        }
    });
}

/**
 * Evaluates cross-guild transitions whenever a user's global Server Tag identity changes:
 * - Grants Auto Role in the newly equipped `identity_guild_id` (if the bot is in that server).
 * - Revokes Auto Role in any previous server where Auto Role had granted the role to this user.
 */
async function handleCrossGuildUserTagAutoRole(client, userLike, options = {}) {
    if (!client?.guilds?.cache || !userLike || userLike.bot) return;

    const userId = String(userLike.id || "");
    if (!userId) return;

    const identity = extractUserTagIdentity(userLike);
    if (!identity.hasIdentityField) return;

    const targetGuildIds = new Set();

    if (options.originGuildId && client.guilds.cache.has(String(options.originGuildId))) {
        targetGuildIds.add(String(options.originGuildId));
    }

    if (identity.identityEnabled && identity.identityGuildId && client.guilds.cache.has(identity.identityGuildId)) {
        targetGuildIds.add(identity.identityGuildId);
    }

    const previousGuildId = client.data.get(getLastTagGuildCacheKey(userId));
    if (previousGuildId && client.guilds.cache.has(String(previousGuildId))) {
        targetGuildIds.add(String(previousGuildId));
    }

    for (const [guildId] of client.guilds.cache) {
        const cfg = client.data.get(getAutoRoleCacheKey(guildId));
        if (cfg?.enabled && cfg?.roleId && cfg.assignedUsers.includes(userId)) {
            targetGuildIds.add(String(guildId));
        }
    }

    for (const guildId of targetGuildIds) {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) continue;

        const isOrigin = String(options.originGuildId || "") === guildId;
        await evaluateMemberTagAutoRole(client, guild, userLike, {
            member: isOrigin ? options.member : undefined,
            rawRoles: isOrigin ? options.rawRoles : undefined,
        }).catch((err) => {
            Logger.error(`[ServerTagAutoRole] Gagal mengevaluasi user ${userId} pada guild ${guildId}:`, err);
        });
    }
}

/**
 * Synchronizes all available members in `guild` against the configured Auto Role (`/synctagrole` & post-activation sync).
 */
async function syncGuildTagAutoRoles(client, guild, options = {}) {
    if (!guild?.id) {
        return { ok: false, code: "GUILD_NOT_FOUND", message: "Server tidak ditemukan." };
    }

    const guildId = String(guild.id);
    const config = await ensureTagRoleConfig(client, guild);

    if (!config?.roleId) {
        return {
            ok: false,
            code: "NOT_CONFIGURED",
            message: "Server Tag Auto Role belum dikonfigurasi pada server ini. Gunakan `/settagrole` terlebih dahulu.",
        };
    }

    if (!config.enabled && !options.allowWhenDisabled) {
        return {
            ok: false,
            code: "DISABLED",
            message: "Fitur **Server Tag Auto Role** saat ini berstatus **Nonaktif**. Aktifkan terlebih dahulu melalui `/settagrole`.",
        };
    }

    const validation = await validateAutoRoleTarget(guild, config.roleId);
    if (!validation.valid) {
        if (validation.code === "ROLE_NOT_FOUND") {
            await saveTagRoleConfig(client, guildId, { ...config, enabled: false });
        }
        return {
            ok: false,
            code: validation.code,
            message: validation.message,
        };
    }

    let membersCollection = guild.members?.cache;
    let fetchedAllMembers = false;
    const realTimeIntent = hasServerMembersIntent(client);

    if (options.fetchMembers !== false && realTimeIntent && typeof guild.members?.fetch === "function") {
        const fetched = await guild.members.fetch({ time: 15_000 }).catch(() => null);
        if (fetched) {
            membersCollection = fetched;
            fetchedAllMembers = true;
        }
    }

    let scanned = 0;
    let granted = 0;
    let revoked = 0;
    let unchanged = 0;
    let failed = 0;

    if (membersCollection && membersCollection.size > 0) {
        for (const [, member] of membersCollection) {
            const user = member?.user;
            if (!user || user.bot) continue;

            scanned += 1;
            const identity = extractUserTagIdentity(user);
            const qualifies = doesIdentityMatchGuild(identity, guildId);
            const hasRoleNow = Boolean(member.roles?.cache?.has?.(config.roleId));
            const isTracked = config.assignedUsers.includes(user.id);

            if (!qualifies && !isTracked) {
                unchanged += 1;
                continue;
            }

            if (qualifies && hasRoleNow) {
                await addTrackedAssignedUser(client, guildId, user.id);
                unchanged += 1;
                continue;
            }

            const result = await evaluateMemberTagAutoRole(client, guild, user, {
                member,
                forceEvaluateWithoutField: true,
            });

            if (result.action === "granted") {
                granted += 1;
            } else if (result.action === "revoked") {
                revoked += 1;
            } else if (result.action === "error") {
                failed += 1;
            } else {
                unchanged += 1;
            }
        }
    }

    return {
        ok: true,
        role: validation.role,
        scanned,
        granted,
        revoked,
        unchanged,
        failed,
        fetchedAllMembers,
        realTimeIntent,
    };
}

/**
 * Attaches an official Discord Gateway raw dispatch listener (`GUILD_MEMBER_UPDATE`, `USER_UPDATE`, `GUILD_MEMBER_ADD`)
 * so `primary_guild` (`identity_guild_id`, `identity_enabled`, `tag`) updates are caught immediately even for uncached members.
 * Uses zero polling and only official bot Gateway events.
 */
function attachAutoRoleGatewayListener(client) {
    if (!client || client._tagAutoRoleRawAttached) return;
    client._tagAutoRoleRawAttached = true;

    client.on("raw", (packet) => {
        if (!packet?.t || !packet?.d) return;

        if (packet.t === "GUILD_MEMBER_UPDATE" || packet.t === "GUILD_MEMBER_ADD") {
            const rawGuildId = packet.d.guild_id;
            const rawUser = packet.d.user;
            if (!rawGuildId || !rawUser || rawUser.bot) return;

            handleCrossGuildUserTagAutoRole(client, rawUser, {
                originGuildId: String(rawGuildId),
                rawRoles: Array.isArray(packet.d.roles) ? packet.d.roles : undefined,
            }).catch((err) => {
                Logger.debug(`[ServerTagAutoRole] Raw ${packet.t} dilewati: ${err.message}`);
            });
        } else if (packet.t === "USER_UPDATE") {
            const rawUser = packet.d;
            if (!rawUser || rawUser.bot) return;

            handleCrossGuildUserTagAutoRole(client, rawUser).catch((err) => {
                Logger.debug(`[ServerTagAutoRole] Raw USER_UPDATE dilewati: ${err.message}`);
            });
        }
    });
}

/**
 * Preloads Auto Role configs from MongoDB for all joined servers on `clientReady`.
 */
async function initializeServerTagAutoRole(client) {
    if (!client?.guilds?.cache) return;

    for (const [, guild] of client.guilds.cache) {
        const cfg = await ensureTagRoleConfig(client, guild).catch(() => null);
        if (cfg?.enabled && cfg?.roleId) {
            syncGuildTagAutoRoles(client, guild, { fetchMembers: false }).catch(() => {});
        }
    }
}

/**
 * Builds the Lagukan dark-modern electric-blue/cyan embed & interactive components for `/settagrole`.
 */
async function buildSetTagRolePanel(client, guild, adminUserId, options = {}) {
    const guildId = String(guild.id);
    const botAvatar = getBotAvatarUrl(client);
    const guildIcon = guild.iconURL?.({ size: 128 }) || botAvatar;
    const config = options.config || (await ensureTagRoleConfig(client, guild));

    const draftRoleId = options.selectedRoleId !== undefined ? options.selectedRoleId : config?.roleId || null;

    const health = await inspectAutoRoleHealth(guild, draftRoleId);
    const effectiveRoleId = health.roleExists && draftRoleId ? String(draftRoleId) : null;

    const discoveredTag = detectGuildOwnTagFromMembers(guild, guild.members?.cache);
    const cachedTagConfig = client.data.get(`tagConfig_${guildId}`);
    const detectedTagName = discoveredTag?.tag || cachedTagConfig?.detectedServerTag?.tag || null;
    const tagDisplay = detectedTagName
        ? `\`[${escapeInline(detectedTagName)}]\` *(ID Server: \`${guildId}\`)*`
        : `\`Otomatis berdasarkan ID Server (${guildId})\``;

    let statusLabel = "⚪ **Belum dikonfigurasi**";
    let embedColor = AUTO_ROLE_COLORS.PRIMARY;

    if (config?.roleId && !health.roleExists && draftRoleId === config.roleId) {
        statusLabel = "⚠️ **Role Sebelumnya Dihapus — Pilih Role Baru**";
        embedColor = AUTO_ROLE_COLORS.WARNING;
    } else if (effectiveRoleId && effectiveRoleId !== config?.roleId) {
        statusLabel = "🟡 **Role Dipilih — Tekan AKTIFKAN untuk Menyimpan**";
        embedColor = AUTO_ROLE_COLORS.PRIMARY;
    } else if (config?.enabled && config?.roleId && health.valid) {
        statusLabel = "🟢 **Aktif**";
        embedColor = AUTO_ROLE_COLORS.ACTIVE;
    } else if (config?.enabled && config?.roleId && !health.valid) {
        statusLabel = "⚠️ **Aktif (Perlu Perbaikan Izin / Posisi Role)**";
        embedColor = AUTO_ROLE_COLORS.WARNING;
    } else if (config?.roleId && !config?.enabled) {
        statusLabel = "🔴 **Nonaktif**";
        embedColor = AUTO_ROLE_COLORS.INACTIVE;
    }

    if (options.noticeType === "error") {
        embedColor = AUTO_ROLE_COLORS.ERROR;
    } else if (options.noticeType === "warning") {
        embedColor = AUTO_ROLE_COLORS.WARNING;
    } else if (options.noticeType === "success") {
        embedColor = AUTO_ROLE_COLORS.ACTIVE;
    }

    const roleDisplay = effectiveRoleId ? `<@&${effectiveRoleId}> (\`${effectiveRoleId}\`)` : "`Belum dipilih`";

    const permSummary = !health.hasManageRoles
        ? "❌ Izin `Manage Roles` belum aktif pada bot"
        : effectiveRoleId && !health.valid
          ? `⚠️ ${health.code === "ROLE_ABOVE_BOT" ? "Posisi role berada di atas/sejajar role Lagukan" : "Role belum memenuhi syarat keamanan"}`
          : "✅ `Manage Roles` aktif & siap digunakan";

    const updatedUnix = config?.updatedAt ? Math.floor(new Date(config.updatedAt).getTime() / 1000) : null;
    const configuredInfo =
        config?.configuredBy && updatedUnix ? `<@${config.configuredBy}> • <t:${updatedUnix}:R>` : "`Belum pernah disimpan`";

    const descriptionParts = [
        "**Pengaturan Server Tag Auto Role**",
        `Pilih role yang akan diberikan secara otomatis kepada member yang memasang **Server Tag** milik server **${escapeMarkdown(guild.name)}**.`,
        "Ketika member melepas atau mengganti identitas Server Tag ke server lain, role tersebut akan dicabut otomatis tanpa memengaruhi role lain milik member.",
    ];

    if (options.noticeMessage) {
        descriptionParts.push("", options.noticeMessage);
    } else if (health.warning) {
        descriptionParts.push("", `⚠️ ${health.warning}`);
    }

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({
            name: `${guild.name} • Konfigurasi Auto Role`,
            iconURL: guildIcon,
        })
        .setTitle("🛡️ LAGUKAN AUTO ROLE")
        .setDescription(descriptionParts.join("\n"))
        .addFields({
            name: "⚙️ Informasi Status Konfigurasi",
            value: [
                `• **Status:** ${statusLabel}`,
                `• **Role Pilihan:** ${roleDisplay}`,
                `• **Identitas Server Tag:** ${tagDisplay}`,
                `• **Keamanan & Izin Bot:** ${permSummary}`,
                `• **Terakhir Diatur:** ${configuredInfo}`,
            ].join("\n"),
            inline: false,
        })
        .setFooter({ text: AUTO_ROLE_FOOTER, iconURL: botAvatar })
        .setTimestamp();

    const selectMenu = new RoleSelectMenuBuilder()
        .setCustomId(`${COMPONENT_PREFIX}:select:${adminUserId}`)
        .setPlaceholder("Pilih Role ▼ — Pilih role Server Tag server ini")
        .setMinValues(1)
        .setMaxValues(1);

    if (effectiveRoleId) {
        selectMenu.setDefaultRoles([effectiveRoleId]);
    }

    const encodedRoleToken = effectiveRoleId || "none";

    const selectRow = new ActionRowBuilder().addComponents(selectMenu);
    const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${COMPONENT_PREFIX}:enable:${adminUserId}:${encodedRoleToken}`)
            .setLabel("AKTIFKAN")
            .setEmoji("✅")
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`${COMPONENT_PREFIX}:disable:${adminUserId}:${encodedRoleToken}`)
            .setLabel("NONAKTIFKAN")
            .setEmoji("⛔")
            .setStyle(ButtonStyle.Danger),
    );

    return {
        embeds: [embed],
        components: [selectRow, buttonRow],
    };
}

/**
 * Handles dropdown (`RoleSelectMenu`) and button (`AKTIFKAN` / `NONAKTIFKAN`) interactions for `/settagrole`.
 */
async function handleTagRoleComponentInteraction(client, interaction) {
    const customId = String(interaction?.customId || "");
    if (!customId.startsWith(`${COMPONENT_PREFIX}:`)) return false;

    const parts = customId.split(":");
    const action = parts[1];
    const ownerUserId = parts[2];
    const encodedRole = parts[3] || "none";

    const guild = interaction.guild || client.guilds.cache.get(interaction.guildId);
    const botAvatar = getBotAvatarUrl(client);

    if (!guild) {
        await safeReply(interaction, {
            content: "⚠️ Data server ini belum siap. Silakan jalankan kembali `/settagrole`.",
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    if (!hasAdminPermission(interaction, guild)) {
        const deniedEmbed = buildAdminDeniedEmbed(client, "settagrole");
        await safeReply(interaction, {
            embeds: [deniedEmbed],
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    if (ownerUserId && String(interaction.user.id) !== String(ownerUserId)) {
        const notOwnerEmbed = new EmbedBuilder()
            .setColor(AUTO_ROLE_COLORS.ERROR)
            .setTitle("⛔ Panel Milik Admin Lain")
            .setDescription("Silakan jalankan perintah `/settagrole` sendiri untuk membuka panel pengaturan Auto Role.")
            .setFooter({ text: AUTO_ROLE_FOOTER, iconURL: botAvatar })
            .setTimestamp();

        await safeReply(interaction, {
            embeds: [notOwnerEmbed],
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    const acknowledged = await safeDeferUpdate(interaction);
    if (!acknowledged) return true;

    const currentConfig = await ensureTagRoleConfig(client, guild);

    if (action === "select") {
        const pickedRoleId = interaction.values?.[0] || null;
        const validation = await validateAutoRoleTarget(guild, pickedRoleId);

        if (!validation.valid) {
            const fallbackRole =
                currentConfig?.roleId && (await validateAutoRoleTarget(guild, currentConfig.roleId)).valid ? currentConfig.roleId : null;

            const panel = await buildSetTagRolePanel(client, guild, interaction.user.id, {
                config: currentConfig,
                selectedRoleId: fallbackRole,
                noticeType: "error",
                noticeMessage: `❌ **Role Tidak Dapat Dipilih:**\n${validation.message}`,
            });

            await safeEditReply(interaction, panel);
            return true;
        }

        const panel = await buildSetTagRolePanel(client, guild, interaction.user.id, {
            config: currentConfig,
            selectedRoleId: validation.role.id,
            noticeType: "warning",
            noticeMessage: `✅ Role <@&${validation.role.id}> berhasil dipilih! Sekarang tekan tombol **AKTIFKAN** di bawah untuk menyimpan dan mengaktifkan **Server Tag Auto Role** ke MongoDB.`,
        });

        await safeEditReply(interaction, panel);
        return true;
    }

    if (action === "enable") {
        const candidateRoleId = encodedRole !== "none" ? encodedRole : currentConfig?.roleId || null;

        if (!candidateRoleId) {
            const panel = await buildSetTagRolePanel(client, guild, interaction.user.id, {
                config: currentConfig,
                selectedRoleId: null,
                noticeType: "warning",
                noticeMessage:
                    "⚠️ **Role Belum Dipilih:** Anda wajib memilih role pada menu dropdown **`Pilih Role ▼`** terlebih dahulu sebelum menekan tombol **AKTIFKAN**.",
            });

            await safeEditReply(interaction, panel);
            return true;
        }

        const validation = await validateAutoRoleTarget(guild, candidateRoleId);
        if (!validation.valid) {
            const panel = await buildSetTagRolePanel(client, guild, interaction.user.id, {
                config: currentConfig,
                selectedRoleId: null,
                noticeType: "error",
                noticeMessage: `❌ **Gagal Mengaktifkan Auto Role:**\n${validation.message}`,
            });

            await safeEditReply(interaction, panel);
            return true;
        }

        const isRoleChanged = currentConfig?.roleId && String(currentConfig.roleId) !== String(validation.role.id);
        let savedConfig;
        try {
            savedConfig = await saveTagRoleConfig(
                client,
                guild.id,
                {
                    guildId: String(guild.id),
                    enabled: true,
                    roleId: String(validation.role.id),
                    configuredBy: String(interaction.user.id),
                    assignedUsers: isRoleChanged ? [] : currentConfig?.assignedUsers || [],
                },
                { strictMongo: true },
            );
        } catch (dbErr) {
            const detail = escapeInline(dbErr?.message || "Gangguan koneksi ke database MongoDB.");
            const panel = await buildSetTagRolePanel(client, guild, interaction.user.id, {
                config: currentConfig,
                selectedRoleId: validation.role.id,
                noticeType: "error",
                noticeMessage: `❌ **Gagal Menyimpan ke MongoDB:** \`${detail}\`\nPastikan \`MONGO_URI\` aktif dan stabil, lalu tekan **AKTIFKAN** kembali.`,
            });

            await safeEditReply(interaction, panel);
            return true;
        }

        // Trigger non-blocking initial sync on cached/available members so active Server Tag wearers get the role right away
        syncGuildTagAutoRoles(client, guild, { fetchMembers: false }).catch(() => {});

        const panel = await buildSetTagRolePanel(client, guild, interaction.user.id, {
            config: savedConfig,
            selectedRoleId: savedConfig.roleId,
            noticeType: "success",
            noticeMessage: `🎉 **Berhasil Diaktifkan!** Konfigurasi **Server Tag Auto Role** telah disimpan ke MongoDB. Setiap member yang memasang Server Tag milik **${escapeMarkdown(guild.name)}** akan otomatis mendapatkan role <@&${savedConfig.roleId}>.`,
        });

        await safeEditReply(interaction, panel);
        return true;
    }

    if (action === "disable") {
        if (!currentConfig?.roleId && !currentConfig?.enabled) {
            const panel = await buildSetTagRolePanel(client, guild, interaction.user.id, {
                config: currentConfig,
                selectedRoleId: encodedRole !== "none" ? encodedRole : null,
                noticeType: "warning",
                noticeMessage: "ℹ️ **Server Tag Auto Role** pada server ini memang belum dikonfigurasi / sudah nonaktif.",
            });

            await safeEditReply(interaction, panel);
            return true;
        }

        let savedConfig;
        try {
            savedConfig = await saveTagRoleConfig(
                client,
                guild.id,
                {
                    ...currentConfig,
                    guildId: String(guild.id),
                    enabled: false,
                    configuredBy: String(interaction.user.id),
                },
                { strictMongo: true },
            );
        } catch (dbErr) {
            const detail = escapeInline(dbErr?.message || "Gangguan koneksi ke database MongoDB.");
            const panel = await buildSetTagRolePanel(client, guild, interaction.user.id, {
                config: currentConfig,
                selectedRoleId: currentConfig?.roleId || null,
                noticeType: "error",
                noticeMessage: `❌ **Gagal Menyimpan ke MongoDB:** \`${detail}\``,
            });

            await safeEditReply(interaction, panel);
            return true;
        }

        const panel = await buildSetTagRolePanel(client, guild, interaction.user.id, {
            config: savedConfig,
            selectedRoleId: savedConfig.roleId,
            noticeType: "warning",
            noticeMessage:
                "🔴 **Server Tag Auto Role Dinonaktifkan.** Pemberian dan pencabutan role otomatis dihentikan sementara pada server ini. Tekan **AKTIFKAN** kapan saja untuk mengaktifkannya kembali.",
        });

        await safeEditReply(interaction, panel);
        return true;
    }

    return false;
}

module.exports = {
    AUTO_ROLE_COLORS,
    AUTO_ROLE_FOOTER,
    COMPONENT_PREFIX,
    extractUserTagIdentity,
    doesIdentityMatchGuild,
    ensureTagRoleConfig,
    saveTagRoleConfig,
    resetTagRoleConfig,
    validateAutoRoleTarget,
    inspectAutoRoleHealth,
    evaluateMemberTagAutoRole,
    handleCrossGuildUserTagAutoRole,
    syncGuildTagAutoRoles,
    attachAutoRoleGatewayListener,
    initializeServerTagAutoRole,
    buildSetTagRolePanel,
    handleTagRoleComponentInteraction,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
