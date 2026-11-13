const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const mongoose = require("mongoose");
const { isCloudDatabaseReady } = require("../databases/cloudAdapter.js");
const { buildUserProfile666Payload } = require("./profile666Engine.js");
const Logger = require("../utils/logger");

const LOCK_TTL_MS = 60_000;
const PRESENCE_TTL_MS = 120_000;
const PRESENCE_HEARTBEAT_INTERVAL_MS = 45_000;
const BACKUP_FAILOVER_WAIT_MS = 750;
const LOCAL_LOCK_DIR = path.join(os.tmpdir(), "lagukan-666prof-locks");

function isDbReady(model) {
    if (isCloudDatabaseReady()) return true;
    if (model?.db && typeof model.db.readyState === "number") {
        return model.db.readyState === 1;
    }
    if (mongoose.connection.readyState === 1) return true;
    if (model && !model.db) return true;
    return false;
}

function getConfiguredPriorityIds(client) {
    const raw = String(client?.config?.botPriorityIds || process.env.BOT_PRIORITY_IDS || process.env.PRIMARY_PROFILE_BOT_ID || "").trim();
    if (!raw) return [];
    return raw
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
}

/**
 * Strictly parses ONLY `666!prof` and `666!prof @user` (or `666!prof <userId>`).
 * Returns `null` for everything else (including `666 play`, `666 pause`, `666 skip`, etc.).
 */
function parse666ProfCommand(rawContent) {
    const text = String(rawContent || "").trim();
    if (!text) return null;

    const match = text.match(/^666!prof(?:\s+(?:<@!?(\d{5,22})>|(\d{5,22})))?$/i);
    if (!match) return null;

    const targetUserId = match[1] || match[2] || null;
    return {
        command: "666!prof",
        targetUserId,
    };
}

function tryAcquireLocalFsLock(guildId, messageId, botId) {
    try {
        fs.mkdirSync(LOCAL_LOCK_DIR, { recursive: true });

        // Opportunistic cleanup of expired lock files (> 60s old)
        try {
            const now = Date.now();
            const entries = fs.readdirSync(LOCAL_LOCK_DIR);
            if (entries.length > 50) {
                for (const name of entries) {
                    const fp = path.join(LOCAL_LOCK_DIR, name);
                    try {
                        const stat = fs.statSync(fp);
                        if (now - stat.mtimeMs > LOCK_TTL_MS) {
                            fs.unlinkSync(fp);
                        }
                    } catch {
                        // Ignore race on cleanup
                    }
                }
            }
        } catch {
            // Ignore cleanup errors
        }

        const safeKey = `${String(guildId).replace(/\W/g, "")}_${String(messageId).replace(/\W/g, "")}.lock`;
        const lockFile = path.join(LOCAL_LOCK_DIR, safeKey);
        const fd = fs.openSync(lockFile, "wx");
        fs.writeSync(fd, JSON.stringify({ ownerBotId: botId, claimedAt: Date.now() }));
        fs.closeSync(fd);
        return { acquired: true, lockFile };
    } catch {
        return { acquired: false, lockFile: null };
    }
}

/**
 * Publishes this bot's live presence per guild so deterministic priority election knows
 * which of the 10 bots are currently online in each server.
 */
async function syncBotGuildPresence(client) {
    const botId = String(client?.user?.id || "");
    const model = client?.botGuildPresenceData;
    if (!botId || !model || !isDbReady(model)) return;

    const now = new Date();
    const expiresAt = new Date(now.getTime() + PRESENCE_TTL_MS);
    const botTag = client?.user?.tag || client?.user?.username || botId;

    const guilds = client?.guilds?.cache ? Array.from(client.guilds.cache.values()) : [];
    for (const guild of guilds) {
        if (!guild?.id) continue;
        await model
            .findOneAndUpdate(
                { guildId: String(guild.id), botApplicationId: botId },
                {
                    $set: {
                        guildId: String(guild.id),
                        botApplicationId: botId,
                        botTag,
                        lastSeenAt: now,
                        expiresAt,
                    },
                },
                { upsert: true, returnDocument: "after" },
            )
            .catch(() => {});
    }
}

function startBotPresenceHeartbeat(client) {
    if (client._presenceHeartbeat666) {
        clearInterval(client._presenceHeartbeat666);
    }
    void syncBotGuildPresence(client).catch(() => {});

    client._presenceHeartbeat666 = setInterval(() => {
        void syncBotGuildPresence(client).catch(() => {});
    }, PRESENCE_HEARTBEAT_INTERVAL_MS);

    if (typeof client._presenceHeartbeat666.unref === "function") {
        client._presenceHeartbeat666.unref();
    }
}

function sortDeterministicBotIds(botIds = [], configuredPriority = []) {
    const priorityIndex = new Map();
    configuredPriority.forEach((id, idx) => priorityIndex.set(String(id), idx));

    return [...new Set(botIds.map(String))].sort((a, b) => {
        const pA = priorityIndex.has(a) ? priorityIndex.get(a) : Number.MAX_SAFE_INTEGER;
        const pB = priorityIndex.has(b) ? priorityIndex.get(b) : Number.MAX_SAFE_INTEGER;
        if (pA !== pB) return pA - pB;

        try {
            const bigA = BigInt(a);
            const bigB = BigInt(b);
            if (bigA < bigB) return -1;
            if (bigA > bigB) return 1;
            return 0;
        } catch {
            return a.localeCompare(b);
        }
    });
}

async function computeBotDeterministicRank(client, guildId) {
    const myBotId = String(client?.user?.id || "");
    const configuredPriority = getConfiguredPriorityIds(client);
    const model = client?.botGuildPresenceData;

    if (model && isDbReady(model)) {
        const cutoff = Date.now() - PRESENCE_TTL_MS;
        const docs = (await model.find({ guildId: String(guildId) }).catch(() => [])) || [];
        const activeIds = docs
            .filter((d) => !d.expiresAt || new Date(d.expiresAt).getTime() > Date.now() || new Date(d.lastSeenAt || 0).getTime() > cutoff)
            .map((d) => String(d.botApplicationId));

        if (!activeIds.includes(myBotId)) {
            activeIds.push(myBotId);
        }

        const ordered = sortDeterministicBotIds(activeIds, configuredPriority);
        return {
            rank: ordered.indexOf(myBotId),
            totalOnline: ordered.length,
            primaryBotId: ordered[0],
        };
    }

    if (configuredPriority.length > 0) {
        const idx = configuredPriority.indexOf(myBotId);
        return {
            rank: idx >= 0 ? idx : configuredPriority.length,
            totalOnline: configuredPriority.length,
            primaryBotId: configuredPriority[0],
        };
    }

    return {
        rank: 0,
        totalOnline: 1,
        primaryBotId: myBotId,
    };
}

/**
 * Attempts to atomically claim exclusive ownership of `(guildId, messageId)` for `666!prof`.
 * Guarantees that strictly 1 bot out of up to 10 bots processes the command.
 */
async function claimProfMessageOwnership(client, guildId, messageId) {
    const myBotId = String(client?.user?.id || "");
    const gId = String(guildId || "");
    const mId = String(messageId || "");
    if (!myBotId || !gId || !mId) {
        return { claimed: false, reason: "invalid_ids" };
    }

    const lockKey = `${gId}:${mId}`;
    const lockModel = client?.messageClaimLockData;

    // SAFE OFFLINE STRATEGY when MongoDB is unavailable: NEVER let all 10 bots reply!
    if (!lockModel || !isDbReady(lockModel)) {
        const priorityIds = getConfiguredPriorityIds(client);
        if (priorityIds.length > 0 && priorityIds[0] !== myBotId) {
            return { claimed: false, reason: "db_offline_non_primary" };
        }
        const local = tryAcquireLocalFsLock(gId, mId, myBotId);
        if (!local.acquired) {
            return { claimed: false, reason: "db_offline_local_lock_held" };
        }
        return { claimed: true, mode: "local_fs_atomic", lockKey, lockFile: local.lockFile };
    }

    const { rank } = await computeBotDeterministicRank(client, gId);

    // Ranks >= 2 immediately stand down when Primary (Rank 0) + Designated Backup (Rank 1) are present
    if (rank >= 2) {
        return { claimed: false, reason: "non_primary_standby" };
    }

    // Rank 1 waits briefly to let Primary (Rank 0) claim first; takes over ONLY if Rank 0 failed or missed
    if (rank === 1) {
        await new Promise((resolve) => setTimeout(resolve, BACKUP_FAILOVER_WAIT_MS));

        const existing = await lockModel.findOne({ lockKey }).catch(() => null);
        if (existing) {
            if (existing.status === "failed" && String(existing.ownerBotId) !== myBotId) {
                const takeover = await lockModel
                    .findOneAndUpdate(
                        { lockKey, status: "failed" },
                        {
                            $set: {
                                ownerBotId: myBotId,
                                status: "processing",
                                claimedAt: new Date(),
                                expiresAt: new Date(Date.now() + LOCK_TTL_MS),
                            },
                        },
                        { returnDocument: "after" },
                    )
                    .catch(() => null);

                if (takeover && String(takeover.ownerBotId) === myBotId) {
                    return { claimed: true, mode: "mongo_failover", lockKey };
                }
            }
            return { claimed: false, reason: "already_claimed_by_primary" };
        }
    }

    // Atomic MongoDB lock creation (unique index on `lockKey` rejects concurrent contenders with E11000)
    const now = new Date();
    const expiresAt = new Date(now.getTime() + LOCK_TTL_MS);

    try {
        await lockModel.create({
            lockKey,
            guildId: gId,
            messageId: mId,
            ownerBotId: myBotId,
            status: "processing",
            claimedAt: now,
            expiresAt,
        });
        return { claimed: true, mode: "mongo_atomic", lockKey };
    } catch {
        return { claimed: false, reason: "atomic_lock_contended" };
    }
}

async function markProfMessageStatus(client, lockKey, status) {
    const lockModel = client?.messageClaimLockData;
    const myBotId = String(client?.user?.id || "");
    if (!lockKey || !lockModel || !isDbReady(lockModel)) return;

    await lockModel.findOneAndUpdate({ lockKey, ownerBotId: myBotId }, { $set: { status } }).catch(() => {});
}

/**
 * End-to-end handler called from `messageCreate.js`.
 * Returns `true` if the message matched `666!prof` (whether this bot won ownership or stood down),
 * or `false` if the message was NOT a `666!prof` command.
 */
async function handleRouted666ProfMessage(client, message) {
    const parsed = parse666ProfCommand(message?.content);
    if (!parsed) return false;

    if (!message?.guild || !message?.channel || !client?.user?.id) {
        return true;
    }

    // Check channel permissions BEFORE claiming ownership so an unpermitted bot yields cleanly
    if (typeof message.channel.permissionsFor === "function" && message.guild.members?.me) {
        const perms = message.channel.permissionsFor(message.guild.members.me);
        if (perms && (!perms.has("ViewChannel") || !perms.has("SendMessages") || !perms.has("EmbedLinks"))) {
            return true;
        }
    }

    const claim = await claimProfMessageOwnership(client, message.guild.id, message.id);
    if (!claim.claimed) {
        return true;
    }

    try {
        let targetUser = message.author;
        let targetMember = message.member || null;

        if (parsed.targetUserId) {
            const mentioned = message.mentions?.users?.get?.(parsed.targetUserId) || null;
            targetMember =
                message.guild.members?.cache?.get?.(parsed.targetUserId) ||
                (await message.guild.members?.fetch?.(parsed.targetUserId).catch(() => null));
            targetUser =
                mentioned ||
                targetMember?.user ||
                client.users?.cache?.get?.(parsed.targetUserId) ||
                (await client.users?.fetch?.(parsed.targetUserId).catch(() => null));

            if (!targetUser) {
                await message
                    .reply({
                        content: "❌ Pengguna tersebut tidak ditemukan di server ini.",
                        allowedMentions: { repliedUser: false },
                    })
                    .catch(() => {});
                await markProfMessageStatus(client, claim.lockKey, "completed");
                return true;
            }
        }

        const payload = await buildUserProfile666Payload(client, {
            guild: message.guild,
            targetUser,
            targetMember,
        });

        await message.reply({
            ...payload,
            allowedMentions: { repliedUser: false },
        });

        await markProfMessageStatus(client, claim.lockKey, "completed");
    } catch (err) {
        Logger.error(`[ProfRouter666] Gagal memproses 666!prof pada bot ${client.user.id}:`, err);
        await markProfMessageStatus(client, claim.lockKey, "failed");
    }

    return true;
}

module.exports = {
    parse666ProfCommand,
    syncBotGuildPresence,
    startBotPresenceHeartbeat,
    claimProfMessageOwnership,
    handleRouted666ProfMessage,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
