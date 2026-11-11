const PREMIUM_CACHE_TTL_MS = 60 * 1000;
const premiumCache = new Map();

const STANDARD_LIMITS = {
    maxPlaylists: 25,
    maxTracksPerPlaylist: 300,
    maxFavorites: 100,
    wrappedTopTracksLimit: 5,
};

const TIER_LIMITS = {
    plus: {
        label: "Lagukan Plus",
        badge: "✨ Plus",
        maxPlaylists: 60,
        maxTracksPerPlaylist: 600,
        maxFavorites: 250,
        wrappedTopTracksLimit: 10,
    },
    vip: {
        label: "Lagukan VIP",
        badge: "💎 VIP",
        maxPlaylists: 100,
        maxTracksPerPlaylist: 1000,
        maxFavorites: 500,
        wrappedTopTracksLimit: 10,
    },
    ultimate: {
        label: "Lagukan Ultimate",
        badge: "👑 Ultimate",
        maxPlaylists: 150,
        maxTracksPerPlaylist: 1500,
        maxFavorites: 1000,
        wrappedTopTracksLimit: 10,
    },
};

function isBotDeveloper(client, userId) {
    if (!userId) return false;
    const uid = String(userId);
    if (client?.config?.owner && String(client.config.owner) === uid) return true;
    if (Array.isArray(client?.config?.dev) && client.config.dev.map(String).includes(uid)) return true;
    return false;
}

function invalidatePremiumCache(targetType, targetId) {
    if (!targetType || !targetId) {
        premiumCache.clear();
        return;
    }
    premiumCache.delete(`${targetType}:${targetId}`);
}

async function fetchSinglePremiumDoc(client, targetType, targetId) {
    if (!targetId || !client?.premiumConfigData) return null;
    const cacheKey = `${targetType}:${targetId}`;
    const cached = premiumCache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.at < PREMIUM_CACHE_TTL_MS) {
        return cached.doc;
    }

    const doc = await client.premiumConfigData.findOne({ targetType, targetId: String(targetId) }).catch(() => null);

    const plain = doc ? (typeof doc.toObject === "function" ? doc.toObject() : doc) : null;

    if (plain && plain.active) {
        if (plain.expiresAt && new Date(plain.expiresAt).getTime() <= now) {
            await client.premiumConfigData
                .findOneAndUpdate({ targetType, targetId: String(targetId) }, { $set: { active: false } }, { returnDocument: "after" })
                .catch(() => {});
            premiumCache.set(cacheKey, { at: now, doc: null });
            return null;
        }
        premiumCache.set(cacheKey, { at: now, doc: plain });
        return plain;
    }

    premiumCache.set(cacheKey, { at: now, doc: null });
    return null;
}

async function getPremiumAccess(client, { userId = null, guildId = null } = {}) {
    const [userDoc, guildDoc] = await Promise.all([
        userId ? fetchSinglePremiumDoc(client, "user", userId) : Promise.resolve(null),
        guildId ? fetchSinglePremiumDoc(client, "guild", guildId) : Promise.resolve(null),
    ]);

    const rankOrder = { none: 0, plus: 1, vip: 2, ultimate: 3 };
    const userTier = userDoc?.active ? userDoc.tier || "plus" : "none";
    const guildTier = guildDoc?.active ? guildDoc.tier || "plus" : "none";
    const effectiveTier = (rankOrder[userTier] || 0) >= (rankOrder[guildTier] || 0) ? userTier : guildTier;

    const isPremium = effectiveTier !== "none";
    const tierMeta = isPremium ? TIER_LIMITS[effectiveTier] || TIER_LIMITS.plus : null;

    return {
        isPremium,
        userPremium: Boolean(userDoc?.active),
        guildPremium: Boolean(guildDoc?.active),
        effectiveTier,
        label: tierMeta ? tierMeta.label : "Standard",
        badge: tierMeta ? tierMeta.badge : "Standard",
        userDoc,
        guildDoc,
        customAccentColor: guildDoc?.customAccentColor || userDoc?.customAccentColor || null,
        customDashboardTitle: guildDoc?.customDashboardTitle || null,
        limits: tierMeta
            ? {
                  maxPlaylists: tierMeta.maxPlaylists,
                  maxTracksPerPlaylist: tierMeta.maxTracksPerPlaylist,
                  maxFavorites: tierMeta.maxFavorites,
                  wrappedTopTracksLimit: tierMeta.wrappedTopTracksLimit,
              }
            : { ...STANDARD_LIMITS },
    };
}

function peekCachedGuildPremiumTheme(guildId) {
    if (!guildId) return { customAccentColor: null, customDashboardTitle: null, isPremium: false };
    const cached = premiumCache.get(`guild:${guildId}`);
    if (cached?.doc?.active) {
        return {
            isPremium: true,
            badge: (TIER_LIMITS[cached.doc.tier] || TIER_LIMITS.plus).badge,
            customAccentColor: cached.doc.customAccentColor || null,
            customDashboardTitle: cached.doc.customDashboardTitle || null,
        };
    }
    return { customAccentColor: null, customDashboardTitle: null, isPremium: false };
}

async function grantPremium(client, { targetType, targetId, tier = "plus", durationDays = null, grantedBy = null, note = "" }) {
    if (!client?.premiumConfigData) return { ok: false, error: "Database Premium belum tersedia." };
    const validTier = TIER_LIMITS[tier] ? tier : "plus";
    const now = new Date();
    const expiresAt = durationDays && Number(durationDays) > 0 ? new Date(now.getTime() + Number(durationDays) * 86400 * 1000) : null;

    const updated = await client.premiumConfigData.findOneAndUpdate(
        { targetType, targetId: String(targetId) },
        {
            $set: {
                active: true,
                tier: validTier,
                grantedBy: grantedBy ? String(grantedBy) : null,
                grantedAt: now,
                expiresAt,
                note: String(note || "").slice(0, 200),
            },
        },
        { upsert: true, returnDocument: "after" },
    );

    invalidatePremiumCache(targetType, targetId);
    return { ok: true, doc: typeof updated?.toObject === "function" ? updated.toObject() : updated };
}

async function revokePremium(client, { targetType, targetId }) {
    if (!client?.premiumConfigData) return { ok: false, error: "Database Premium belum tersedia." };
    const updated = await client.premiumConfigData.findOneAndUpdate(
        { targetType, targetId: String(targetId) },
        { $set: { active: false, expiresAt: null } },
        { returnDocument: "after" },
    );
    invalidatePremiumCache(targetType, targetId);
    if (!updated) return { ok: false, error: "Target belum memiliki akses Premium aktif." };
    return { ok: true };
}

async function customizeGuildPremiumDashboard(client, guildId, { accentColor = null, dashboardTitle = null } = {}) {
    const access = await getPremiumAccess(client, { guildId });
    if (!access.guildPremium) {
        return { ok: false, error: "Server ini belum memiliki status Premium aktif yang terverifikasi." };
    }

    let normalizedHex = null;
    if (accentColor !== null) {
        const cleaned = String(accentColor).trim().replace(/^#/, "");
        if (cleaned && !/^[0-9A-Fa-f]{6}$/.test(cleaned)) {
            return { ok: false, error: "Warna aksen harus berformat HEX 6 karakter (contoh: `#FF4D8D`)." };
        }
        normalizedHex = cleaned ? `#${cleaned.toUpperCase()}` : null;
    }

    const updateSet = {};
    if (accentColor !== null) updateSet.customAccentColor = normalizedHex;
    if (dashboardTitle !== null) {
        updateSet.customDashboardTitle = String(dashboardTitle).trim().slice(0, 48) || null;
    }

    const updated = await client.premiumConfigData.findOneAndUpdate(
        { targetType: "guild", targetId: String(guildId) },
        { $set: updateSet },
        { returnDocument: "after" },
    );
    invalidatePremiumCache("guild", guildId);
    return { ok: true, doc: typeof updated?.toObject === "function" ? updated.toObject() : updated };
}

async function listActivePremiumEntries(client, targetType = null) {
    if (!client?.premiumConfigData) return [];
    const filter = targetType ? { active: true, targetType } : { active: true };
    const rows = await client.premiumConfigData.find(filter).catch(() => []);
    const now = Date.now();
    return (Array.isArray(rows) ? rows : [])
        .map((r) => (typeof r.toObject === "function" ? r.toObject() : r))
        .filter((r) => !r.expiresAt || new Date(r.expiresAt).getTime() > now);
}

module.exports = {
    STANDARD_LIMITS,
    TIER_LIMITS,
    isBotDeveloper,
    invalidatePremiumCache,
    getPremiumAccess,
    peekCachedGuildPremiumTheme,
    grantPremium,
    revokePremium,
    customizeGuildPremiumDashboard,
    listActivePremiumEntries,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
