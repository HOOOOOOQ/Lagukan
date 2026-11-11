const zlib = require("node:zlib");
const axios = require("axios");
const mongoose = require("mongoose");
const {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelSelectMenuBuilder,
    ChannelType,
    Constants,
    EmbedBuilder,
    FileUploadBuilder,
    GuildFeature,
    LabelBuilder,
    MessageFlags,
    ModalBuilder,
    PermissionsBitField,
    RoleSelectMenuBuilder,
    StringSelectMenuBuilder,
    TextInputBuilder,
    TextInputStyle,
    escapeMarkdown,
} = require("discord.js");
const CustomRoleModel = require("../databases/schema/customRole.js");
const CustomRoleConfigModel = require("../databases/schema/customRoleConfig.js");
const {
    safeDeferUpdate,
    safeDeferReply,
    safeEditReply,
    safeReply,
    isUnknownInteractionError,
    isAlreadyAcknowledgedError,
} = require("./interactionResponder.js");
const Logger = require("../utils/logger");

const CR_PREFIX = "customrole";
const CR_FOOTER = "LAGUKAN CUSTOM ROLE SYSTEM";

const CR_COLORS = {
    PRIMARY: 0x00e5ff, // Lagukan Electric Cyan
    ELECTRIC: 0x00b4d8, // Lagukan Electric Blue
    SUCCESS: 0x00ff88, // Neon Mint Success
    WARNING: 0xffa502, // Amber Warning
    ERROR: 0xff4757, // Alert Red
    DARK: 0x1e272e, // Dark Modern Slate
};

const MAX_DISCORD_ROLE_ICON_BYTES = 256 * 1024; // 256 KB official Discord Role Icon limit
const MAX_PREVIEW_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB max preview image when server lacks ROLE_ICONS
const MAX_ALLOWED_ROLES_PER_GUILD = 25;
const MAX_ROLES_PER_MEMBER_CAP = 25;
const ALLOWED_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const ALLOWED_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp"]);

const PRESET_COLORS = [
    { label: "Lagukan Electric Cyan", hex: "#00E5FF", emoji: "💎", description: "Warna khas utama Lagukan (#00E5FF)" },
    { label: "Discord Blurple", hex: "#5865F2", emoji: "💜", description: "Biru elektrik ikonik Discord (#5865F2)" },
    { label: "Pure Aqua Cyan", hex: "#00FFFF", emoji: "🩵", description: "Cyan neon terang (#00FFFF)" },
    { label: "Neon Magenta", hex: "#FF00FF", emoji: "🩷", description: "Magenta elektrik menyala (#FF00FF)" },
    { label: "Emerald Mint", hex: "#00FF88", emoji: "💚", description: "Hijau zamrud modern (#00FF88)" },
    { label: "Electric Royal Blue", hex: "#00A8FF", emoji: "🔵", description: "Biru elektrik tajam (#00A8FF)" },
    { label: "Crimson Flame", hex: "#FF4757", emoji: "🔴", description: "Merah menyala tegas (#FF4757)" },
    { label: "Solar Gold", hex: "#FFD700", emoji: "🟡", description: "Emas premium berkilau (#FFD700)" },
    { label: "Sunset Coral", hex: "#FF6B6B", emoji: "🧡", description: "Merah muda senja hangat (#FF6B6B)" },
    { label: "Amethyst Pulse", hex: "#9B59B6", emoji: "🔮", description: "Ungu kristal elegan (#9B59B6)" },
    { label: "Arctic Frost", hex: "#F1F5F9", emoji: "🤍", description: "Putih es bersih (#F1F5F9)" },
    { label: "Midnight Obsidian", hex: "#1E272E", emoji: "🖤", description: "Hitam gelap elegan (#1E272E)" },
];

const GRADIENT_PRESETS = [
    {
        id: "lagukan_cyber",
        label: "Lagukan Cyber (2 Warna)",
        mode: "two_color",
        colors: ["#00E5FF", "#5865F2"],
        emoji: "🌊",
        description: "#00E5FF → #5865F2 (Electric Cyan ke Blurple)",
    },
    {
        id: "neon_synth",
        label: "Neon Synthwave (2 Warna)",
        mode: "two_color",
        colors: ["#FF00FF", "#00FFFF"],
        emoji: "⚡",
        description: "#FF00FF → #00FFFF (Magenta ke Cyan)",
    },
    {
        id: "emerald_aurora",
        label: "Emerald Aurora (2 Warna)",
        mode: "two_color",
        colors: ["#00FF88", "#00B4D8"],
        emoji: "🌿",
        description: "#00FF88 → #00B4D8 (Mint ke Electric Blue)",
    },
    {
        id: "sunset_blaze",
        label: "Sunset Blaze (2 Warna)",
        mode: "two_color",
        colors: ["#FF4757", "#FFA502"],
        emoji: "🔥",
        description: "#FF4757 → #FFA502 (Crimson ke Amber)",
    },
    {
        id: "discord_holographic",
        label: "Holografik Resmi Discord (3 Warna)",
        mode: "holographic",
        colors: ["#A9C9FF", "#FFBBEC", "#FFC3A0"],
        emoji: "✨",
        description: "Gaya Holografik 3-Warna resmi Discord API",
    },
    {
        id: "cosmic_trinity",
        label: "Cosmic Trinity (3 Warna)",
        mode: "three_color",
        colors: ["#00E5FF", "#5865F2", "#FF00FF"],
        emoji: "🌌",
        description: "#00E5FF → #5865F2 → #FF00FF (Desain 3 Warna)",
    },
    {
        id: "tropical_prism",
        label: "Tropical Prism (3 Warna)",
        mode: "three_color",
        colors: ["#FF4757", "#FFD700", "#00FF88"],
        emoji: "🌅",
        description: "#FF4757 → #FFD700 → #00FF88 (Desain 3 Warna)",
    },
];

const GRADIENT_DIRECTIONS = [
    { value: "horizontal", label: "Horizontal (Kiri → Kanan)", emoji: "➡️" },
    { value: "vertical", label: "Vertikal (Atas → Bawah)", emoji: "⬇️" },
    { value: "diagonal_down", label: "Diagonal Turun (↘)", emoji: "↘️" },
    { value: "diagonal_up", label: "Diagonal Naik (↗)", emoji: "↗️" },
];

// Per-(guildId, userId) mutex & anti-spam cooldown
const roleMutationLocks = new Map();
const mutationCooldowns = new Map();
const activeChatUploadCollectors = new Map();
let legacyIndexChecked = false;

function withCustomRoleLock(guildId, scopeId, task) {
    const key = `${guildId}:${scopeId}`;
    const prev = roleMutationLocks.get(key) || Promise.resolve();
    const next = prev
        .catch(() => {})
        .then(() => task())
        .finally(() => {
            if (roleMutationLocks.get(key) === next) {
                roleMutationLocks.delete(key);
            }
        });

    roleMutationLocks.set(key, next);
    return next;
}

function checkMutationCooldown(userId, cooldownMs = 1500) {
    const now = Date.now();
    const prev = mutationCooldowns.get(userId) || 0;
    if (now - prev < cooldownMs) {
        return false;
    }
    mutationCooldowns.set(userId, now);
    return true;
}

// ============================================================================
// Pure Node.js PNG Color & Directional Gradient Preview Generator (0 deps)
// ============================================================================

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}

function createPngChunk(type, data) {
    const typeBuf = Buffer.from(type, "ascii");
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcInput = Buffer.concat([typeBuf, data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(crcInput), 0);
    return Buffer.concat([lenBuf, crcInput, crcBuf]);
}

function hexToRgb(hex) {
    const clean = String(hex || "#00E5FF")
        .trim()
        .replace(/^#/, "");
    const num = Number.parseInt(clean, 16);
    if (Number.isNaN(num)) return [0, 229, 255];
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r, g, b) {
    const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
    return (
        "#" +
        [clamp(r), clamp(g), clamp(b)]
            .map((v) => v.toString(16).padStart(2, "0"))
            .join("")
            .toUpperCase()
    );
}

function rgbToHsl(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case rn:
                h = (gn - bn) / d + (gn < bn ? 6 : 0);
                break;
            case gn:
                h = (bn - rn) / d + 2;
                break;
            case bn:
                h = (rn - gn) / d + 4;
                break;
        }
        h /= 6;
    }

    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h, s, l) {
    const hn = (((h % 360) + 360) % 360) / 360;
    const sn = Math.max(0, Math.min(100, s)) / 100;
    const ln = Math.max(5, Math.min(95, l)) / 100;

    if (sn === 0) {
        const gray = Math.round(ln * 255);
        return rgbToHex(gray, gray, gray);
    }

    const hue2rgb = (p, q, t) => {
        let tt = t;
        if (tt < 0) tt += 1;
        if (tt > 1) tt -= 1;
        if (tt < 1 / 6) return p + (q - p) * 6 * tt;
        if (tt < 1 / 2) return q;
        if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
        return p;
    };

    const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
    const p = 2 * ln - q;
    const r = Math.round(hue2rgb(p, q, hn + 1 / 3) * 255);
    const g = Math.round(hue2rgb(p, q, hn) * 255);
    const b = Math.round(hue2rgb(p, q, hn - 1 / 3) * 255);

    return rgbToHex(r, g, b);
}

/**
 * Generates a crisp RGBA PNG swatch / gradient preview image in memory.
 */
function generateColorOrGradientPng(hexColors, direction = "horizontal", width = 440, height = 92) {
    const validHexes = Array.isArray(hexColors) && hexColors.length > 0 ? hexColors : ["#00E5FF"];
    const stops = validHexes.slice(0, 3).map(hexToRgb);
    const stride = width * 4 + 1;
    const raw = Buffer.alloc(stride * height);

    for (let y = 0; y < height; y++) {
        const rowOffset = y * stride;
        raw[rowOffset] = 0;
        const ny = height > 1 ? y / (height - 1) : 0;

        for (let x = 0; x < width; x++) {
            const nx = width > 1 ? x / (width - 1) : 0;
            let t = nx;
            if (direction === "vertical") {
                t = ny;
            } else if (direction === "diagonal_down") {
                t = (nx + ny) / 2;
            } else if (direction === "diagonal_up") {
                t = (nx + (1 - ny)) / 2;
            }

            let r;
            let g;
            let b;
            if (stops.length === 1) {
                [r, g, b] = stops[0];
            } else if (stops.length === 2) {
                r = Math.round(stops[0][0] + (stops[1][0] - stops[0][0]) * t);
                g = Math.round(stops[0][1] + (stops[1][1] - stops[0][1]) * t);
                b = Math.round(stops[0][2] + (stops[1][2] - stops[0][2]) * t);
            } else if (t <= 0.5) {
                const lt = t * 2;
                r = Math.round(stops[0][0] + (stops[1][0] - stops[0][0]) * lt);
                g = Math.round(stops[0][1] + (stops[1][1] - stops[0][1]) * lt);
                b = Math.round(stops[0][2] + (stops[1][2] - stops[0][2]) * lt);
            } else {
                const lt = (t - 0.5) * 2;
                r = Math.round(stops[1][0] + (stops[2][0] - stops[1][0]) * lt);
                g = Math.round(stops[1][1] + (stops[2][1] - stops[1][1]) * lt);
                b = Math.round(stops[1][2] + (stops[2][2] - stops[1][2]) * lt);
            }

            const isFrame = x < 3 || x >= width - 3 || y < 3 || y >= height - 3;
            const px = rowOffset + 1 + x * 4;
            raw[px] = isFrame ? 14 : r;
            raw[px + 1] = isFrame ? 22 : g;
            raw[px + 2] = isFrame ? 36 : b;
            raw[px + 3] = 255;
        }
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;

    const idat = zlib.deflateSync(raw, { level: 3 });

    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        createPngChunk("IHDR", ihdr),
        createPngChunk("IDAT", idat),
        createPngChunk("IEND", Buffer.alloc(0)),
    ]);
}

// ============================================================================
// Validation, Permissions & Discord Feature Detection Helpers
// ============================================================================

const { isCloudDatabaseReady } = require("../databases/cloudAdapter");

function isMongoReady() {
    return mongoose.connection?.readyState === 1 || isCloudDatabaseReady();
}

function getCustomRoleModel(client) {
    return client?.customRoleData || CustomRoleModel;
}

function getCustomRoleConfigModel(client) {
    return client?.customRoleConfigData || CustomRoleConfigModel;
}

function getBotAvatarUrl(client) {
    return client?.user?.displayAvatarURL?.({ size: 128 }) || undefined;
}

function escapeInline(value) {
    return String(value ?? "").replace(/`/g, "ˋ");
}

function getDraftKey(guildId, userId) {
    return `customRoleDraft_${guildId}_${userId}`;
}

function getOrInitDraft(client, guildId, userId) {
    const key = getDraftKey(guildId, userId);
    let draft = client.data.get(key);
    if (!draft) {
        draft = {
            selectedRoleId: null,
            colorHex: null,
            gradient: null,
            pendingImage: null,
            createDraft: {
                roleName: "",
                colorHex: "#00E5FF",
                gradient: null,
                pendingImage: null,
            },
            adminSelectedRoleId: null,
            adminPage: 0,
            updatedAt: Date.now(),
        };
        client.data.set(key, draft);
    }
    if (!draft.createDraft) {
        draft.createDraft = {
            roleName: "",
            colorHex: "#00E5FF",
            gradient: null,
            pendingImage: null,
        };
    }
    draft.updatedAt = Date.now();
    return draft;
}

function resetCreateDraft(client, guildId, userId) {
    const draft = getOrInitDraft(client, guildId, userId);
    draft.createDraft = {
        roleName: "",
        colorHex: "#00E5FF",
        gradient: null,
        pendingImage: null,
    };
    draft.updatedAt = Date.now();
    return draft.createDraft;
}

function clearEditDraftFields(client, guildId, userId) {
    const draft = client.data.get(getDraftKey(guildId, userId));
    if (draft) {
        draft.colorHex = null;
        draft.gradient = null;
        draft.pendingImage = null;
        draft.updatedAt = Date.now();
    }
}

function clearDraft(client, guildId, userId) {
    client.data.delete(getDraftKey(guildId, userId));
}

function stopActiveImageCollector(guildId, userId, reason = "revoked") {
    const key = `${guildId}:${userId}`;
    const existing = activeChatUploadCollectors.get(key);
    if (existing) {
        existing.stop(reason);
        activeChatUploadCollectors.delete(key);
    }
}

async function ensureCustomRoleIndexes(RoleModel) {
    if (legacyIndexChecked || !isMongoReady()) return;
    if (typeof RoleModel?.collection?.indexes !== "function") {
        legacyIndexChecked = true;
        return;
    }

    legacyIndexChecked = true;
    try {
        const indexes = await RoleModel.collection.indexes();
        const legacyUnique = Array.isArray(indexes)
            ? indexes.find((idx) => idx?.name === "guildId_1_userId_1" && idx?.unique === true)
            : null;

        if (legacyUnique && typeof RoleModel.collection.dropIndex === "function") {
            await RoleModel.collection.dropIndex("guildId_1_userId_1").catch(() => {});
            if (typeof RoleModel.syncIndexes === "function") {
                await RoleModel.syncIndexes().catch(() => {});
            }
        }
    } catch {
        // Ignore on mocked collections or restricted MongoDB environments
    }
}

async function withMongoTimeout(promise, ms = 8000) {
    let timer = null;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    const err = new Error("Waktu tunggu koneksi ke database MongoDB habis (timeout).");
                    err.code = "MONGO_TIMEOUT";
                    reject(err);
                }, ms);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function detectGuildCustomRoleCapabilities(guild) {
    const features = Array.isArray(guild?.features) ? guild.features : [];
    const hasEnhancedRoleColors = features.includes(GuildFeature.EnhancedRoleColors || "ENHANCED_ROLE_COLORS");
    const hasRoleIcons = features.includes(GuildFeature.RoleIcons || "ROLE_ICONS") || Number(guild?.premiumTier || 0) >= 2;

    return {
        hasEnhancedRoleColors,
        hasRoleIcons,
    };
}

function parseAndValidateHexColor(rawInput) {
    const trimmed = String(rawInput ?? "").trim();
    if (!trimmed) {
        return {
            valid: false,
            hex: null,
            intColor: null,
            message: "Kode warna HEX tidak boleh kosong (contoh: `#00E5FF` atau `#5865F2`).",
        };
    }

    const cleaned = trimmed.replace(/^#/, "");
    let expanded = cleaned;

    if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
        expanded = cleaned
            .split("")
            .map((ch) => ch + ch)
            .join("");
    }

    if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
        return {
            valid: false,
            hex: null,
            intColor: null,
            message: `Format kode warna \`${escapeInline(trimmed)}\` tidak valid. Gunakan kode HEX 6 digit seperti \`#5865F2\`, \`#00FFFF\`, \`#FF00FF\`, atau \`#00FF88\`.`,
        };
    }

    const upperHex = `#${expanded.toUpperCase()}`;
    const discordSafeHex = upperHex === "#000000" ? "#010101" : upperHex;
    const intColor = Number.parseInt(discordSafeHex.slice(1), 16);

    return {
        valid: true,
        hex: upperHex,
        discordInt: intColor,
        message: null,
    };
}

function validateCustomRoleName(guild, rawName, excludeRoleId = null) {
    const trimmed = String(rawName ?? "")
        .replace(/\s+/g, " ")
        .trim();

    if (!trimmed) {
        return {
            valid: false,
            name: null,
            message: "Nama role tidak boleh kosong. Masukkan minimal 1 hingga 100 karakter.",
        };
    }

    if (trimmed.length > 100) {
        return {
            valid: false,
            name: null,
            message: `Nama role terlalu panjang (\`${trimmed.length}/100\` karakter). Batas resmi Discord adalah maksimal **100 karakter**.`,
        };
    }

    const lower = trimmed.toLowerCase();
    if (lower === "everyone" || lower === "@everyone" || lower === "here" || lower === "@here" || trimmed.includes("<@")) {
        return {
            valid: false,
            name: null,
            message: "Nama role tidak boleh menggunakan `@everyone`, `@here`, atau format mention Discord.",
        };
    }

    if (guild?.roles?.cache) {
        const duplicate = guild.roles.cache.find(
            (r) =>
                String(r.id) !== String(excludeRoleId || "") &&
                String(r.id) !== String(guild.id) &&
                String(r.name || "")
                    .trim()
                    .toLowerCase() === lower,
        );

        if (duplicate) {
            return {
                valid: false,
                name: null,
                message: `Role dengan nama **${escapeMarkdown(duplicate.name)}** sudah ada di server ini. Gunakan nama lain agar tidak terjadi duplikasi role.`,
            };
        }
    }

    return {
        valid: true,
        name: trimmed,
        message: null,
    };
}

function resolveInteractionPermissions(interactionOrMember, guild = null) {
    const targetGuild = guild || interactionOrMember?.guild || null;
    const userId = interactionOrMember?.user?.id || interactionOrMember?.member?.user?.id || interactionOrMember?.id || null;

    if (targetGuild?.ownerId && userId && String(targetGuild.ownerId) === String(userId)) {
        return new PermissionsBitField(PermissionsBitField.All);
    }

    if (typeof interactionOrMember?.memberPermissions?.has === "function") {
        return interactionOrMember.memberPermissions;
    }

    const rawPerms = interactionOrMember?.permissions ?? interactionOrMember?.member?.permissions;
    if (typeof rawPerms?.has === "function") {
        return rawPerms;
    }

    if (typeof rawPerms === "string" || typeof rawPerms === "bigint" || typeof rawPerms === "number") {
        try {
            return new PermissionsBitField(BigInt(rawPerms));
        } catch {
            return new PermissionsBitField(0n);
        }
    }

    return new PermissionsBitField(0n);
}

/**
 * Only Administrator or ManageGuild (plus Server Owner) can configure Custom Role settings
 * and hold full administrative Custom Role management access.
 */
function canManageCustomRoleConfig(interactionOrMember, guild = null) {
    const perms = resolveInteractionPermissions(interactionOrMember, guild);
    return perms.has(PermissionsBitField.Flags.Administrator) || perms.has(PermissionsBitField.Flags.ManageGuild);
}

function isUserStrictAdmin(interactionOrMember, guild = null) {
    const perms = resolveInteractionPermissions(interactionOrMember, guild);
    return perms.has(PermissionsBitField.Flags.Administrator);
}

async function resolveGuildMember(guild, userId, fallbackMember = null) {
    if (!guild || !userId) return fallbackMember;
    if (fallbackMember?.roles?.add && fallbackMember?.roles?.cache) return fallbackMember;

    const cached = guild.members?.cache?.get?.(String(userId));
    if (cached) return cached;

    if (typeof guild.members?.fetch === "function") {
        const fetched = await guild.members.fetch(String(userId)).catch(() => null);
        if (fetched) return fetched;
    }

    return fallbackMember;
}

async function resolveBotMember(guild) {
    if (!guild) return null;
    if (guild.members?.me) return guild.members.me;
    if (typeof guild.members?.fetchMe === "function") {
        return guild.members.fetchMe().catch(() => null);
    }
    return null;
}

async function resolveGuildRole(guild, roleId) {
    if (!guild || !roleId) return null;
    const rId = String(roleId);
    const cached = guild.roles?.cache?.get?.(rId);
    if (cached) return cached;
    if (typeof guild.roles?.fetch === "function") {
        return guild.roles.fetch(rId).catch(() => null);
    }
    return null;
}

async function validateBotRoleManagement(guild, existingRole = null) {
    const botMember = await resolveBotMember(guild);
    if (!botMember) {
        return {
            valid: false,
            code: "BOT_UNAVAILABLE",
            botMember: null,
            message: "Data member bot pada server ini belum siap. Silakan coba beberapa saat lagi.",
        };
    }

    if (!botMember.permissions?.has?.(PermissionsBitField.Flags.ManageRoles)) {
        return {
            valid: false,
            code: "MISSING_MANAGE_ROLES",
            botMember,
            message:
                "Bot **Lagukan** belum memiliki permission **`Manage Roles`** di server ini. Aktifkan izin **`Manage Roles`** pada role Lagukan di **Pengaturan Server → Roles** terlebih dahulu.",
        };
    }

    if (!existingRole && (guild.roles?.cache?.size || 0) >= 250) {
        return {
            valid: false,
            code: "MAX_GUILD_ROLES",
            botMember,
            message:
                "Server ini telah mencapai batas maksimal resmi Discord (**250 role**). Hapus role yang tidak terpakai terlebih dahulu sebelum membuat Custom Role baru.",
        };
    }

    if (existingRole) {
        if (String(existingRole.id) === String(guild.id)) {
            return {
                valid: false,
                code: "EVERYONE_ROLE",
                botMember,
                message: "Role `@everyone` tidak dapat dimodifikasi sebagai Custom Role.",
            };
        }

        if (existingRole.managed) {
            return {
                valid: false,
                code: "MANAGED_ROLE",
                botMember,
                message: "Role ini dikelola oleh integrasi eksternal dan tidak dapat diubah oleh bot.",
            };
        }

        const botHighest = botMember.roles?.highest;
        if (
            (botHighest &&
                typeof existingRole.position === "number" &&
                typeof botHighest.position === "number" &&
                existingRole.position >= botHighest.position) ||
            existingRole.editable === false
        ) {
            return {
                valid: false,
                code: "ROLE_ABOVE_BOT",
                botMember,
                message: `Posisi role <@&${existingRole.id}> berada di atas atau sejajar dengan role tertinggi **Lagukan** (${botHighest ? `<@&${botHighest.id}>` : "Bot"}). Pindahkan posisi role **Lagukan** ke atas role tersebut di **Pengaturan Server → Roles**.`,
            };
        }
    }

    return {
        valid: true,
        code: "OK",
        botMember,
        message: null,
    };
}

// ============================================================================
// MongoDB Server Config & Custom Role Persistence (Multi-Server Isolated)
// ============================================================================

function normalizeGuildCustomRoleConfig(guildId, doc = null) {
    const gId = String(guildId);
    const rawAllowed =
        Array.isArray(doc?.allowedRoles) && doc.allowedRoles.length > 0
            ? doc.allowedRoles
            : Array.isArray(doc?.allowedRoleIds)
              ? doc.allowedRoleIds
              : Array.isArray(doc?.allowedRoles)
                ? doc.allowedRoles
                : [];
    const dedupedRoles = [...new Set(rawAllowed.map((id) => String(id || "").trim()).filter((id) => id.length > 0 && id !== gId))].slice(
        0,
        MAX_ALLOWED_ROLES_PER_GUILD,
    );

    const rawLimit = doc?.maxRolesPerMember ?? doc?.roleLimit;
    const parsedMax = Number.parseInt(rawLimit, 10);
    const maxRolesPerMember = Number.isFinite(parsedMax) && parsedMax >= 1 ? Math.min(MAX_ROLES_PER_MEMBER_CAP, parsedMax) : 1;

    const boosterAccessEnabled =
        typeof doc?.boosterAccessEnabled === "boolean"
            ? doc.boosterAccessEnabled
            : typeof doc?.boosterAccess === "boolean"
              ? doc.boosterAccess
              : true;

    const channelId = doc?.channelId ? String(doc.channelId).trim() || null : null;
    const panelMessageId = doc?.panelMessageId ? String(doc.panelMessageId).trim() || null : null;

    return {
        guildId: gId,
        channelId,
        panelMessageId,
        boosterAccessEnabled,
        boosterAccess: boosterAccessEnabled,
        roleAccessEnabled: typeof doc?.roleAccessEnabled === "boolean" ? doc.roleAccessEnabled : true,
        allowedRoles: dedupedRoles,
        allowedRoleIds: [...dedupedRoles],
        maxRolesPerMember,
        roleLimit: maxRolesPerMember,
        customRoleEnabled: typeof doc?.customRoleEnabled === "boolean" ? doc.customRoleEnabled : true,
        updatedBy: doc?.updatedBy ? String(doc.updatedBy) : null,
        updatedAt: doc?.updatedAt ? new Date(doc.updatedAt) : null,
    };
}

async function getGuildCustomRoleConfig(client, guildId) {
    const gId = String(guildId);
    const cacheKey = `customRoleConfig_${gId}`;
    const cached = client.data.get(cacheKey);
    if (cached) return cached;

    if (isMongoReady()) {
        const ConfigModel = getCustomRoleConfigModel(client);
        const doc = await ConfigModel.findOne({ guildId: gId })
            .lean()
            .catch((err) => {
                Logger.error(`[CustomRole] Gagal membaca konfigurasi server (${gId}):`, err);
                return null;
            });

        if (doc) {
            const normalized = normalizeGuildCustomRoleConfig(gId, doc);
            client.data.set(cacheKey, normalized);
            return normalized;
        }
    }

    const fallback = normalizeGuildCustomRoleConfig(gId, null);
    client.data.set(cacheKey, fallback);
    return fallback;
}

async function saveGuildCustomRoleConfig(client, guildId, partialUpdate) {
    const gId = String(guildId);
    if (!isMongoReady()) {
        const err = new Error("Database MongoDB sedang tidak terhubung. Pastikan variabel MONGO_URI aktif.");
        err.code = "MONGO_NOT_CONNECTED";
        throw err;
    }

    const current = await getGuildCustomRoleConfig(client, gId);
    const normalizedPatch = { ...partialUpdate };
    if ("boosterAccess" in normalizedPatch && !("boosterAccessEnabled" in normalizedPatch)) {
        normalizedPatch.boosterAccessEnabled = normalizedPatch.boosterAccess;
    }
    if ("allowedRoleIds" in normalizedPatch && !("allowedRoles" in normalizedPatch)) {
        normalizedPatch.allowedRoles = normalizedPatch.allowedRoleIds;
    }
    if ("roleLimit" in normalizedPatch && !("maxRolesPerMember" in normalizedPatch)) {
        normalizedPatch.maxRolesPerMember = normalizedPatch.roleLimit;
    }

    const merged = normalizeGuildCustomRoleConfig(gId, {
        ...current,
        ...normalizedPatch,
    });

    const now = new Date();
    const ConfigModel = getCustomRoleConfigModel(client);
    const saved = await withMongoTimeout(
        ConfigModel.findOneAndUpdate(
            { guildId: gId },
            {
                $set: {
                    guildId: gId,
                    channelId: merged.channelId,
                    panelMessageId: merged.panelMessageId,
                    boosterAccessEnabled: merged.boosterAccessEnabled,
                    boosterAccess: merged.boosterAccess,
                    roleAccessEnabled: merged.roleAccessEnabled,
                    allowedRoles: merged.allowedRoles,
                    allowedRoleIds: merged.allowedRoleIds,
                    maxRolesPerMember: merged.maxRolesPerMember,
                    roleLimit: merged.roleLimit,
                    customRoleEnabled: merged.customRoleEnabled,
                    updatedBy: merged.updatedBy,
                    updatedAt: now,
                },
            },
            { upsert: true, returnDocument: "after" },
        ).lean(),
        8000,
    );

    const normalized = normalizeGuildCustomRoleConfig(gId, saved);
    client.data.set(`customRoleConfig_${gId}`, normalized);
    return normalized;
}

// ============================================================================
// Strict Booster & Allowed-Role Eligibility Engine
// ============================================================================

function getGuildBoosterRoleId(guild) {
    if (!guild?.roles) return null;
    if (guild.roles.premiumSubscriberRole?.id) {
        return String(guild.roles.premiumSubscriberRole.id);
    }
    if (typeof guild.roles.cache?.find === "function") {
        const found = guild.roles.cache.find((r) => Boolean(r?.tags?.premiumSubscriberRole));
        if (found?.id) return String(found.id);
    }
    return null;
}

function extractLiveMemberSignals(guild, resolvedMember = null, rawInteractionMember = null) {
    const boosterRoleId = getGuildBoosterRoleId(guild);
    const roleIds = new Set();
    let hasExplicitRoleList = false;

    // Prefer fresh interaction.member role list when Discord supplies it directly in the interaction payload
    if (Array.isArray(rawInteractionMember?.roles)) {
        hasExplicitRoleList = true;
        for (const rId of rawInteractionMember.roles) {
            roleIds.add(String(rId));
        }
    } else if (rawInteractionMember?.roles?.cache) {
        hasExplicitRoleList = true;
        if (typeof rawInteractionMember.roles.cache.keys === "function") {
            for (const rId of rawInteractionMember.roles.cache.keys()) {
                roleIds.add(String(rId));
            }
        }
    }

    if (!hasExplicitRoleList && resolvedMember?.roles?.cache) {
        if (typeof resolvedMember.roles.cache.keys === "function") {
            for (const rId of resolvedMember.roles.cache.keys()) {
                roleIds.add(String(rId));
            }
        }
    }

    const hasRole = (targetRoleId) => {
        const rStr = String(targetRoleId);
        if (roleIds.has(rStr)) return true;
        if (!hasExplicitRoleList && resolvedMember?.roles?.cache?.has?.(rStr)) return true;
        return false;
    };

    let premiumActive = false;
    if (rawInteractionMember && ("premium_since" in rawInteractionMember || "premiumSince" in rawInteractionMember)) {
        premiumActive = Boolean(
            rawInteractionMember.premium_since || rawInteractionMember.premiumSince || rawInteractionMember.premiumSinceTimestamp,
        );
    } else if (resolvedMember) {
        premiumActive = Boolean(resolvedMember.premiumSince || resolvedMember.premiumSinceTimestamp);
    }

    if (!premiumActive && boosterRoleId && hasRole(boosterRoleId)) {
        premiumActive = true;
    }

    return {
        isBooster: premiumActive,
        hasRole,
    };
}

function evaluateMemberEligibilityWithConfig(guild, config, resolvedMember = null, rawInteractionMember = null, isAdmin = false) {
    if (isAdmin) {
        return {
            allowed: true,
            isAdmin: true,
            source: "admin",
            code: "OK_ADMIN",
        };
    }

    if (!config.customRoleEnabled) {
        return {
            allowed: false,
            isAdmin: false,
            source: null,
            code: "SYSTEM_DISABLED",
        };
    }

    const signals = extractLiveMemberSignals(guild, resolvedMember, rawInteractionMember);

    if (config.boosterAccessEnabled && signals.isBooster) {
        return {
            allowed: true,
            isAdmin: false,
            source: "booster",
            code: "OK_BOOSTER",
        };
    }

    if (config.roleAccessEnabled && Array.isArray(config.allowedRoles) && config.allowedRoles.length > 0) {
        const matchedRoleId = config.allowedRoles.find((rId) => String(rId) !== String(guild.id) && signals.hasRole(rId));

        if (matchedRoleId) {
            return {
                allowed: true,
                isAdmin: false,
                source: "allowed_role",
                matchedRoleId: String(matchedRoleId),
                code: "OK_ROLE",
            };
        }
    }

    return {
        allowed: false,
        isAdmin: false,
        source: null,
        code: "ACCESS_DENIED",
    };
}

async function checkCustomRoleAccess(client, guild, interaction) {
    const config = await getGuildCustomRoleConfig(client, guild.id);
    const isAdmin = canManageCustomRoleConfig(interaction, guild);

    if (isAdmin) {
        return {
            allowed: true,
            isAdmin: true,
            source: "admin",
            code: "OK_ADMIN",
            config,
        };
    }

    if (!config.customRoleEnabled) {
        return {
            allowed: false,
            isAdmin: false,
            source: null,
            code: "SYSTEM_DISABLED",
            config,
        };
    }

    const resolvedMember = await resolveGuildMember(guild, interaction.user.id, interaction.member);
    const result = evaluateMemberEligibilityWithConfig(guild, config, resolvedMember, interaction.member, false);

    return {
        ...result,
        config,
    };
}

function buildCustomRoleAccessDeniedEmbed(client, code = "ACCESS_DENIED", config = null) {
    const botAvatar = getBotAvatarUrl(client);
    const requirementBullets = [];

    if (config) {
        if (config.boosterAccessEnabled) {
            requirementBullets.push("- **Server Booster** aktif di server ini.");
        }
        if (config.roleAccessEnabled && Array.isArray(config.allowedRoles) && config.allowedRoles.length > 0) {
            const mentions = config.allowedRoles
                .slice(0, 8)
                .map((id) => `<@&${id}>`)
                .join(", ");
            const more = config.allowedRoles.length > 8 ? ` *(+${config.allowedRoles.length - 8} role lainnya)*` : "";
            requirementBullets.push(`- Member dengan salah satu **Role Khusus**: ${mentions}${more}.`);
        } else if (config.roleAccessEnabled && !config.boosterAccessEnabled) {
            requirementBullets.push("- Member dengan **Role Khusus** yang ditentukan admin *(belum ada role yang dipilih admin)*.");
        }
        if (requirementBullets.length === 0) {
            requirementBullets.push("- Saat ini akses member sedang dibatasi oleh **Administrator** server.");
        } else if (config.boosterAccessEnabled && config.roleAccessEnabled && config.allowedRoles.length > 0) {
            requirementBullets.push("", "*Memenuhi **salah satu** syarat di atas sudah cukup untuk mendapatkan akses.*");
        }
    } else {
        requirementBullets.push("- Server Booster.", "- Member dengan role khusus yang ditentukan admin.");
    }

    const lines =
        code === "SYSTEM_DISABLED"
            ? [
                  "Fitur Custom Role sedang dinonaktifkan sementara oleh admin di server ini.",
                  "",
                  "Akses hanya tersedia untuk:",
                  "",
                  ...requirementBullets,
              ]
            : [
                  "Kamu belum memiliki akses untuk menggunakan Custom Role di server ini.",
                  "",
                  "Akses hanya tersedia untuk:",
                  "",
                  ...requirementBullets,
              ];

    return new EmbedBuilder()
        .setColor(CR_COLORS.ERROR)
        .setTitle("🔒 AKSES CUSTOM ROLE DITOLAK")
        .setDescription(lines.join("\n"))
        .setFooter({ text: CR_FOOTER, iconURL: botAvatar })
        .setTimestamp();
}

function buildAdminConfigDeniedEmbed(client) {
    const botAvatar = getBotAvatarUrl(client);
    return new EmbedBuilder()
        .setColor(CR_COLORS.ERROR)
        .setTitle("🔒 AKSES PENGATURAN DITOLAK")
        .setDescription(
            "Hanya **Administrator** atau pengguna dengan izin **Manage Guild (Kelola Server)** yang dapat membuka dan mengubah `/customrole-config` di server ini.",
        )
        .setFooter({ text: CR_FOOTER, iconURL: botAvatar })
        .setTimestamp();
}

/**
 * Real-time Gateway listener hook (`guildMemberUpdate`):
 * When a member loses Server Booster status AND no longer holds any admin-configured allowed role,
 * immediately revoke any active Custom Role management session/collector WITHOUT deleting their role!
 */
async function handleGuildMemberCustomRoleAccessUpdate(client, oldMember, newMember) {
    try {
        const guild = newMember?.guild || oldMember?.guild;
        const userId = newMember?.id || newMember?.user?.id || oldMember?.id || oldMember?.user?.id;
        if (!guild || !userId || newMember?.user?.bot) return;

        const isAdmin = canManageCustomRoleConfig(newMember, guild);
        if (isAdmin) return;

        const config = await getGuildCustomRoleConfig(client, guild.id);
        const currentStatus = evaluateMemberEligibilityWithConfig(guild, config, newMember, null, false);

        if (!currentStatus.allowed) {
            // Immediately revoke active upload collector & pending edit drafts,
            // while strictly preserving the member's Discord role & MongoDB Custom Role record!
            stopActiveImageCollector(guild.id, String(userId), "access_revoked");
            clearDraft(client, guild.id, String(userId));
        }
    } catch (err) {
        Logger.debug(`[CustomRole] Gagal memeriksa perubahan akses member: ${err?.message || err}`);
    }
}

// ============================================================================
// Multi-Role Custom Role Record Persistence (Per Guild + User + Role)
// ============================================================================

function normalizeCustomRoleDoc(doc) {
    if (!doc) return null;
    return {
        guildId: String(doc.guildId),
        userId: String(doc.userId),
        roleId: String(doc.roleId),
        roleName: String(doc.roleName || "Custom Role"),
        color: String(doc.color || "#00E5FF").toUpperCase(),
        gradient: {
            enabled: Boolean(doc.gradient?.enabled),
            mode: doc.gradient?.mode || "two_color",
            colors: Array.isArray(doc.gradient?.colors) ? doc.gradient.colors.map((c) => String(c).toUpperCase()) : [],
            direction: doc.gradient?.direction || "horizontal",
            appliedMode: doc.gradient?.appliedMode || "none",
        },
        imageUrl: doc.imageUrl ? String(doc.imageUrl) : null,
        imageMeta: {
            fileName: doc.imageMeta?.fileName || null,
            contentType: doc.imageMeta?.contentType || null,
            size: Number(doc.imageMeta?.size) || 0,
            width: doc.imageMeta?.width || null,
            height: doc.imageMeta?.height || null,
            appliedToDiscord: Boolean(doc.imageMeta?.appliedToDiscord),
        },
        createdAt: doc.createdAt ? new Date(doc.createdAt) : null,
        updatedAt: doc.updatedAt ? new Date(doc.updatedAt) : null,
    };
}

function getUserRolesCacheKey(guildId, userId) {
    return `customRoles_${guildId}_${userId}`;
}

async function getUserCustomRoleRecords(client, guildId, userId) {
    const gId = String(guildId);
    const uId = String(userId);
    const cacheKey = getUserRolesCacheKey(gId, uId);
    const cached = client.data.get(cacheKey);
    if (Array.isArray(cached)) return cached;

    if (isMongoReady()) {
        const RoleModel = getCustomRoleModel(client);
        await ensureCustomRoleIndexes(RoleModel);

        if (typeof RoleModel.find === "function") {
            try {
                const query = RoleModel.find({ guildId: gId, userId: uId });
                const sorted = typeof query.sort === "function" ? query.sort({ createdAt: 1 }) : query;
                const docs = typeof sorted.lean === "function" ? await sorted.lean() : await sorted;
                const list = Array.isArray(docs) ? docs.map(normalizeCustomRoleDoc).filter(Boolean) : [];
                client.data.set(cacheKey, list);
                return list;
            } catch (err) {
                Logger.error(`[CustomRole] Gagal membaca daftar Custom Role (${gId}/${uId}):`, err);
                return [];
            }
        }

        if (typeof RoleModel.findOne === "function") {
            const single = await RoleModel.findOne({ guildId: gId, userId: uId })
                .lean()
                .catch(() => null);
            const list = single ? [normalizeCustomRoleDoc(single)] : [];
            client.data.set(cacheKey, list);
            return list;
        }
    }

    return [];
}

async function getGuildAllCustomRoleRecords(client, guildId) {
    const gId = String(guildId);
    if (!isMongoReady()) return [];

    const RoleModel = getCustomRoleModel(client);
    await ensureCustomRoleIndexes(RoleModel);

    if (typeof RoleModel.find !== "function") return [];

    try {
        const query = RoleModel.find({ guildId: gId });
        const sorted = typeof query.sort === "function" ? query.sort({ createdAt: 1 }) : query;
        const docs = typeof sorted.lean === "function" ? await sorted.lean() : await sorted;
        return Array.isArray(docs) ? docs.map(normalizeCustomRoleDoc).filter(Boolean) : [];
    } catch (err) {
        Logger.error(`[CustomRole] Gagal membaca seluruh Custom Role server (${gId}):`, err);
        return [];
    }
}

async function getGuildCustomRoleByRoleId(client, guildId, roleId) {
    const gId = String(guildId);
    const rId = String(roleId);
    if (!isMongoReady()) return null;

    const RoleModel = getCustomRoleModel(client);
    try {
        const doc = await RoleModel.findOne({ guildId: gId, roleId: rId }).lean();
        return doc ? normalizeCustomRoleDoc(doc) : null;
    } catch {
        return null;
    }
}

async function saveUserCustomRoleRecord(client, record) {
    const gId = String(record.guildId);
    const uId = String(record.userId);
    const rId = String(record.roleId);
    const cacheKey = getUserRolesCacheKey(gId, uId);

    if (!isMongoReady()) {
        const err = new Error("Database MongoDB sedang tidak terhubung. Pastikan variabel MONGO_URI aktif dan koneksi stabil.");
        err.code = "MONGO_NOT_CONNECTED";
        throw err;
    }

    const now = new Date();
    const RoleModel = getCustomRoleModel(client);
    await ensureCustomRoleIndexes(RoleModel);

    const saved = await withMongoTimeout(
        RoleModel.findOneAndUpdate(
            { guildId: gId, roleId: rId },
            {
                $set: {
                    guildId: gId,
                    userId: uId,
                    roleId: rId,
                    roleName: String(record.roleName),
                    color: String(record.color || "#00E5FF").toUpperCase(),
                    gradient: {
                        enabled: Boolean(record.gradient?.enabled),
                        mode: record.gradient?.mode || "two_color",
                        colors: Array.isArray(record.gradient?.colors) ? record.gradient.colors.map((c) => String(c).toUpperCase()) : [],
                        direction: record.gradient?.direction || "horizontal",
                        appliedMode: record.gradient?.appliedMode || "none",
                    },
                    imageUrl: record.imageUrl || null,
                    imageMeta: {
                        fileName: record.imageMeta?.fileName || null,
                        contentType: record.imageMeta?.contentType || null,
                        size: Number(record.imageMeta?.size) || 0,
                        width: record.imageMeta?.width || null,
                        height: record.imageMeta?.height || null,
                        appliedToDiscord: Boolean(record.imageMeta?.appliedToDiscord),
                    },
                    updatedAt: now,
                },
                $setOnInsert: {
                    createdAt: record.createdAt || now,
                },
            },
            { upsert: true, returnDocument: "after" },
        ).lean(),
        8000,
    );

    const normalized = normalizeCustomRoleDoc(saved);
    const existingList = client.data.get(cacheKey);
    if (Array.isArray(existingList)) {
        const idx = existingList.findIndex((item) => String(item.roleId) === rId);
        if (idx >= 0) {
            const nextList = [...existingList];
            nextList[idx] = normalized;
            client.data.set(cacheKey, nextList);
        } else {
            client.data.set(cacheKey, [...existingList, normalized]);
        }
    } else {
        client.data.delete(cacheKey);
    }

    return normalized;
}

async function deleteCustomRoleRecord(client, guildId, userId, roleId) {
    const gId = String(guildId);
    const uId = String(userId);
    const rId = String(roleId);
    const cacheKey = getUserRolesCacheKey(gId, uId);

    if (!isMongoReady()) {
        const err = new Error("Database MongoDB sedang tidak terhubung. Pastikan variabel MONGO_URI aktif dan koneksi stabil.");
        err.code = "MONGO_NOT_CONNECTED";
        throw err;
    }

    const RoleModel = getCustomRoleModel(client);
    await withMongoTimeout(RoleModel.deleteOne({ guildId: gId, userId: uId, roleId: rId }), 8000);

    const existingList = client.data.get(cacheKey);
    if (Array.isArray(existingList)) {
        client.data.set(
            cacheKey,
            existingList.filter((item) => String(item.roleId) !== rId),
        );
    } else {
        client.data.delete(cacheKey);
    }
}

async function resolveUserRoleContext(client, guild, userId) {
    const uId = String(userId);
    const draft = getOrInitDraft(client, guild.id, uId);
    const records = await getUserCustomRoleRecords(client, guild.id, uId);

    const pairs = [];
    for (const rec of records) {
        // Strict ownership invariant
        if (String(rec.userId) !== uId) continue;
        const liveRole = rec.roleId ? await resolveGuildRole(guild, rec.roleId) : null;
        pairs.push({ record: rec, liveRole });
    }

    const activePairs = pairs.filter((p) => Boolean(p.liveRole));
    const orphanPairs = pairs.filter((p) => !p.liveRole);

    let chosen = null;
    if (draft.selectedRoleId) {
        chosen = pairs.find((p) => String(p.record.roleId) === String(draft.selectedRoleId)) || null;
    }
    if (!chosen) {
        chosen = activePairs[0] || pairs[0] || null;
    }
    if (chosen) {
        draft.selectedRoleId = String(chosen.record.roleId);
    }

    return {
        records: pairs.map((p) => p.record),
        pairs,
        activePairs,
        orphanPairs,
        selectedRecord: chosen?.record || null,
        selectedLiveRole: chosen?.liveRole || null,
    };
}

// ============================================================================
// Image Attachment Validation (PNG, JPG, JPEG, WEBP + Magic Bytes + Size)
// ============================================================================

function detectImageSignature(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
        return "image/png";
    }

    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return "image/jpeg";
    }

    if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
        return "image/webp";
    }

    return null;
}

async function validateAndDownloadRoleImage(attachment, hasRoleIconsFeature) {
    if (!attachment || !attachment.url) {
        return {
            valid: false,
            message: "File gambar tidak ditemukan pada lampiran Discord. Silakan pilih gambar dari galeri HP Anda.",
        };
    }

    const rawName = String(attachment.name || "role-icon.png");
    const ext = rawName.includes(".") ? rawName.split(".").pop().toLowerCase().split("?")[0] : "";
    const contentType = String(attachment.contentType || "")
        .toLowerCase()
        .split(";")[0]
        .trim();

    const extOk = ALLOWED_IMAGE_EXTS.has(ext);
    const mimeOk = !contentType || ALLOWED_IMAGE_MIMES.has(contentType);

    if (!extOk || !mimeOk) {
        return {
            valid: false,
            message: `Format file \`${escapeInline(rawName)}\` tidak didukung.\nFormat gambar yang diizinkan hanya **PNG**, **JPG**, **JPEG**, dan **WEBP**.`,
        };
    }

    const maxBytes = hasRoleIconsFeature ? MAX_DISCORD_ROLE_ICON_BYTES : MAX_PREVIEW_IMAGE_BYTES;
    const sizeBytes = Number(attachment.size) || 0;

    if (sizeBytes > maxBytes) {
        const sizeKb = Math.ceil(sizeBytes / 1024);
        const maxKb = Math.floor(maxBytes / 1024);
        return {
            valid: false,
            message: hasRoleIconsFeature
                ? `Ukuran gambar terlalu besar (**${sizeKb} KB**). Batas resmi Discord untuk **Role Icon** adalah maksimal **${maxKb} KB (256 KB)**. Silakan pilih atau kompres gambar yang lebih kecil.`
                : `Ukuran gambar terlalu besar (**${sizeKb} KB**). Batas unggahan gambar preview adalah maksimal **${maxKb} KB (2 MB)**.`,
        };
    }

    let buffer;
    try {
        const response = await axios.get(attachment.url, {
            responseType: "arraybuffer",
            timeout: 8000,
            maxContentLength: maxBytes + 1024,
        });
        buffer = Buffer.from(response.data);
    } catch {
        return {
            valid: false,
            message: "Gagal mengunduh gambar lampiran dari server Discord. Silakan coba unggah kembali.",
        };
    }

    if (buffer.length > maxBytes) {
        return {
            valid: false,
            message: `Ukuran file gambar melebihi batas maksimal (**${Math.floor(maxBytes / 1024)} KB**).`,
        };
    }

    const detectedMime = detectImageSignature(buffer);
    if (!detectedMime) {
        return {
            valid: false,
            message:
                "File yang diunggah bukan gambar valid. Pastikan Anda memilih file gambar asli berformat **PNG**, **JPG/JPEG**, atau **WEBP** dari galeri.",
        };
    }

    return {
        valid: true,
        buffer,
        meta: {
            url: attachment.url,
            fileName: rawName,
            contentType: detectedMime,
            size: buffer.length,
            width: attachment.width || null,
            height: attachment.height || null,
        },
    };
}

// ============================================================================
// Safe Modal Helper
// ============================================================================

async function safeShowModal(interaction, modal) {
    if (!interaction || typeof interaction.showModal !== "function") return false;
    if (interaction.deferred || interaction.replied) return false;

    try {
        await interaction.showModal(modal);
        return true;
    } catch (err) {
        if (isUnknownInteractionError(err) || isAlreadyAcknowledgedError(err)) {
            return false;
        }
        Logger.error("[CustomRole] Gagal menampilkan modal:", err);
        return false;
    }
}

// ============================================================================
// UI Builders — Member Dashboard (/customrole) & Studios
// ============================================================================

function formatDirectionLabel(dir) {
    const found = GRADIENT_DIRECTIONS.find((d) => d.value === dir);
    return found ? `${found.emoji} ${found.label}` : "➡️ Horizontal (Kiri → Kanan)";
}

function buildMainMenuSelectRow(userId, canManageConfig) {
    const options = [
        {
            label: "Buat Role",
            value: "create",
            emoji: "➕",
            description: "Buat Custom Role baru sesuai batas kepemilikan server",
        },
        {
            label: "Ubah Nama Role",
            value: "rename",
            emoji: "✏️",
            description: "Ganti nama Custom Role milikmu di server ini",
        },
        {
            label: "Ubah Warna Role",
            value: "color",
            emoji: "🎨",
            description: "Color Picker, kode HEX, preset warna & preview",
        },
        {
            label: "Atur Gradasi",
            value: "gradient",
            emoji: "🌈",
            description: "Gradasi 2/3 warna, Holografik, arah & preview",
        },
        {
            label: "Atur Gambar Role",
            value: "image",
            emoji: "🖼️",
            description: "Unggah ikon/gambar role dari Galeri HP (Attachment)",
        },
        {
            label: "Lihat Custom Role",
            value: "view",
            emoji: "👁️",
            description: "Lihat detail lengkap, preview warna & metadata role",
        },
        {
            label: "Hapus Custom Role",
            value: "delete",
            emoji: "🗑️",
            description: "Hapus Custom Role milikmu dari server ini",
        },
    ];

    if (canManageConfig) {
        options.push({
            label: "Pengaturan Akses Server (/customrole-config)",
            value: "open_config",
            emoji: "⚙️",
            description: "Atur akses Booster, Role Khusus & batas role per member",
        });
    }

    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`${CR_PREFIX}:menu:${userId}`)
            .setPlaceholder("🎛️ Pilih Menu Custom Role ▼")
            .addOptions(options),
    );
}

async function buildCustomRoleDashboard(client, guild, user, options = {}) {
    const userId = String(user.id);
    const botAvatar = getBotAvatarUrl(client);
    const guildIcon = guild.iconURL?.({ size: 128 }) || botAvatar;
    const capabilities = detectGuildCustomRoleCapabilities(guild);
    const config = options.config || (await getGuildCustomRoleConfig(client, guild.id));
    const roleCtx = options.roleCtx || (await resolveUserRoleContext(client, guild, userId));
    const canManage = Boolean(options.canManageConfig);

    const record = roleCtx.selectedRecord;
    const liveRole = roleCtx.selectedLiveRole;
    const activeCount = roleCtx.activePairs.length;
    const maxRoles = config.maxRolesPerMember || 1;
    const canCreateAnother = activeCount < maxRoles;

    const previewHexes =
        record?.gradient?.enabled && record.gradient.colors?.length >= 2 ? record.gradient.colors : [record?.color || "#00E5FF"];
    const previewDirection = record?.gradient?.enabled ? record.gradient.direction || "horizontal" : "horizontal";

    const pngBuffer = generateColorOrGradientPng(previewHexes, previewDirection);
    const previewAttachment = new AttachmentBuilder(pngBuffer, { name: "lagukan-customrole-preview.png" });

    let roleStatusText = "⚪ `Belum memiliki Custom Role` *(pilih **Buat Role** di bawah)*";
    if (record && liveRole) {
        roleStatusText = `🟢 Aktif — <@&${liveRole.id}> (\`${escapeInline(liveRole.name)}\`)`;
    } else if (record && !liveRole) {
        roleStatusText = "⚠️ `Role sebelumnya telah dihapus di Discord` *(pilih **Buat Role** untuk membuat baru)*";
    }

    const gradSummary =
        record?.gradient?.enabled && record.gradient.colors?.length >= 2
            ? `${record.gradient.colors.map((c) => `\`${c}\``).join(" → ")} (${formatDirectionLabel(record.gradient.direction)})`
            : "`Nonaktif (Warna Solid)`";

    const iconSummary = record?.imageUrl
        ? record.imageMeta?.appliedToDiscord
            ? "🟢 Terpasang pada Role Discord"
            : "🖼️ Tersimpan sebagai Preview Metadata"
        : "`Belum diatur`";

    const serverSupportLines = [
        `• **Gradasi Role Discord:** ${
            capabilities.hasEnhancedRoleColors
                ? "🟢 Didukung (`Enhanced Role Styles` aktif)"
                : "ℹ️ Mode Preview + Warna Utama *(server belum memiliki `Enhanced Role Styles`)*"
        }`,
        `• **Gambar / Ikon Role:** ${
            capabilities.hasRoleIcons
                ? "🟢 Didukung (`Role Icons` / Boost Lv. 2+ aktif)"
                : "ℹ️ Mode Preview *(server membutuhkan Boost Level 2 untuk Role Icon)*"
        }`,
    ];

    const descLines = [
        "**Dashboard Pembuatan & Pengaturan Role Modern**",
        `Kelola identitas role pribadimu di server **${escapeMarkdown(guild.name)}** dengan kustomisasi nama, warna, gradasi, dan ikon langsung dari perangkatmu.`,
    ];

    if (!config.customRoleEnabled && canManage) {
        descLines.push(
            "",
            "⚠️ *Catatan Admin: Fitur Custom Role untuk member sedang **DINONAKTIFKAN** di server ini. Aktifkan melalui `/customrole-config`.*",
        );
    }

    if (options.noticeMessage) {
        descLines.push("", options.noticeMessage);
    }

    let embedColor = CR_COLORS.PRIMARY;
    if (options.noticeType === "success") embedColor = CR_COLORS.SUCCESS;
    else if (options.noticeType === "warning") embedColor = CR_COLORS.WARNING;
    else if (options.noticeType === "error") embedColor = CR_COLORS.ERROR;
    else if (record?.color) {
        const parsed = parseAndValidateHexColor(record.color);
        if (parsed.valid) embedColor = parsed.discordInt;
    }

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({
            name: `${guild.name} • Lagukan Custom Role`,
            iconURL: guildIcon,
        })
        .setTitle("🎨 LAGUKAN CUSTOM ROLE")
        .setDescription(descLines.join("\n"))
        .addFields(
            {
                name: "🪪 Status Custom Role Anda",
                value: [
                    `• **Pemilik:** <@${userId}>`,
                    `• **Kuota Kepemilikan:** \`${activeCount}/${maxRoles} Custom Role\``,
                    `• **Role Dipilih:** ${roleStatusText}`,
                    `• **Nama Role:** ${record ? `**${escapeMarkdown(liveRole?.name || record.roleName)}**` : "`-`"}`,
                    `• **Warna Utama:** \`${record?.color || "#00E5FF"}\``,
                    `• **Gradasi:** ${gradSummary}`,
                    `• **Gambar Role:** ${iconSummary}`,
                ].join("\n"),
                inline: false,
            },
            {
                name: "🛰️ Dukungan Fitur Resmi Server Ini",
                value: serverSupportLines.join("\n"),
                inline: false,
            },
        )
        .setImage("attachment://lagukan-customrole-preview.png")
        .setFooter({ text: CR_FOOTER, iconURL: botAvatar })
        .setTimestamp();

    if (liveRole?.iconURL?.()) {
        embed.setThumbnail(liveRole.iconURL({ size: 128, extension: "png" }));
    } else if (record?.imageUrl) {
        embed.setThumbnail(record.imageUrl);
    }

    const components = [];

    if (roleCtx.pairs.length > 1) {
        const switchOptions = roleCtx.pairs.slice(0, 25).map((pair, index) => {
            const labelName = pair.liveRole?.name || pair.record.roleName || `Role #${index + 1}`;
            return {
                label: `${index + 1}. ${labelName}`.slice(0, 100),
                value: String(pair.record.roleId),
                emoji: pair.liveRole ? "🎭" : "⚠️",
                description: `${pair.record.color} • ID: ${pair.record.roleId}`.slice(0, 100),
                default: String(pair.record.roleId) === String(record?.roleId),
            };
        });

        components.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`${CR_PREFIX}:select_own_role:${userId}`)
                    .setPlaceholder("🎭 Pilih Custom Role Milikmu yang Ingin Dikelola ▼")
                    .addOptions(switchOptions),
            ),
        );
    }

    components.push(buildMainMenuSelectRow(userId, canManage));

    const quickButtonsRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(
                `${CR_PREFIX}:${canCreateAnother && (!record || !liveRole) ? "quick_create" : record && liveRole ? "quick_rename" : "quick_create"}:${userId}`,
            )
            .setLabel(record && liveRole ? "Ubah Nama" : "Buat Role")
            .setEmoji(record && liveRole ? "✏️" : "➕")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:quick_color:${userId}`)
            .setLabel("Warna")
            .setEmoji("🎨")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!record || !liveRole),
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:quick_gradient:${userId}`)
            .setLabel("Gradasi")
            .setEmoji("🌈")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!record || !liveRole),
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:quick_image:${userId}`)
            .setLabel("Gambar")
            .setEmoji("🖼️")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!record || !liveRole),
    );

    if (record && liveRole && canCreateAnother) {
        quickButtonsRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`${CR_PREFIX}:quick_create:${userId}`)
                .setLabel("Role Baru")
                .setEmoji("➕")
                .setStyle(ButtonStyle.Success),
        );
    }

    components.push(quickButtonsRow);

    return {
        embeds: [embed],
        components,
        files: [previewAttachment],
    };
}

async function buildColorStudioPanel(client, guild, user, record, liveRole, noticeMessage = null, noticeType = null) {
    const userId = String(user.id);
    const botAvatar = getBotAvatarUrl(client);
    const draft = getOrInitDraft(client, guild.id, userId);
    if (!draft.colorHex) {
        draft.colorHex = record.color || "#00E5FF";
    }

    const parsed = parseAndValidateHexColor(draft.colorHex);
    const activeHex = parsed.valid ? parsed.hex : "#00E5FF";
    const [r, g, b] = hexToRgb(activeHex);
    const [h, s, l] = rgbToHsl(r, g, b);

    const pngBuffer = generateColorOrGradientPng([activeHex], "horizontal");
    const previewAttachment = new AttachmentBuilder(pngBuffer, { name: "lagukan-color-preview.png" });

    const desc = [
        `**Studio Warna Custom Role — <@&${liveRole.id}>**`,
        "Pilih warna dari **Preset**, sesuaikan dengan **Color Picker** interaktif (Hue & Kecerahan), atau masukkan **Kode HEX** pilihanmu. Periksa **Preview Warna** pada banner di bawah sebelum menekan **Simpan Warna**.",
    ];
    if (noticeMessage) desc.push("", noticeMessage);

    const embed = new EmbedBuilder()
        .setColor(parsed.valid ? parsed.discordInt : CR_COLORS.PRIMARY)
        .setTitle("🎨 UBAH WARNA CUSTOM ROLE")
        .setDescription(desc.join("\n"))
        .addFields({
            name: "🔍 Preview Warna Sebelum Disimpan",
            value: [
                `• **Role:** <@&${liveRole.id}> (**${escapeMarkdown(liveRole.name)}**)`,
                `• **Warna Saat Ini:** \`${record.color}\``,
                `• **Warna Preview Baru:** \`${activeHex}\` • \`RGB(${r}, ${g}, ${b})\` • \`HSL(${h}°, ${s}%, ${l}%)\``,
            ].join("\n"),
            inline: false,
        })
        .setImage("attachment://lagukan-color-preview.png")
        .setFooter({ text: CR_FOOTER, iconURL: botAvatar })
        .setTimestamp();

    if (noticeType === "error") embed.setColor(CR_COLORS.ERROR);

    const presetRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`${CR_PREFIX}:color_preset:${userId}`)
            .setPlaceholder("🎨 Pilih Warna Preset Populer ▼")
            .addOptions(
                PRESET_COLORS.map((p) => ({
                    label: `${p.label} (${p.hex})`,
                    value: p.hex,
                    emoji: p.emoji,
                    description: p.description,
                    default: p.hex.toUpperCase() === activeHex.toUpperCase(),
                })),
            ),
    );

    const pickerRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${CR_PREFIX}:picker_hue_prev:${userId}`).setLabel("◀ Geser Warna").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${CR_PREFIX}:picker_hue_next:${userId}`).setLabel("Geser Warna ▶").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:picker_bright_up:${userId}`)
            .setLabel("Terang")
            .setEmoji("☀️")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:picker_bright_down:${userId}`)
            .setLabel("Gelap")
            .setEmoji("🌙")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:color_hex_modal:${userId}`)
            .setLabel("Input HEX")
            .setEmoji("⌨️")
            .setStyle(ButtonStyle.Primary),
    );

    const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:color_save:${userId}`)
            .setLabel("SIMPAN WARNA")
            .setEmoji("✅")
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${CR_PREFIX}:cancel:${userId}`).setLabel("BATALKAN").setEmoji("↩️").setStyle(ButtonStyle.Danger),
    );

    return {
        embeds: [embed],
        components: [presetRow, pickerRow, actionRow],
        files: [previewAttachment],
    };
}

async function buildGradientStudioPanel(client, guild, user, record, liveRole, noticeMessage = null, noticeType = null) {
    const userId = String(user.id);
    const botAvatar = getBotAvatarUrl(client);
    const capabilities = detectGuildCustomRoleCapabilities(guild);
    const draft = getOrInitDraft(client, guild.id, userId);

    if (!draft.gradient) {
        draft.gradient =
            record.gradient?.enabled && record.gradient.colors?.length >= 2
                ? {
                      mode: record.gradient.mode || "two_color",
                      colors: [...record.gradient.colors],
                      direction: record.gradient.direction || "horizontal",
                  }
                : {
                      mode: "two_color",
                      colors: [record.color || "#00E5FF", "#5865F2"],
                      direction: "horizontal",
                  };
    }

    const grad = draft.gradient;
    const pngBuffer = generateColorOrGradientPng(grad.colors, grad.direction);
    const previewAttachment = new AttachmentBuilder(pngBuffer, { name: "lagukan-gradient-preview.png" });

    let discordCompatibilityNote;
    if (capabilities.hasEnhancedRoleColors) {
        if (grad.mode === "holographic") {
            discordCompatibilityNote =
                "🟢 **Didukung Penuh:** Server ini mendukung **Discord Holographic Role Style (3 Warna Resmi)** dan akan diterapkan langsung pada role Discord Anda!";
        } else if (grad.mode === "two_color") {
            discordCompatibilityNote =
                "🟢 **Didukung Penuh:** Server ini mendukung **Discord Enhanced Role Styles (Gradasi 2 Warna)** dan akan diterapkan langsung pada role Discord Anda!";
        } else {
            discordCompatibilityNote =
                "ℹ️ **Catatan API Discord:** Discord API hanya mengizinkan gradasi kustom **2 warna** atau preset **Holografik 3-warna resmi** pada role. Warna 1 & 2 akan diterapkan pada role Discord, dan desain penuh **3 warna + arah** disimpan di MongoDB sebagai preview.";
        }
    } else {
        discordCompatibilityNote =
            "ℹ️ **Catatan Resmi Server:** Server ini belum membuka fitur **`ENHANCED_ROLE_COLORS`** Discord. Warna ke-1 (`" +
            grad.colors[0] +
            "`) akan diterapkan pada role Discord tanpa kepura-puraan, sedangkan desain gradasi penuh akan disimpan sebagai **Desain Preview Custom Role** di MongoDB.";
    }

    const desc = [`**Studio Gradasi Custom Role — <@&${liveRole.id}>**`, discordCompatibilityNote];
    if (noticeMessage) desc.push("", noticeMessage);

    const primaryParsed = parseAndValidateHexColor(grad.colors[0]);

    const embed = new EmbedBuilder()
        .setColor(noticeType === "error" ? CR_COLORS.ERROR : primaryParsed.valid ? primaryParsed.discordInt : CR_COLORS.PRIMARY)
        .setTitle("🌈 ATUR GRADASI WARNA ROLE")
        .setDescription(desc.join("\n"))
        .addFields({
            name: "🔍 Preview Gradasi Sebelum Disimpan",
            value: [
                `• **Role:** <@&${liveRole.id}> (**${escapeMarkdown(liveRole.name)}**)`,
                `• **Mode Gradasi:** \`${
                    grad.mode === "holographic"
                        ? "Holografik Resmi Discord (3 Warna)"
                        : grad.mode === "three_color"
                          ? "Gradasi 3 Warna"
                          : "Gradasi 2 Warna"
                }\``,
                `• **Kombinasi Warna:** ${grad.colors.map((c) => `\`${c}\``).join(" → ")}`,
                `• **Arah Preview:** ${formatDirectionLabel(grad.direction)}`,
            ].join("\n"),
            inline: false,
        })
        .setImage("attachment://lagukan-gradient-preview.png")
        .setFooter({ text: CR_FOOTER, iconURL: botAvatar })
        .setTimestamp();

    const presetRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`${CR_PREFIX}:grad_preset:${userId}`)
            .setPlaceholder("🌈 Pilih Paket Gradasi (2 Warna / 3 Warna / Holografik) ▼")
            .addOptions(
                GRADIENT_PRESETS.map((gp) => ({
                    label: gp.label,
                    value: gp.id,
                    emoji: gp.emoji,
                    description: gp.description,
                })),
            ),
    );

    const directionRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`${CR_PREFIX}:grad_dir:${userId}`)
            .setPlaceholder("🧭 Pilih Arah Gradasi ▼")
            .addOptions(
                GRADIENT_DIRECTIONS.map((d) => ({
                    label: d.label,
                    value: d.value,
                    emoji: d.emoji,
                    default: d.value === grad.direction,
                })),
            ),
    );

    const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:grad_custom_modal:${userId}`)
            .setLabel("Kustom 2 / 3 HEX")
            .setEmoji("⌨️")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${CR_PREFIX}:grad_save:${userId}`).setLabel("SIMPAN").setEmoji("✅").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${CR_PREFIX}:cancel:${userId}`).setLabel("BATALKAN").setEmoji("↩️").setStyle(ButtonStyle.Danger),
    );

    return {
        embeds: [embed],
        components: [presetRow, directionRow, actionRow],
        files: [previewAttachment],
    };
}

async function buildImageStudioPanel(client, guild, user, record, liveRole, noticeMessage = null, noticeType = null) {
    const userId = String(user.id);
    const botAvatar = getBotAvatarUrl(client);
    const capabilities = detectGuildCustomRoleCapabilities(guild);
    const draft = getOrInitDraft(client, guild.id, userId);
    const pendingImg = draft.pendingImage || null;

    const requirementBanner = capabilities.hasRoleIcons
        ? "🟢 **Server Mendukung Role Icons (`Boost Level 2+`):** Gambar yang Anda pilih dari Galeri HP (maks. **256 KB**, format `PNG`, `JPG`, `JPEG`, `WEBP`) akan **langsung dipasang sebagai ikon role di Discord** saat Anda menekan **Simpan**!"
        : "⚠️ **Persyaratan Server Discord:** Pemasangan ikon langsung pada role membutuhkan **Server Boost Level 2 (`ROLE_ICONS`)**. Server ini belum mencapai Boost Level 2, sehingga gambar yang Anda unggah akan divalidasi dan disimpan sebagai **Preview & Metadata Custom Role** di MongoDB.";

    const desc = [
        `**Atur Gambar / Ikon Custom Role — <@&${liveRole.id}>**`,
        requirementBanner,
        "",
        "📱 **Cara Memilih Gambar dari Galeri HP:**",
        "1. Tekan tombol **Pilih Gambar (Galeri HP)** untuk membuka pengunggah lampiran langsung, *atau* tekan **Unggah Lewat Chat** untuk mengirim gambar dari tombol `+` di kolom chat.",
        "2. Periksa tampilan **Preview Gambar**.",
        "3. Tekan tombol **SIMPAN** untuk menerapkan & menyimpan.",
    ];
    if (noticeMessage) desc.push("", noticeMessage);

    const embed = new EmbedBuilder()
        .setColor(noticeType === "error" ? CR_COLORS.ERROR : noticeType === "success" ? CR_COLORS.SUCCESS : CR_COLORS.ELECTRIC)
        .setTitle("🖼️ ATUR GAMBAR CUSTOM ROLE")
        .setDescription(desc.join("\n"))
        .setFooter({ text: CR_FOOTER, iconURL: botAvatar })
        .setTimestamp();

    if (pendingImg) {
        const sizeKb = (pendingImg.meta.size / 1024).toFixed(1);
        const dimInfo =
            pendingImg.meta.width && pendingImg.meta.height ? `${pendingImg.meta.width}×${pendingImg.meta.height} px` : "Tervalidasi";

        embed.addFields({
            name: "✅ Preview Gambar Siap Disimpan",
            value: [
                `• **Nama File:** \`${escapeInline(pendingImg.meta.fileName)}\``,
                `• **Format:** \`${pendingImg.meta.contentType.toUpperCase()}\``,
                `• **Ukuran:** \`${sizeKb} KB\``,
                `• **Dimensi:** \`${dimInfo}\``,
                `• **Status:** Menunggu Anda menekan tombol **SIMPAN**`,
            ].join("\n"),
            inline: false,
        });
        embed.setImage(pendingImg.meta.url);
    } else if (liveRole.iconURL?.() || record.imageUrl) {
        embed.addFields({
            name: "🖼️ Gambar Role Saat Ini",
            value: [
                `• **Status:** ${record.imageMeta?.appliedToDiscord ? "🟢 Terpasang pada Role Discord" : "🖼️ Tersimpan di MongoDB"}`,
                `• **File:** \`${escapeInline(record.imageMeta?.fileName || "role-icon")}\``,
            ].join("\n"),
            inline: false,
        });
        embed.setThumbnail(liveRole.iconURL?.({ size: 128, extension: "png" }) || record.imageUrl);
    }

    const uploadRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:img_upload_modal:${userId}`)
            .setLabel("Pilih Gambar (Galeri HP)")
            .setEmoji("📁")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:img_upload_chat:${userId}`)
            .setLabel("Unggah Lewat Chat")
            .setEmoji("💬")
            .setStyle(ButtonStyle.Secondary),
    );

    if (record.imageUrl || liveRole.icon) {
        uploadRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`${CR_PREFIX}:img_remove:${userId}`)
                .setLabel("Hapus Gambar")
                .setEmoji("🗑️")
                .setStyle(ButtonStyle.Danger),
        );
    }

    const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:img_save:${userId}`)
            .setLabel("SIMPAN")
            .setEmoji("✅")
            .setStyle(ButtonStyle.Success)
            .setDisabled(!pendingImg),
        new ButtonBuilder().setCustomId(`${CR_PREFIX}:cancel:${userId}`).setLabel("BATALKAN").setEmoji("↩️").setStyle(ButtonStyle.Danger),
    );

    return {
        embeds: [embed],
        components: [uploadRow, actionRow],
        files: [],
    };
}

async function buildViewCustomRolePanel(client, guild, user, record, liveRole) {
    const userId = String(user.id);
    const botAvatar = getBotAvatarUrl(client);
    const previewHexes =
        record.gradient?.enabled && record.gradient.colors?.length >= 2 ? record.gradient.colors : [record.color || "#00E5FF"];
    const previewDir = record.gradient?.enabled ? record.gradient.direction || "horizontal" : "horizontal";
    const pngBuffer = generateColorOrGradientPng(previewHexes, previewDir);
    const previewAttachment = new AttachmentBuilder(pngBuffer, { name: "lagukan-view-role.png" });

    const createdUnix = record.createdAt ? Math.floor(new Date(record.createdAt).getTime() / 1000) : null;
    const updatedUnix = record.updatedAt ? Math.floor(new Date(record.updatedAt).getTime() / 1000) : null;
    const parsed = parseAndValidateHexColor(record.color);

    const gradStatus =
        record.gradient?.enabled && record.gradient.colors?.length >= 2
            ? [
                  `🟢 Aktif (${record.gradient.colors.map((c) => `\`${c}\``).join(" → ")})`,
                  `• **Arah:** ${formatDirectionLabel(record.gradient.direction)}`,
                  `• **Penerapan:** \`${
                      record.gradient.appliedMode === "holographic"
                          ? "Holografik Resmi Discord"
                          : record.gradient.appliedMode === "gradient_2"
                            ? "Gradasi Role Discord"
                            : "Desain Preview + Warna Utama"
                  }\``,
              ].join("\n")
            : "`Nonaktif (Warna Solid)`";

    const embed = new EmbedBuilder()
        .setColor(parsed.valid ? parsed.discordInt : CR_COLORS.PRIMARY)
        .setAuthor({
            name: `${guild.name} • Detail Custom Role`,
            iconURL: guild.iconURL?.({ size: 128 }) || botAvatar,
        })
        .setTitle("👁️ DETAIL CUSTOM ROLE ANDA")
        .setDescription(
            liveRole
                ? `Informasi lengkap konfigurasi **Custom Role** milik <@${userId}> pada server **${escapeMarkdown(guild.name)}**.`
                : "⚠️ Role Discord untuk konfigurasi ini sudah tidak ditemukan di server (kemungkinan dihapus manual), namun data tersimpan di MongoDB.",
        )
        .addFields(
            {
                name: "🪪 Identitas Role",
                value: [
                    `• **Mention Role:** ${liveRole ? `<@&${liveRole.id}>` : "`Role terhapus`"}`,
                    `• **ID Role:** \`${record.roleId}\``,
                    `• **Nama Role:** **${escapeMarkdown(liveRole?.name || record.roleName)}**`,
                    `• **Posisi Role:** \`#${liveRole?.position ?? "-"}\``,
                    `• **Warna Utama:** \`${record.color}\``,
                ].join("\n"),
                inline: false,
            },
            {
                name: "🌈 Desain Gradasi & Gambar",
                value: [
                    `• **Gradasi:** ${gradStatus}`,
                    `• **Gambar / Ikon:** ${
                        record.imageUrl
                            ? `${record.imageMeta?.appliedToDiscord ? "🟢 Terpasang di Discord" : "🖼️ Tersimpan sebagai Preview"} (\`${escapeInline(record.imageMeta?.fileName || "icon")}\`)`
                            : "`Belum diatur`"
                    }`,
                    `• **Dibuat:** ${createdUnix ? `<t:${createdUnix}:F>` : "`-`"}`,
                    `• **Diperbarui:** ${updatedUnix ? `<t:${updatedUnix}:R>` : "`-`"}`,
                ].join("\n"),
                inline: false,
            },
        )
        .setImage("attachment://lagukan-view-role.png")
        .setFooter({ text: CR_FOOTER, iconURL: botAvatar })
        .setTimestamp();

    if (liveRole?.iconURL?.()) {
        embed.setThumbnail(liveRole.iconURL({ size: 128, extension: "png" }));
    } else if (record.imageUrl) {
        embed.setThumbnail(record.imageUrl);
    }

    const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:cancel:${userId}`)
            .setLabel("Kembali ke Dashboard")
            .setEmoji("🏠")
            .setStyle(ButtonStyle.Primary),
    );

    return {
        embeds: [embed],
        components: [backRow],
        files: [previewAttachment],
    };
}

function buildDeleteConfirmPanel(client, userId, record, liveRole, allPairs = []) {
    const botAvatar = getBotAvatarUrl(client);
    const embed = new EmbedBuilder()
        .setColor(CR_COLORS.ERROR)
        .setTitle("⚠️ KONFIRMASI HAPUS CUSTOM ROLE")
        .setDescription(
            [
                `Apakah Anda yakin ingin menghapus Custom Role ${liveRole ? `<@&${liveRole.id}>` : `**${escapeMarkdown(record.roleName)}**`} dari server ini?`,
                "",
                "• Role pada Discord dan konfigurasi warna/gradasi/gambar di MongoDB untuk server ini akan dihapus permanen.",
                "• Sistem hanya menghapus Custom Role terdaftar milik Anda sendiri.",
                "• Custom Role Anda di server lain **tidak akan terpengaruh**.",
            ].join("\n"),
        )
        .setFooter({ text: CR_FOOTER, iconURL: botAvatar })
        .setTimestamp();

    const components = [];

    if (Array.isArray(allPairs) && allPairs.length > 1) {
        const selectOptions = allPairs.slice(0, 25).map((pair, idx) => {
            const labelName = pair.liveRole?.name || pair.record.roleName || `Role #${idx + 1}`;
            return {
                label: `${idx + 1}. ${labelName}`.slice(0, 100),
                value: String(pair.record.roleId),
                emoji: pair.liveRole ? "🎭" : "⚠️",
                description: `${pair.record.color} • ID: ${pair.record.roleId}`.slice(0, 100),
                default: String(pair.record.roleId) === String(record.roleId),
            };
        });

        components.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`${CR_PREFIX}:delete_select_role:${userId}`)
                    .setPlaceholder("🎭 Pilih Custom Role Milikmu yang Akan Dihapus ▼")
                    .addOptions(selectOptions),
            ),
        );
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:delete_confirm:${userId}:${record.roleId}`)
            .setLabel("YA, HAPUS CUSTOM ROLE")
            .setEmoji("🗑️")
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:delete_cancel:${userId}`)
            .setLabel("BATALKAN")
            .setEmoji("↩️")
            .setStyle(ButtonStyle.Secondary),
    );

    components.push(row);

    return {
        embeds: [embed],
        components,
        files: [],
    };
}

// ============================================================================
// Permanent Public Custom Role Panel & Auto-Sync Engine (No Collector Needed)
// ============================================================================

async function resolveGuildTextChannel(guild, channelId) {
    if (!guild || !channelId) return null;
    const cId = String(channelId);
    const cached = guild.channels?.cache?.get?.(cId) || null;
    if (cached) return cached;
    if (typeof guild.channels?.fetch === "function") {
        return guild.channels.fetch(cId).catch(() => null);
    }
    return null;
}

async function fetchChannelMessageSafe(channel, messageId) {
    if (!channel || !messageId) return null;
    const mId = String(messageId);
    if (typeof channel.messages?.fetch === "function") {
        const fetched = await channel.messages.fetch(mId).catch(() => null);
        if (fetched) return fetched;
    }
    return channel.messages?.cache?.get?.(mId) || null;
}

async function validateBotPanelChannelPermissions(guild, channel) {
    if (!channel || typeof channel.send !== "function") {
        return {
            valid: false,
            code: "INVALID_CHANNEL",
            message: "Channel yang dipilih tidak valid atau bukan channel teks server.",
        };
    }

    const channelGuildId = channel.guildId || channel.guild?.id;
    if (channelGuildId && String(channelGuildId) !== String(guild.id)) {
        return {
            valid: false,
            code: "WRONG_GUILD_CHANNEL",
            message: "Channel tersebut bukan bagian dari server ini.",
        };
    }

    const botMember = await resolveBotMember(guild);
    if (!botMember) {
        return {
            valid: false,
            code: "BOT_MEMBER_MISSING",
            message: "Data member bot di server ini belum tersedia. Silakan coba lagi.",
        };
    }

    if (typeof channel.permissionsFor === "function") {
        const perms = channel.permissionsFor(botMember);
        const required = [
            { flag: PermissionsBitField.Flags.ViewChannel, name: "View Channel" },
            { flag: PermissionsBitField.Flags.SendMessages, name: "Send Messages" },
            { flag: PermissionsBitField.Flags.EmbedLinks, name: "Embed Links" },
            { flag: PermissionsBitField.Flags.ReadMessageHistory, name: "Read Message History" },
        ];
        const missing = required.filter((req) => perms && !perms.has(req.flag)).map((req) => req.name);
        if (missing.length > 0) {
            return {
                valid: false,
                code: "MISSING_PANEL_PERMS",
                missing,
                message: `Bot **Lagukan** tidak memiliki permission **\`${missing.join(", ")}\`** pada channel <#${channel.id}>. Berikan izin tersebut terlebih dahulu.`,
            };
        }
    }

    return {
        valid: true,
        code: "OK",
        message: null,
    };
}

function buildCustomRolePublicPanel(client, guild, config) {
    const botName = client?.config?.botName || "Lagukan";
    const botAvatar = getBotAvatarUrl(client);
    const guildIcon = guild.iconURL?.({ size: 256 }) || botAvatar;
    const capabilities = detectGuildCustomRoleCapabilities(guild);

    const accessRules = [];
    if (!config.customRoleEnabled) {
        accessRules.push("🔴 **Status Sistem:** Sedang dinonaktifkan sementara oleh Admin.");
    } else {
        accessRules.push("🟢 **Status Sistem:** Aktif & Otomatis");
    }

    if (config.boosterAccessEnabled) {
        accessRules.push("💎 **Server Booster:** Diizinkan otomatis");
    }

    if (config.roleAccessEnabled) {
        if (Array.isArray(config.allowedRoles) && config.allowedRoles.length > 0) {
            const roleMentions = config.allowedRoles
                .slice(0, 8)
                .map((id) => `<@&${id}>`)
                .join(", ");
            const extraCount = config.allowedRoles.length > 8 ? ` *(+${config.allowedRoles.length - 8} lainnya)*` : "";
            accessRules.push(`🎭 **Role Khusus:** ${roleMentions}${extraCount}`);
        } else {
            accessRules.push("🎭 **Role Khusus:** Diaktifkan *(menunggu Admin memilih daftar role)*");
        }
    }

    if (config.boosterAccessEnabled && config.roleAccessEnabled && config.allowedRoles.length > 0) {
        accessRules.push("ℹ️ *Berlaku aturan **OR**: cukup menjadi Server Booster **atau** memiliki salah satu Role Khusus di atas.*");
    } else if (!config.boosterAccessEnabled && (!config.roleAccessEnabled || config.allowedRoles.length === 0)) {
        accessRules.push("🔒 *Saat ini akses hanya terbuka bagi Administrator / Pengelola Server.*");
    }

    accessRules.push(`🔢 **Kuota Kepemilikan:** Maksimal \`${config.maxRolesPerMember || 1}\` Custom Role per member`);

    const featureLines = [
        "• **Nama & Warna Kustom:** Pilih warna Preset populer atau kode **HEX** bebas beserta preview visual.",
        `• **Gradasi Warna Role:** ${
            capabilities.hasEnhancedRoleColors
                ? "🟢 Didukung (`Enhanced Role Styles` aktif)"
                : "⚪ Mengikuti dukungan fitur `Enhanced Role Styles` Discord server"
        }`,
        `• **Ikon Role (Attachment):** ${
            capabilities.hasRoleIcons
                ? "🟢 Didukung (`Role Icons` / Boost Lv. 2+ aktif)"
                : "⚪ Membutuhkan `Server Boost Level 2` (`ROLE_ICONS`)"
        }`,
    ];

    const buttonGuideLines = [
        "➕ **`CREATE ROLE`** — Buka dashboard pembuatan Custom Role baru",
        "🎛️ **`MANAGE ROLE`** — Kelola nama, warna, gradasi, dan ikon role milikmu",
        "🗑️ **`DELETE ROLE`** — Hapus Custom Role milikmu beserta datanya dengan aman",
    ];

    const embed = new EmbedBuilder()
        .setColor(config.customRoleEnabled ? CR_COLORS.PRIMARY : CR_COLORS.DARK)
        .setAuthor({
            name: `${guild.name} • ${botName} Custom Role`,
            iconURL: guildIcon,
        })
        .setTitle("CUSTOM ROLE SYSTEM")
        .setDescription("Buat dan kelola role pribadimu melalui panel ini.")
        .addFields(
            {
                name: "🛡️ Persyaratan & Akses Server",
                value: accessRules.join("\n"),
                inline: false,
            },
            {
                name: "✨ Fitur Kustomisasi",
                value: featureLines.join("\n"),
                inline: false,
            },
            {
                name: "🎛️ Navigasi Panel",
                value: buttonGuideLines.join("\n"),
                inline: false,
            },
        )
        .setFooter({ text: CR_FOOTER, iconURL: botAvatar })
        .setTimestamp();

    if (guildIcon) {
        embed.setThumbnail(guildIcon);
    }

    // Permanent stateless customIds — handled globally via interactionCreate (survives all restarts!)
    const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${CR_PREFIX}:panel_create`).setLabel("CREATE ROLE").setEmoji("➕").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${CR_PREFIX}:panel_manage`).setLabel("MANAGE ROLE").setEmoji("🎛️").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${CR_PREFIX}:panel_delete`).setLabel("DELETE ROLE").setEmoji("🗑️").setStyle(ButtonStyle.Danger),
    );

    return {
        embeds: [embed],
        components: [buttonRow],
    };
}

/**
 * Sends, edits in-place, moves, or recreates a guild's Custom Role panel without ever creating duplicates.
 */
async function syncCustomRolePanel(client, guild, options = {}) {
    if (!guild?.id) {
        return { ok: false, code: "NO_GUILD", message: "Data server tidak ditemukan." };
    }

    return withCustomRoleLock(guild.id, "panel_sync", async () => {
        const currentConfig = await getGuildCustomRoleConfig(client, guild.id);
        const desiredChannelId = options.targetChannelId ? String(options.targetChannelId) : currentConfig.channelId;

        if (!desiredChannelId) {
            return {
                ok: false,
                code: "NO_CHANNEL",
                config: currentConfig,
                message: "Channel panel Custom Role belum dipilih. Pilih channel melalui menu dropdown terlebih dahulu.",
            };
        }

        const targetChannel = await resolveGuildTextChannel(guild, desiredChannelId);
        const permCheck = await validateBotPanelChannelPermissions(guild, targetChannel);
        if (!permCheck.valid) {
            return {
                ok: false,
                code: permCheck.code,
                config: currentConfig,
                message: permCheck.message,
            };
        }

        const previousChannelId = currentConfig.channelId;
        const previousMessageId = currentConfig.panelMessageId;
        const isChannelChanged = Boolean(previousChannelId && String(previousChannelId) !== String(desiredChannelId));
        const forceResend = Boolean(options.forceResend);
        const recreateIfMissing = options.recreateIfMissing !== false;

        // Build panel with target channel reflected in config
        const workingConfig = normalizeGuildCustomRoleConfig(guild.id, {
            ...currentConfig,
            channelId: desiredChannelId,
            ...(options.updatedBy ? { updatedBy: String(options.updatedBy) } : {}),
        });
        const panelPayload = buildCustomRolePublicPanel(client, guild, workingConfig);

        // Clean up old panel message when moving channels or explicitly resending so duplicates never remain
        if ((isChannelChanged || forceResend) && previousChannelId && previousMessageId) {
            const oldChannel = isChannelChanged ? await resolveGuildTextChannel(guild, previousChannelId) : targetChannel;
            if (oldChannel) {
                const oldMsg = await fetchChannelMessageSafe(oldChannel, previousMessageId);
                if (oldMsg && typeof oldMsg.delete === "function") {
                    await oldMsg.delete().catch(() => {});
                }
            }
        }

        // Try in-place edit when staying in the same channel and not forcing resend
        if (!isChannelChanged && !forceResend && previousMessageId) {
            const existingMsg = await fetchChannelMessageSafe(targetChannel, previousMessageId);
            if (existingMsg && typeof existingMsg.edit === "function") {
                try {
                    await existingMsg.edit(panelPayload);
                    const saved = isMongoReady()
                        ? await saveGuildCustomRoleConfig(client, guild.id, {
                              channelId: desiredChannelId,
                              panelMessageId: String(existingMsg.id),
                              ...(options.updatedBy ? { updatedBy: String(options.updatedBy) } : {}),
                          })
                        : workingConfig;

                    return {
                        ok: true,
                        action: "updated",
                        channelId: desiredChannelId,
                        panelMessageId: String(existingMsg.id),
                        config: saved,
                    };
                } catch (editErr) {
                    Logger.warn(`[CustomRolePanel] Gagal mengedit panel lama (${guild.id}), mencoba kirim ulang: ${editErr?.message}`);
                }
            }

            if (!recreateIfMissing) {
                return {
                    ok: false,
                    code: "PANEL_DELETED",
                    config: currentConfig,
                    message: "Pesan panel sebelumnya telah terhapus.",
                };
            }
        }

        // Send fresh panel message (initial setup, channel move, deleted panel recovery, or explicit resend)
        let sentMsg;
        try {
            sentMsg = await targetChannel.send(panelPayload);
        } catch (sendErr) {
            Logger.error(`[CustomRolePanel] Gagal mengirim panel Custom Role ke channel ${desiredChannelId} (${guild.id}):`, sendErr);
            return {
                ok: false,
                code: "SEND_FAILED",
                config: currentConfig,
                message: `Gagal mengirim panel ke <#${desiredChannelId}>: \`${escapeInline(sendErr?.message || "Discord API Error")}\``,
            };
        }

        const savedConfig = await saveGuildCustomRoleConfig(client, guild.id, {
            channelId: desiredChannelId,
            panelMessageId: String(sentMsg.id),
            ...(options.updatedBy ? { updatedBy: String(options.updatedBy) } : {}),
        });

        const resultAction = isChannelChanged ? "moved" : forceResend ? "resent" : previousMessageId ? "recreated" : "created";

        return {
            ok: true,
            action: resultAction,
            channelId: desiredChannelId,
            panelMessageId: String(sentMsg.id),
            config: savedConfig,
        };
    });
}

/**
 * Verifies & syncs Custom Role panels across all configured guilds on bot startup without creating duplicates.
 */
async function initializeCustomRolePanels(client) {
    try {
        for (let attempt = 0; attempt < 10 && !isMongoReady(); attempt++) {
            await new Promise((r) => setTimeout(r, 500));
        }
        if (!isMongoReady()) return;

        const ConfigModel = getCustomRoleConfigModel(client);
        if (typeof ConfigModel?.find !== "function") return;

        const query = ConfigModel.find({ channelId: { $ne: null } });
        const docs = typeof query.lean === "function" ? await query.lean() : await query;
        if (!Array.isArray(docs) || docs.length === 0) return;

        for (const rawDoc of docs) {
            if (!rawDoc?.guildId || !rawDoc?.channelId) continue;
            const gId = String(rawDoc.guildId);
            const normalized = normalizeGuildCustomRoleConfig(gId, rawDoc);
            client.data.set(`customRoleConfig_${gId}`, normalized);

            const guild = client.guilds?.cache?.get?.(gId);
            if (!guild) continue;

            await syncCustomRolePanel(client, guild, {
                forceResend: false,
                recreateIfMissing: true,
            }).catch((err) => {
                Logger.debug(`[CustomRolePanel] Sinkronisasi awal dilewati untuk server ${gId}: ${err?.message || err}`);
            });
        }
    } catch (err) {
        Logger.debug(`[CustomRolePanel] Gagal menjalankan inisialisasi panel awal: ${err?.message || err}`);
    }
}

// ============================================================================
// UI Builder — Dedicated Ephemeral Create Role Dashboard (Panel `CREATE ROLE`)
// ============================================================================

async function buildCreateRoleStudioPanel(client, guild, user, options = {}) {
    const userId = String(user.id);
    const botAvatar = getBotAvatarUrl(client);
    const guildIcon = guild.iconURL?.({ size: 128 }) || botAvatar;
    const capabilities = detectGuildCustomRoleCapabilities(guild);
    const config = options.config || (await getGuildCustomRoleConfig(client, guild.id));
    const roleCtx = options.roleCtx || (await resolveUserRoleContext(client, guild, userId));
    const draft = getOrInitDraft(client, guild.id, userId);
    const cDraft = draft.createDraft;

    const activeCount = roleCtx.activePairs.length;
    const maxRoles = config.maxRolesPerMember || 1;

    const activeHexParsed = parseAndValidateHexColor(cDraft.colorHex || "#00E5FF");
    const activeHex = activeHexParsed.valid ? activeHexParsed.hex : "#00E5FF";

    const gradActive = Boolean(capabilities.hasEnhancedRoleColors && cDraft.gradient?.enabled && cDraft.gradient.colors?.length >= 2);
    const previewHexes = gradActive ? cDraft.gradient.colors : [activeHex];
    const previewDirection = gradActive ? cDraft.gradient.direction || "horizontal" : "horizontal";

    const pngBuffer = generateColorOrGradientPng(previewHexes, previewDirection);
    const previewAttachment = new AttachmentBuilder(pngBuffer, { name: "lagukan-create-role-preview.png" });

    const gradLabel = gradActive
        ? `${cDraft.gradient.colors.map((c) => `\`${c}\``).join(" → ")} (${
              cDraft.gradient.mode === "holographic" ? "Holografik Resmi Discord" : "Gradasi 2 Warna"
          })`
        : capabilities.hasEnhancedRoleColors
          ? "`Nonaktif (Warna Solid)`"
          : "`Tidak Didukung Server Ini`";

    const iconLabel =
        capabilities.hasRoleIcons && cDraft.pendingImage?.meta
            ? `✅ Siap dipasang (\`${escapeInline(cDraft.pendingImage.meta.fileName)}\` • \`${(cDraft.pendingImage.meta.size / 1024).toFixed(1)} KB\`)`
            : capabilities.hasRoleIcons
              ? "`Belum diatur (Opsional — Maks. 256 KB)`"
              : "`Membutuhkan Server Boost Level 2 (ROLE_ICONS)`";

    const descLines = [
        `**Dashboard Pembuatan Custom Role — ${escapeMarkdown(guild.name)}**`,
        "Atur nama role, warna HEX atau preset, gradasi, serta ikon role pribadimu di bawah ini, lalu tekan tombol **`BUAT ROLE SEKARANG`**.",
    ];
    if (options.noticeMessage) {
        descLines.push("", options.noticeMessage);
    }

    let embedColor = activeHexParsed.valid ? activeHexParsed.discordInt : CR_COLORS.PRIMARY;
    if (options.noticeType === "error") embedColor = CR_COLORS.ERROR;
    else if (options.noticeType === "warning") embedColor = CR_COLORS.WARNING;
    else if (options.noticeType === "success") embedColor = CR_COLORS.SUCCESS;

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({
            name: `${guild.name} • Pembuatan Custom Role`,
            iconURL: guildIcon,
        })
        .setTitle("➕ CREATE CUSTOM ROLE")
        .setDescription(descLines.join("\n"))
        .addFields(
            {
                name: "🪪 Draft Custom Role Baru",
                value: [
                    `• **Pemilik:** <@${userId}> (\`Kuota: ${activeCount}/${maxRoles}\`)`,
                    `• **Nama Role:** ${
                        cDraft.roleName
                            ? `**${escapeMarkdown(cDraft.roleName)}**`
                            : "⚠️ *Belum diisi — klik **Nama Role** atau langsung klik **BUAT ROLE SEKARANG***"
                    }`,
                    `• **Warna HEX:** \`${activeHex}\``,
                    `• **Gradasi:** ${gradLabel}`,
                    `• **Ikon Role:** ${iconLabel}`,
                ].join("\n"),
                inline: false,
            },
            {
                name: "🛰️ Dukungan Fitur Resmi Discord",
                value: [
                    `• **Gradasi Role:** ${
                        capabilities.hasEnhancedRoleColors
                            ? "🟢 Didukung (`Enhanced Role Styles` aktif)"
                            : "🔒 Tidak didukung di server ini (`ENHANCED_ROLE_COLORS` belum aktif)"
                    }`,
                    `• **Ikon Role (Attachment):** ${
                        capabilities.hasRoleIcons
                            ? "🟢 Didukung (`Role Icons` / Boost Lv. 2+ aktif)"
                            : "🔒 Membutuhkan `Server Boost Level 2` (`ROLE_ICONS`)"
                    }`,
                ].join("\n"),
                inline: false,
            },
        )
        .setImage("attachment://lagukan-create-role-preview.png")
        .setFooter({ text: CR_FOOTER, iconURL: botAvatar })
        .setTimestamp();

    if (capabilities.hasRoleIcons && cDraft.pendingImage?.meta?.url) {
        embed.setThumbnail(cDraft.pendingImage.meta.url);
    }

    const presetColorRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`${CR_PREFIX}:create_color_preset:${userId}`)
            .setPlaceholder("🎨 Pilih Warna Preset Populer ▼")
            .addOptions(
                PRESET_COLORS.map((p) => ({
                    label: `${p.label} (${p.hex})`,
                    value: p.hex,
                    emoji: p.emoji,
                    description: p.description,
                    default: !gradActive && p.hex.toUpperCase() === activeHex.toUpperCase(),
                })),
            ),
    );

    const gradSelectOptions = [
        {
            label: "Tanpa Gradasi (Warna Solid)",
            value: "off",
            emoji: "⚪",
            description: "Gunakan warna solid HEX / Preset utama",
            default: !gradActive,
        },
        ...GRADIENT_PRESETS.filter((gp) => gp.mode === "two_color" || gp.mode === "holographic").map((gp) => ({
            label: gp.label,
            value: gp.id,
            emoji: gp.emoji,
            description: gp.description,
        })),
    ];

    const presetGradRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`${CR_PREFIX}:create_grad_preset:${userId}`)
            .setPlaceholder(
                capabilities.hasEnhancedRoleColors
                    ? "🌈 Pilih Gradasi Role (Opsional) ▼"
                    : "🔒 Gradasi Membutuhkan Fitur Enhanced Role Styles Server",
            )
            .setDisabled(!capabilities.hasEnhancedRoleColors)
            .addOptions(gradSelectOptions),
    );

    const customizerRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:create_name_modal:${userId}`)
            .setLabel("Nama Role")
            .setEmoji("✏️")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:create_hex_modal:${userId}`)
            .setLabel("Warna HEX")
            .setEmoji("⌨️")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:create_grad_modal:${userId}`)
            .setLabel("Gradasi HEX")
            .setEmoji("🌈")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!capabilities.hasEnhancedRoleColors),
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:create_icon_modal:${userId}`)
            .setLabel("Upload Ikon")
            .setEmoji("🖼️")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!capabilities.hasRoleIcons),
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:create_icon_chat:${userId}`)
            .setLabel("Ikon via Chat")
            .setEmoji("💬")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!capabilities.hasRoleIcons),
    );

    const submitRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:create_submit:${userId}`)
            .setLabel("BUAT ROLE SEKARANG")
            .setEmoji("✅")
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:create_reset:${userId}`)
            .setLabel("Reset Draft")
            .setEmoji("🔄")
            .setStyle(ButtonStyle.Secondary),
    );

    if (activeCount > 0) {
        submitRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`${CR_PREFIX}:cancel:${userId}`)
                .setLabel("Kelola Role Milikku")
                .setEmoji("🎛️")
                .setStyle(ButtonStyle.Primary),
        );
    }

    return {
        embeds: [embed],
        components: [presetColorRow, presetGradRow, customizerRow, submitRow],
        files: [previewAttachment],
    };
}

// ============================================================================
// UI Builders — Admin Configuration Dashboard (/customrole-config)
// ============================================================================

async function buildCustomRoleConfigDashboard(client, guild, adminUserId, options = {}) {
    const adminId = String(adminUserId);
    const botAvatar = getBotAvatarUrl(client);
    const guildIcon = guild.iconURL?.({ size: 128 }) || botAvatar;
    const config = options.config || (await getGuildCustomRoleConfig(client, guild.id));

    const allowedRoleMentions = [];
    for (const rId of config.allowedRoles) {
        const live = guild.roles?.cache?.get?.(String(rId));
        allowedRoleMentions.push(live ? `<@&${rId}>` : `\`Role Terhapus (${rId})\``);
    }

    const allowedPreviewText =
        allowedRoleMentions.length > 0
            ? allowedRoleMentions.slice(0, 12).join(", ") +
              (allowedRoleMentions.length > 12 ? ` *(+${allowedRoleMentions.length - 12} role lainnya)*` : "")
            : "`Belum ada role khusus yang dipilih`";

    // Check live panel channel & panel message status
    let panelChannelStatus = "`Belum diatur (pilih channel di bawah)`";
    let panelMsgStatus = "⚪ `Panel belum dikirim`";

    if (config.channelId) {
        const liveChannel = await resolveGuildTextChannel(guild, config.channelId);
        if (!liveChannel) {
            panelChannelStatus = `⚠️ \`Channel Terhapus (${config.channelId})\` — *pilih channel baru*`;
            panelMsgStatus = "⚠️ `Channel panel sudah tidak ditemukan`";
        } else {
            panelChannelStatus = `<#${liveChannel.id}>`;
            if (config.panelMessageId) {
                const livePanelMsg = await fetchChannelMessageSafe(liveChannel, config.panelMessageId);
                if (livePanelMsg) {
                    panelMsgStatus = `🟢 **Aktif** (\`ID: ${config.panelMessageId}\`)`;
                } else {
                    panelMsgStatus = `⚠️ **Pesan Panel Terhapus** — *tekan **Perbarui Panel** atau **Kirim Ulang** di bawah*`;
                }
            } else {
                panelMsgStatus = "⚪ `Belum ada pesan panel tersimpan`";
            }
        }
    }

    const updatedUnix = config.updatedAt ? Math.floor(new Date(config.updatedAt).getTime() / 1000) : null;

    const descLines = [
        `**Pengaturan Sistem & Panel Custom Role — ${escapeMarkdown(guild.name)}**`,
        "Pilih **Channel Panel** agar member dapat mengakses fitur **Custom Role** langsung melalui tombol panel tanpa mengetik command `/customrole`, serta atur syarat akses otomatis server.",
    ];

    if (!config.boosterAccessEnabled && (!config.roleAccessEnabled || config.allowedRoles.length === 0)) {
        descLines.push(
            "",
            "⚠️ *Saat ini akses Booster nonaktif dan belum ada Role Khusus aktif — hanya Administrator / Manage Guild yang memiliki akses.*",
        );
    }

    if (options.noticeMessage) {
        descLines.push("", options.noticeMessage);
    }

    let embedColor = CR_COLORS.PRIMARY;
    if (options.noticeType === "success") embedColor = CR_COLORS.SUCCESS;
    else if (options.noticeType === "warning") embedColor = CR_COLORS.WARNING;
    else if (options.noticeType === "error") embedColor = CR_COLORS.ERROR;

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({
            name: `${guild.name} • Konfigurasi Custom Role`,
            iconURL: guildIcon,
        })
        .setTitle("⚙️ PENGATURAN CUSTOM ROLE SERVER")
        .setDescription(descLines.join("\n"))
        .addFields(
            {
                name: "📢 Panel Custom Role Otomatis",
                value: [`• **Channel Panel:** ${panelChannelStatus}`, `• **Status Pesan Panel:** ${panelMsgStatus}`].join("\n"),
                inline: false,
            },
            {
                name: "🛡️ Status Persyaratan Akses",
                value: [
                    `• **Status Fitur Custom Role:** ${config.customRoleEnabled ? "🟢 **Aktif**" : "🔴 **Nonaktif**"}`,
                    `• **Akses Server Booster:** ${config.boosterAccessEnabled ? "🟢 **Diizinkan**" : "🔴 **Dinonaktifkan**"}`,
                    `• **Akses Role Khusus:** ${config.roleAccessEnabled ? "🟢 **Diizinkan**" : "🔴 **Dinonaktifkan**"}`,
                    `• **Batas Kepemilikan:** \`Maksimal ${config.maxRolesPerMember} Custom Role per Member\``,
                    `• **Terakhir Diperbarui:** ${updatedUnix ? `<t:${updatedUnix}:R>` : "`Default Sistem`"}`,
                ].join("\n"),
                inline: false,
            },
            {
                name: `🎭 Daftar Role Khusus yang Diizinkan (${config.allowedRoles.length}/${MAX_ALLOWED_ROLES_PER_GUILD})`,
                value: allowedPreviewText,
                inline: false,
            },
        )
        .setFooter({ text: CR_FOOTER, iconURL: botAvatar })
        .setTimestamp();

    const toggleRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:cfg_toggle_enabled:${adminId}`)
            .setLabel(`Sistem: ${config.customRoleEnabled ? "AKTIF" : "NONAKTIF"}`)
            .setEmoji(config.customRoleEnabled ? "🟢" : "🔴")
            .setStyle(config.customRoleEnabled ? ButtonStyle.Success : ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:cfg_toggle_booster:${adminId}`)
            .setLabel(`Booster: ${config.boosterAccessEnabled ? "AKTIF" : "NONAKTIF"}`)
            .setEmoji("💎")
            .setStyle(config.boosterAccessEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:cfg_toggle_role:${adminId}`)
            .setLabel(`Role Khusus: ${config.roleAccessEnabled ? "AKTIF" : "NONAKTIF"}`)
            .setEmoji("🎭")
            .setStyle(config.roleAccessEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:cfg_max_modal:${adminId}`)
            .setLabel(`Batas Role: ${config.maxRolesPerMember}`)
            .setEmoji("🔢")
            .setStyle(ButtonStyle.Primary),
    );

    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId(`${CR_PREFIX}:cfg_select_channel:${adminId}`)
        .setPlaceholder("📢 Pilih Channel Panel Custom Role Otomatis ▼")
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(1);

    if (config.channelId && guild.channels?.cache?.has?.(String(config.channelId))) {
        channelSelect.setDefaultChannels(String(config.channelId));
    }

    const channelRow = new ActionRowBuilder().addComponents(channelSelect);

    const maxSelectableAdd = Math.min(15, Math.max(1, MAX_ALLOWED_ROLES_PER_GUILD));
    const addRoleRow = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
            .setCustomId(`${CR_PREFIX}:cfg_add_roles:${adminId}`)
            .setPlaceholder("➕ Pilih / Tambahkan Role yang Diizinkan (Bisa Beberapa Role) ▼")
            .setMinValues(1)
            .setMaxValues(maxSelectableAdd),
    );

    const components = [toggleRow, channelRow, addRoleRow];

    if (config.allowedRoles.length > 0) {
        const removeOptions = config.allowedRoles.slice(0, 25).map((rId) => {
            const roleObj = guild.roles?.cache?.get?.(String(rId));
            return {
                label: (roleObj ? roleObj.name : `Role Terhapus (${rId})`).slice(0, 100),
                value: String(rId),
                emoji: "🗑️",
                description: `ID Role: ${rId}`,
            };
        });

        components.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`${CR_PREFIX}:cfg_remove_roles:${adminId}`)
                    .setPlaceholder("➖ Hapus Role dari Daftar Izin (Pilih 1 atau Beberapa) ▼")
                    .setMinValues(1)
                    .setMaxValues(removeOptions.length)
                    .addOptions(removeOptions),
            ),
        );
    }

    const utilRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:cfg_refresh_panel:${adminId}`)
            .setLabel("Perbarui Panel")
            .setEmoji("🔄")
            .setStyle(ButtonStyle.Success)
            .setDisabled(!config.channelId),
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:cfg_resend_panel:${adminId}`)
            .setLabel("Kirim Ulang Panel")
            .setEmoji("📨")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(!config.channelId),
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:cfg_view_roles:${adminId}`)
            .setLabel(`Daftar Role (${config.allowedRoles.length})`)
            .setEmoji("📋")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:cfg_member_roles:${adminId}`)
            .setLabel("Kelola Role Member")
            .setEmoji("🛡️")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:cfg_clear_roles:${adminId}`)
            .setLabel("Reset Role Izin")
            .setEmoji("🧹")
            .setStyle(ButtonStyle.Danger)
            .setDisabled(config.allowedRoles.length === 0),
    );

    components.push(utilRow);

    return {
        embeds: [embed],
        components,
        files: [],
    };
}

async function buildAllowedRolesListView(client, guild, adminUserId) {
    const adminId = String(adminUserId);
    const botAvatar = getBotAvatarUrl(client);
    const config = await getGuildCustomRoleConfig(client, guild.id);

    const lines = [];
    if (config.allowedRoles.length === 0) {
        lines.push("Belum ada **Role Khusus** yang ditambahkan ke daftar izin di server ini.");
    } else {
        for (let i = 0; i < config.allowedRoles.length; i++) {
            const rId = config.allowedRoles[i];
            const roleObj = await resolveGuildRole(guild, rId);
            if (roleObj) {
                lines.push(`${i + 1}. <@&${roleObj.id}> — **${escapeMarkdown(roleObj.name)}** (\`ID: ${roleObj.id}\`)`);
            } else {
                lines.push(`${i + 1}. ⚠️ \`Role Tidak Ditemukan di Server\` (\`ID: ${rId}\`)`);
            }
        }
    }

    const embed = new EmbedBuilder()
        .setColor(CR_COLORS.ELECTRIC)
        .setAuthor({
            name: `${guild.name} • Daftar Role Izin Custom Role`,
            iconURL: guild.iconURL?.({ size: 128 }) || botAvatar,
        })
        .setTitle("📋 DAFTAR ROLE YANG MEMILIKI AKSES CUSTOM ROLE")
        .setDescription(
            [
                `• **Status Akses Role Khusus:** ${config.roleAccessEnabled ? "🟢 **Aktif**" : "🔴 **Dinonaktifkan**"}`,
                `• **Status Akses Server Booster:** ${config.boosterAccessEnabled ? "🟢 **Aktif**" : "🔴 **Dinonaktifkan**"}`,
                "",
                "**Daftar Role Khusus Terdaftar:**",
                ...lines,
            ].join("\n"),
        )
        .setFooter({ text: CR_FOOTER, iconURL: botAvatar })
        .setTimestamp();

    const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:cfg_back:${adminId}`)
            .setLabel("Kembali ke Pengaturan")
            .setEmoji("↩️")
            .setStyle(ButtonStyle.Primary),
    );

    return {
        embeds: [embed],
        components: [backRow],
        files: [],
    };
}

async function buildAdminMemberRolesPanel(client, guild, adminUserId, noticeMessage = null, noticeType = null) {
    const adminId = String(adminUserId);
    const botAvatar = getBotAvatarUrl(client);
    const config = await getGuildCustomRoleConfig(client, guild.id);
    const draft = getOrInitDraft(client, guild.id, adminId);
    const allRecords = await getGuildAllCustomRoleRecords(client, guild.id);

    const pageSize = 10;
    const totalPages = Math.max(1, Math.ceil(allRecords.length / pageSize));
    const currentPage = Math.max(0, Math.min(totalPages - 1, Number(draft.adminPage) || 0));
    draft.adminPage = currentPage;

    const slice = allRecords.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

    let selectedRec = null;
    if (draft.adminSelectedRoleId) {
        selectedRec = allRecords.find((r) => String(r.roleId) === String(draft.adminSelectedRoleId)) || null;
    }
    if (!selectedRec && slice.length > 0) {
        selectedRec = slice[0];
        draft.adminSelectedRoleId = String(selectedRec.roleId);
    }

    const itemLines = [];
    const selectOptions = [];

    for (let i = 0; i < slice.length; i++) {
        const rec = slice[i];
        const liveRole = await resolveGuildRole(guild, rec.roleId);
        const ownerMember = await resolveGuildMember(guild, rec.userId);
        const ownerIsAdmin = ownerMember ? canManageCustomRoleConfig(ownerMember, guild) : false;
        const eligibility = ownerMember
            ? evaluateMemberEligibilityWithConfig(guild, config, ownerMember, null, ownerIsAdmin)
            : { allowed: false };

        const accessBadge = !ownerMember
            ? "🚪 Keluar Server"
            : eligibility.allowed
              ? "🟢 Akses Aktif"
              : "⚠️ Kehilangan Akses (Role Dipertahankan)";

        itemLines.push(
            `**${currentPage * pageSize + i + 1}.** ${liveRole ? `<@&${liveRole.id}>` : `\`${escapeInline(rec.roleName)} (Terhapus)\``} — Pemilik: <@${rec.userId}> • ${accessBadge}`,
        );

        selectOptions.push({
            label: `${liveRole?.name || rec.roleName} (${rec.color})`.slice(0, 100),
            value: String(rec.roleId),
            emoji: eligibility.allowed ? "🟢" : "⚠️",
            description: `Pemilik ID: ${rec.userId} • ${accessBadge}`.slice(0, 100),
            default: selectedRec && String(selectedRec.roleId) === String(rec.roleId),
        });
    }

    const desc = [
        `**Panel Pengelolaan Penuh Admin — ${escapeMarkdown(guild.name)}**`,
        "Role milik member yang kehilangan status Booster atau Role Khusus **tetap dipertahankan secara aman** dan ditandai `⚠️ Kehilangan Akses` agar Admin dapat menentukan tindakan selanjutnya.",
    ];
    if (noticeMessage) desc.push("", noticeMessage);
    desc.push("", allRecords.length === 0 ? "*Belum ada Custom Role yang dibuat pada server ini.*" : itemLines.join("\n"));

    const embed = new EmbedBuilder()
        .setColor(noticeType === "error" ? CR_COLORS.ERROR : noticeType === "success" ? CR_COLORS.SUCCESS : CR_COLORS.PRIMARY)
        .setTitle(`🛡️ KELOLA CUSTOM ROLE MEMBER (${allRecords.length} ROLE)`)
        .setDescription(desc.join("\n"))
        .setFooter({
            text: `${CR_FOOTER} • Halaman ${currentPage + 1}/${totalPages}`,
            iconURL: botAvatar,
        })
        .setTimestamp();

    const components = [];

    if (selectOptions.length > 0) {
        components.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`${CR_PREFIX}:cfg_admin_pick:${adminId}`)
                    .setPlaceholder("🎯 Pilih Custom Role Member untuk Dikelola ▼")
                    .addOptions(selectOptions),
            ),
        );
    }

    if (selectedRec) {
        components.push(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`${CR_PREFIX}:cfg_admin_rename:${adminId}:${selectedRec.roleId}`)
                    .setLabel("Ubah Nama Role")
                    .setEmoji("✏️")
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`${CR_PREFIX}:cfg_admin_color:${adminId}:${selectedRec.roleId}`)
                    .setLabel("Ubah Warna HEX")
                    .setEmoji("🎨")
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`${CR_PREFIX}:cfg_admin_delete:${adminId}:${selectedRec.roleId}`)
                    .setLabel("Hapus Role Ini")
                    .setEmoji("🗑️")
                    .setStyle(ButtonStyle.Danger),
            ),
        );
    }

    const navRow = new ActionRowBuilder();
    if (totalPages > 1) {
        navRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`${CR_PREFIX}:cfg_admin_prev:${adminId}`)
                .setLabel("◀ Sebelumnya")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage <= 0),
            new ButtonBuilder()
                .setCustomId(`${CR_PREFIX}:cfg_admin_next:${adminId}`)
                .setLabel("Berikutnya ▶")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage >= totalPages - 1),
        );
    }
    navRow.addComponents(
        new ButtonBuilder()
            .setCustomId(`${CR_PREFIX}:cfg_back:${adminId}`)
            .setLabel("Kembali ke Pengaturan")
            .setEmoji("↩️")
            .setStyle(ButtonStyle.Primary),
    );
    components.push(navRow);

    return {
        embeds: [embed],
        components,
        files: [],
    };
}

// ============================================================================
// Modal Builders
// ============================================================================

function createRoleCreationModal(userId) {
    return new ModalBuilder()
        .setCustomId(`${CR_PREFIX}:modal_create:${userId}`)
        .setTitle("Buat Custom Role Baru")
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("role_name")
                    .setLabel("Nama Custom Role (1-100 karakter)")
                    .setPlaceholder("Contoh: Aesthetic Vibes")
                    .setMinLength(1)
                    .setMaxLength(100)
                    .setRequired(true)
                    .setStyle(TextInputStyle.Short),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("role_hex")
                    .setLabel("Kode Warna HEX Awal (Opsional)")
                    .setPlaceholder("#00E5FF atau #5865F2")
                    .setMinLength(4)
                    .setMaxLength(7)
                    .setRequired(false)
                    .setValue("#00E5FF")
                    .setStyle(TextInputStyle.Short),
            ),
        );
}

function createRenameModal(userId, roleId, currentName = "", isAdminOverride = false) {
    const input = new TextInputBuilder()
        .setCustomId("role_name")
        .setLabel("Nama Baru Custom Role (1-100 karakter)")
        .setPlaceholder("Masukkan nama role baru...")
        .setMinLength(1)
        .setMaxLength(100)
        .setRequired(true)
        .setStyle(TextInputStyle.Short);

    if (currentName) {
        input.setValue(String(currentName).slice(0, 100));
    }

    const modalPrefix = isAdminOverride ? "modal_cfg_admin_rename" : "modal_rename";
    return new ModalBuilder()
        .setCustomId(`${CR_PREFIX}:${modalPrefix}:${userId}:${roleId}`)
        .setTitle("Ubah Nama Custom Role")
        .addComponents(new ActionRowBuilder().addComponents(input));
}

function createHexInputModal(userId, roleId, currentHex = "#00E5FF", isAdminOverride = false) {
    const modalPrefix = isAdminOverride ? "modal_cfg_admin_color" : "modal_hex";
    return new ModalBuilder()
        .setCustomId(`${CR_PREFIX}:${modalPrefix}:${userId}:${roleId}`)
        .setTitle("Input Kode Warna HEX")
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("hex_value")
                    .setLabel("Kode Warna HEX (#RRGGBB)")
                    .setPlaceholder("Contoh: #5865F2, #00FFFF, #FF00FF, #00FF88")
                    .setMinLength(4)
                    .setMaxLength(7)
                    .setValue(currentHex)
                    .setRequired(true)
                    .setStyle(TextInputStyle.Short),
            ),
        );
}

function createMaxRolesModal(adminUserId, currentMax = 1) {
    return new ModalBuilder()
        .setCustomId(`${CR_PREFIX}:modal_cfg_max:${adminUserId}`)
        .setTitle("Batas Jumlah Custom Role per Member")
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("max_roles")
                    .setLabel("Batas Maksimal Role per Member (1 - 25)")
                    .setPlaceholder("Default: 1")
                    .setMinLength(1)
                    .setMaxLength(2)
                    .setValue(String(currentMax || 1))
                    .setRequired(true)
                    .setStyle(TextInputStyle.Short),
            ),
        );
}

function createCustomGradientModal(userId, colors = ["#00E5FF", "#5865F2"]) {
    const c1 = colors[0] || "#00E5FF";
    const c2 = colors[1] || "#5865F2";
    const c3 = colors[2] || "";

    const thirdInput = new TextInputBuilder()
        .setCustomId("grad_hex_3")
        .setLabel("Warna HEX ke-3 (Opsional untuk 3 Warna)")
        .setPlaceholder("Kosongkan jika 2 warna, atau contoh: #FF00FF")
        .setMinLength(4)
        .setMaxLength(7)
        .setRequired(false)
        .setStyle(TextInputStyle.Short);

    if (c3) thirdInput.setValue(c3);

    return new ModalBuilder()
        .setCustomId(`${CR_PREFIX}:modal_gradient:${userId}`)
        .setTitle("Kustomisasi Warna Gradasi")
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("grad_hex_1")
                    .setLabel("Warna HEX ke-1 (Utama)")
                    .setPlaceholder("#00E5FF")
                    .setMinLength(4)
                    .setMaxLength(7)
                    .setValue(c1)
                    .setRequired(true)
                    .setStyle(TextInputStyle.Short),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("grad_hex_2")
                    .setLabel("Warna HEX ke-2")
                    .setPlaceholder("#5865F2")
                    .setMinLength(4)
                    .setMaxLength(7)
                    .setValue(c2)
                    .setRequired(true)
                    .setStyle(TextInputStyle.Short),
            ),
            new ActionRowBuilder().addComponents(thirdInput),
        );
}

function createImageUploadModal(userId, hasRoleIcons) {
    const fileUpload = new FileUploadBuilder().setCustomId("role_icon_file").setMinValues(1).setMaxValues(1).setRequired(true);

    const label = new LabelBuilder()
        .setLabel("Pilih Gambar dari Galeri HP")
        .setDescription(
            hasRoleIcons
                ? "Format PNG, JPG, JPEG, WEBP (Maksimal 256 KB untuk Role Icon Discord)"
                : "Format PNG, JPG, JPEG, WEBP (Maksimal 2 MB untuk Preview Custom Role)",
        )
        .setFileUploadComponent(fileUpload);

    return new ModalBuilder()
        .setCustomId(`${CR_PREFIX}:modal_image:${userId}`)
        .setTitle("Unggah Gambar Custom Role")
        .addLabelComponents(label);
}

function createDraftNameModal(userId, currentName = "", finalizeImmediately = false) {
    const input = new TextInputBuilder()
        .setCustomId("role_name")
        .setLabel("Nama Custom Role (1-100 karakter)")
        .setPlaceholder("Contoh: Aesthetic Vibes")
        .setMinLength(1)
        .setMaxLength(100)
        .setRequired(true)
        .setStyle(TextInputStyle.Short);

    if (currentName) {
        input.setValue(String(currentName).slice(0, 100));
    }

    const modalAction = finalizeImmediately ? "modal_create_finalize" : "modal_create_name";
    return new ModalBuilder()
        .setCustomId(`${CR_PREFIX}:${modalAction}:${userId}`)
        .setTitle(finalizeImmediately ? "Masukkan Nama & Buat Role" : "Atur Nama Custom Role")
        .addComponents(new ActionRowBuilder().addComponents(input));
}

function createDraftHexModal(userId, currentHex = "#00E5FF") {
    return new ModalBuilder()
        .setCustomId(`${CR_PREFIX}:modal_create_hex:${userId}`)
        .setTitle("Atur Warna HEX Role Baru")
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("hex_value")
                    .setLabel("Kode Warna HEX (#RRGGBB)")
                    .setPlaceholder("Contoh: #00E5FF, #5865F2, #FF00FF")
                    .setMinLength(4)
                    .setMaxLength(7)
                    .setValue(String(currentHex || "#00E5FF"))
                    .setRequired(true)
                    .setStyle(TextInputStyle.Short),
            ),
        );
}

function createDraftGradientModal(userId, colors = ["#00E5FF", "#5865F2"]) {
    const c1 = colors[0] || "#00E5FF";
    const c2 = colors[1] || "#5865F2";

    return new ModalBuilder()
        .setCustomId(`${CR_PREFIX}:modal_create_grad:${userId}`)
        .setTitle("Atur Gradasi Role Baru")
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("grad_hex_1")
                    .setLabel("Warna HEX ke-1 (Utama)")
                    .setPlaceholder("#00E5FF")
                    .setMinLength(4)
                    .setMaxLength(7)
                    .setValue(c1)
                    .setRequired(true)
                    .setStyle(TextInputStyle.Short),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("grad_hex_2")
                    .setLabel("Warna HEX ke-2")
                    .setPlaceholder("#5865F2")
                    .setMinLength(4)
                    .setMaxLength(7)
                    .setValue(c2)
                    .setRequired(true)
                    .setStyle(TextInputStyle.Short),
            ),
        );
}

function createDraftIconModal(userId) {
    const fileUpload = new FileUploadBuilder().setCustomId("role_icon_file").setMinValues(1).setMaxValues(1).setRequired(true);

    const label = new LabelBuilder()
        .setLabel("Pilih Ikon Role (Attachment Discord)")
        .setDescription("Format PNG, JPG, JPEG, WEBP (Maksimal 256 KB untuk Role Icon Discord)")
        .setFileUploadComponent(fileUpload);

    return new ModalBuilder()
        .setCustomId(`${CR_PREFIX}:modal_create_icon:${userId}`)
        .setTitle("Unggah Ikon Custom Role Baru")
        .addLabelComponents(label);
}

async function executeRoleCreationFromDraft(client, guild, interaction, config, canManage, overrideRoleName = null) {
    const userId = String(interaction.user.id);
    const draft = getOrInitDraft(client, guild.id, userId);
    const cDraft = draft.createDraft;
    const capabilities = detectGuildCustomRoleCapabilities(guild);

    const roleCtx = await resolveUserRoleContext(client, guild, userId);
    const maxAllowed = config.maxRolesPerMember || 1;

    if (roleCtx.activePairs.length >= maxAllowed) {
        const panel = await buildCustomRoleDashboard(client, guild, interaction.user, {
            config,
            roleCtx,
            canManageConfig: canManage,
            noticeType: "warning",
            noticeMessage: `⚠️ Kamu sudah mencapai batas maksimal Custom Role di server ini (**${roleCtx.activePairs.length}/${maxAllowed}** Custom Role).`,
        });
        await safeEditReply(interaction, panel);
        return true;
    }

    const botCheck = await validateBotRoleManagement(guild);
    if (!botCheck.valid) {
        const panel = await buildCreateRoleStudioPanel(client, guild, interaction.user, {
            config,
            roleCtx,
            noticeType: "error",
            noticeMessage: `❌ **Gagal Membuat Role:**\n${botCheck.message}`,
        });
        await safeEditReply(interaction, panel);
        return true;
    }

    const candidateName = overrideRoleName !== null ? overrideRoleName : cDraft.roleName;
    const nameCheck = validateCustomRoleName(guild, candidateName);
    if (!nameCheck.valid) {
        const panel = await buildCreateRoleStudioPanel(client, guild, interaction.user, {
            config,
            roleCtx,
            noticeType: "error",
            noticeMessage: `❌ **Nama Role Tidak Valid:**\n${nameCheck.message}`,
        });
        await safeEditReply(interaction, panel);
        return true;
    }

    const colorCheck = parseAndValidateHexColor(cDraft.colorHex || "#00E5FF");
    if (!colorCheck.valid) {
        const panel = await buildCreateRoleStudioPanel(client, guild, interaction.user, {
            config,
            roleCtx,
            noticeType: "error",
            noticeMessage: `❌ **Kode Warna Tidak Valid:**\n${colorCheck.message}`,
        });
        await safeEditReply(interaction, panel);
        return true;
    }

    // Clean up orphan records whose Discord role was manually deleted outside the bot
    for (const orphan of roleCtx.orphanPairs) {
        await deleteCustomRoleRecord(client, guild.id, userId, orphan.record.roleId).catch(() => {});
    }

    const useGradient = Boolean(capabilities.hasEnhancedRoleColors && cDraft.gradient?.enabled && cDraft.gradient.colors?.length >= 2);
    const useIcon = Boolean(capabilities.hasRoleIcons && cDraft.pendingImage?.buffer);

    let createColors = {
        primaryColor: colorCheck.discordInt,
        secondaryColor: null,
        tertiaryColor: null,
    };
    let savedColorHex = colorCheck.hex;
    let savedGradient = {
        enabled: false,
        mode: "two_color",
        colors: [],
        direction: "horizontal",
        appliedMode: "none",
    };

    if (useGradient) {
        if (cDraft.gradient.mode === "holographic") {
            const holo = Constants?.HolographicStyle || {
                Primary: 11127295,
                Secondary: 16759788,
                tertiary: 16761760,
            };
            createColors = {
                primaryColor: holo.Primary,
                secondaryColor: holo.Secondary,
                tertiaryColor: holo.Tertiary ?? holo.tertiary ?? 16761760,
            };
            savedColorHex = cDraft.gradient.colors[0] || "#A9C9FF";
            savedGradient = {
                enabled: true,
                mode: "holographic",
                colors: [...cDraft.gradient.colors],
                direction: cDraft.gradient.direction || "horizontal",
                appliedMode: "holographic",
            };
        } else {
            const g1 = parseAndValidateHexColor(cDraft.gradient.colors[0]);
            const g2 = parseAndValidateHexColor(cDraft.gradient.colors[1] || cDraft.gradient.colors[0]);
            if (g1.valid && g2.valid) {
                createColors = {
                    primaryColor: g1.discordInt,
                    secondaryColor: g2.discordInt,
                    tertiaryColor: null,
                };
                savedColorHex = g1.hex;
                savedGradient = {
                    enabled: true,
                    mode: "two_color",
                    colors: [g1.hex, g2.hex],
                    direction: cDraft.gradient.direction || "horizontal",
                    appliedMode: "gradient_2",
                };
            }
        }
    }

    let createdRole;
    let iconApplied = false;
    try {
        const createOptions = {
            name: nameCheck.name,
            colors: createColors,
            permissions: [],
            mentionable: false,
            reason: `Lagukan Custom Role dibuat oleh ${interaction.user.username} (${userId})`,
        };

        if (useIcon) {
            createOptions.icon = cDraft.pendingImage.buffer;
        }

        createdRole = await guild.roles.create(createOptions);
        iconApplied = Boolean(useIcon);
    } catch (discordErr) {
        // Fallback without gradient/icon if Discord API rejected optional style while keeping basic creation resilient
        if (useGradient || useIcon) {
            try {
                createdRole = await guild.roles.create({
                    name: nameCheck.name,
                    colors: {
                        primaryColor: colorCheck.discordInt,
                        secondaryColor: null,
                        tertiaryColor: null,
                    },
                    permissions: [],
                    mentionable: false,
                    reason: `Lagukan Custom Role dibuat oleh ${interaction.user.username} (${userId})`,
                });
                savedColorHex = colorCheck.hex;
                savedGradient = {
                    enabled: false,
                    mode: "two_color",
                    colors: [],
                    direction: "horizontal",
                    appliedMode: "none",
                };
                iconApplied = false;
            } catch (fallbackErr) {
                Logger.error("[CustomRole] Gagal membuat role Discord:", fallbackErr);
                const panel = await buildCreateRoleStudioPanel(client, guild, interaction.user, {
                    config,
                    noticeType: "error",
                    noticeMessage:
                        "❌ **Gagal Membuat Role di Discord:** Pastikan bot memiliki izin `Manage Roles`, hierarchy role memadai, dan jumlah role server belum mencapai batas maksimal Discord (250 role).",
                });
                await safeEditReply(interaction, panel);
                return true;
            }
        } else {
            Logger.error("[CustomRole] Gagal membuat role Discord:", discordErr);
            const panel = await buildCreateRoleStudioPanel(client, guild, interaction.user, {
                config,
                noticeType: "error",
                noticeMessage:
                    "❌ **Gagal Membuat Role di Discord:** Pastikan bot memiliki izin `Manage Roles`, hierarchy role memadai, dan jumlah role server belum mencapai batas maksimal Discord (250 role).",
            });
            await safeEditReply(interaction, panel);
            return true;
        }
    }

    const member = await resolveGuildMember(guild, userId, interaction.member);
    if (member?.roles?.add) {
        await member.roles.add(createdRole.id, "Lagukan Custom Role: Pemberian role otomatis kepada pembuat").catch((err) => {
            Logger.warn(`[CustomRole] Gagal memasang role ${createdRole.id} ke member ${userId}: ${err.message}`);
        });
    }

    try {
        await saveUserCustomRoleRecord(client, {
            guildId: guild.id,
            userId,
            roleId: createdRole.id,
            roleName: createdRole.name,
            color: savedColorHex,
            gradient: savedGradient,
            imageUrl: iconApplied && cDraft.pendingImage?.meta?.url ? cDraft.pendingImage.meta.url : null,
            imageMeta:
                iconApplied && cDraft.pendingImage?.meta
                    ? {
                          fileName: cDraft.pendingImage.meta.fileName,
                          contentType: cDraft.pendingImage.meta.contentType,
                          size: cDraft.pendingImage.meta.size,
                          width: cDraft.pendingImage.meta.width,
                          height: cDraft.pendingImage.meta.height,
                          appliedToDiscord: true,
                      }
                    : {},
        });
    } catch (dbErr) {
        await createdRole.delete("Rollback karena penyimpanan MongoDB gagal").catch(() => {});
        const panel = await buildCreateRoleStudioPanel(client, guild, interaction.user, {
            config,
            noticeType: "error",
            noticeMessage: `❌ **Gagal Menyimpan ke MongoDB:** \`${escapeInline(dbErr?.message || "Kesalahan database")}\``,
        });
        await safeEditReply(interaction, panel);
        return true;
    }

    draft.selectedRoleId = String(createdRole.id);
    resetCreateDraft(client, guild.id, userId);
    clearEditDraftFields(client, guild.id, userId);

    const panel = await buildCustomRoleDashboard(client, guild, interaction.user, {
        config,
        canManageConfig: canManage,
        noticeType: "success",
        noticeMessage: `🎉 **Custom Role Berhasil Dibuat!** Role <@&${createdRole.id}> telah dibuat, dipasang ke akun Anda, dan disimpan ke MongoDB.`,
    });
    await safeEditReply(interaction, panel);
    return true;
}

// ============================================================================
// Admin Configuration Interaction Handler (`cfg_*` and `modal_cfg_*`)
// ============================================================================

async function handleAdminConfigInteraction(client, guild, interaction, action, extraRoleId) {
    const adminId = String(interaction.user.id);

    if (!canManageCustomRoleConfig(interaction, guild)) {
        const deniedEmbed = buildAdminConfigDeniedEmbed(client);
        await safeReply(interaction, { embeds: [deniedEmbed], flags: MessageFlags.Ephemeral });
        return true;
    }

    // Actions that open Modals BEFORE deferring
    if (action === "cfg_max_modal") {
        const config = await getGuildCustomRoleConfig(client, guild.id);
        await safeShowModal(interaction, createMaxRolesModal(adminId, config.maxRolesPerMember));
        return true;
    }

    if (action === "cfg_admin_rename" && extraRoleId) {
        const rec = await getGuildCustomRoleByRoleId(client, guild.id, extraRoleId);
        const liveRole = extraRoleId ? await resolveGuildRole(guild, extraRoleId) : null;
        await safeShowModal(interaction, createRenameModal(adminId, extraRoleId, liveRole?.name || rec?.roleName || "", true));
        return true;
    }

    if (action === "cfg_admin_color" && extraRoleId) {
        const rec = await getGuildCustomRoleByRoleId(client, guild.id, extraRoleId);
        await safeShowModal(interaction, createHexInputModal(adminId, extraRoleId, rec?.color || "#00E5FF", true));
        return true;
    }

    // Modal submits for Admin Config
    if (typeof interaction.isModalSubmit === "function" && interaction.isModalSubmit()) {
        const isFromMsg = typeof interaction.isFromMessage === "function" && interaction.isFromMessage();
        const acked = isFromMsg ? await safeDeferUpdate(interaction) : await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!acked) return true;

        return withCustomRoleLock(guild.id, `cfg_${adminId}`, async () => {
            if (action === "modal_cfg_max") {
                const rawVal = String(interaction.fields.getTextInputValue("max_roles") || "").trim();
                const parsed = Number.parseInt(rawVal, 10);

                if (!/^\d+$/.test(rawVal) || !Number.isFinite(parsed) || parsed < 1 || parsed > MAX_ROLES_PER_MEMBER_CAP) {
                    const panel = await buildCustomRoleConfigDashboard(client, guild, adminId, {
                        noticeType: "error",
                        noticeMessage: `❌ **Input Tidak Valid:** Masukkan angka bulat antara **1** hingga **${MAX_ROLES_PER_MEMBER_CAP}** untuk batas maksimal Custom Role per member.`,
                    });
                    await safeEditReply(interaction, panel);
                    return true;
                }

                try {
                    let saved = await saveGuildCustomRoleConfig(client, guild.id, {
                        maxRolesPerMember: parsed,
                        updatedBy: adminId,
                    });
                    if (saved.channelId) {
                        const syncRes = await syncCustomRolePanel(client, guild, {
                            forceResend: false,
                            recreateIfMissing: true,
                        });
                        if (syncRes.ok && syncRes.config) saved = syncRes.config;
                    }
                    const panel = await buildCustomRoleConfigDashboard(client, guild, adminId, {
                        config: saved,
                        noticeType: "success",
                        noticeMessage: `✅ **Batas Kepemilikan Diperbarui!** Setiap member yang memenuhi syarat kini dapat memiliki maksimal **${saved.maxRolesPerMember} Custom Role** di server ini.`,
                    });
                    await safeEditReply(interaction, panel);
                } catch (dbErr) {
                    const panel = await buildCustomRoleConfigDashboard(client, guild, adminId, {
                        noticeType: "error",
                        noticeMessage: `❌ **Gagal Menyimpan ke MongoDB:** \`${escapeInline(dbErr?.message)}\``,
                    });
                    await safeEditReply(interaction, panel);
                }
                return true;
            }

            if (action === "modal_cfg_admin_rename" && extraRoleId) {
                const rec = await getGuildCustomRoleByRoleId(client, guild.id, extraRoleId);
                const liveRole = await resolveGuildRole(guild, extraRoleId);
                if (!rec || !liveRole) {
                    const panel = await buildAdminMemberRolesPanel(
                        client,
                        guild,
                        adminId,
                        "⚠️ Role tidak lagi ditemukan pada server atau database.",
                        "error",
                    );
                    await safeEditReply(interaction, panel);
                    return true;
                }

                const botCheck = await validateBotRoleManagement(guild, liveRole);
                if (!botCheck.valid) {
                    const panel = await buildAdminMemberRolesPanel(client, guild, adminId, `❌ ${botCheck.message}`, "error");
                    await safeEditReply(interaction, panel);
                    return true;
                }

                const rawName = interaction.fields.getTextInputValue("role_name");
                const nameCheck = validateCustomRoleName(guild, rawName, liveRole.id);
                if (!nameCheck.valid) {
                    const panel = await buildAdminMemberRolesPanel(client, guild, adminId, `❌ ${nameCheck.message}`, "error");
                    await safeEditReply(interaction, panel);
                    return true;
                }

                await liveRole.setName(nameCheck.name, `Lagukan Admin Override oleh ${interaction.user.username}`);
                await saveUserCustomRoleRecord(client, {
                    ...rec,
                    roleName: nameCheck.name,
                });

                const panel = await buildAdminMemberRolesPanel(
                    client,
                    guild,
                    adminId,
                    `✅ Nama role <@&${liveRole.id}> milik <@${rec.userId}> berhasil diperbarui menjadi **${escapeMarkdown(nameCheck.name)}**.`,
                    "success",
                );
                await safeEditReply(interaction, panel);
                return true;
            }

            if (action === "modal_cfg_admin_color" && extraRoleId) {
                const rec = await getGuildCustomRoleByRoleId(client, guild.id, extraRoleId);
                const liveRole = await resolveGuildRole(guild, extraRoleId);
                if (!rec || !liveRole) {
                    const panel = await buildAdminMemberRolesPanel(
                        client,
                        guild,
                        adminId,
                        "⚠️ Role tidak lagi ditemukan pada server atau database.",
                        "error",
                    );
                    await safeEditReply(interaction, panel);
                    return true;
                }

                const botCheck = await validateBotRoleManagement(guild, liveRole);
                if (!botCheck.valid) {
                    const panel = await buildAdminMemberRolesPanel(client, guild, adminId, `❌ ${botCheck.message}`, "error");
                    await safeEditReply(interaction, panel);
                    return true;
                }

                const parsed = parseAndValidateHexColor(interaction.fields.getTextInputValue("hex_value"));
                if (!parsed.valid) {
                    const panel = await buildAdminMemberRolesPanel(client, guild, adminId, `❌ ${parsed.message}`, "error");
                    await safeEditReply(interaction, panel);
                    return true;
                }

                await liveRole.setColors(
                    { primaryColor: parsed.discordInt, secondaryColor: null, tertiaryColor: null },
                    `Lagukan Admin Override oleh ${interaction.user.username}`,
                );
                await saveUserCustomRoleRecord(client, {
                    ...rec,
                    color: parsed.hex,
                    gradient: { ...rec.gradient, enabled: false, appliedMode: "none" },
                });

                const panel = await buildAdminMemberRolesPanel(
                    client,
                    guild,
                    adminId,
                    `✅ Warna role <@&${liveRole.id}> milik <@${rec.userId}> berhasil diperbarui ke \`${parsed.hex}\`.`,
                    "success",
                );
                await safeEditReply(interaction, panel);
                return true;
            }

            return true;
        });
    }

    const acked = await safeDeferUpdate(interaction);
    if (!acked) return true;

    return withCustomRoleLock(guild.id, `cfg_${adminId}`, async () => {
        const currentConfig = await getGuildCustomRoleConfig(client, guild.id);
        const draft = getOrInitDraft(client, guild.id, adminId);

        try {
            if (action === "cfg_back") {
                const panel = await buildCustomRoleConfigDashboard(client, guild, adminId, { config: currentConfig });
                await safeEditReply(interaction, panel);
                return true;
            }

            if (action === "cfg_select_channel") {
                const pickedChannelId = interaction.values?.[0] ? String(interaction.values[0]) : null;
                if (!pickedChannelId) {
                    const panel = await buildCustomRoleConfigDashboard(client, guild, adminId, {
                        config: currentConfig,
                        noticeType: "error",
                        noticeMessage: "❌ **Channel Tidak Valid:** Silakan pilih satu channel teks untuk Panel Custom Role.",
                    });
                    await safeEditReply(interaction, panel);
                    return true;
                }

                const syncRes = await syncCustomRolePanel(client, guild, {
                    targetChannelId: pickedChannelId,
                    forceResend: false,
                    recreateIfMissing: true,
                    updatedBy: adminId,
                });

                if (!syncRes.ok) {
                    const panel = await buildCustomRoleConfigDashboard(client, guild, adminId, {
                        config: currentConfig,
                        noticeType: "error",
                        noticeMessage: `❌ **Gagal Mengirim Panel Custom Role:** ${syncRes.message}`,
                    });
                    await safeEditReply(interaction, panel);
                    return true;
                }

                const statusMsg =
                    syncRes.action === "moved"
                        ? `✅ **Channel Panel Dipindahkan!** Panel lama dihapus dan Panel Custom Role baru berhasil dikirim ke <#${syncRes.channelId}> (\`ID Pesan: ${syncRes.panelMessageId}\`).`
                        : syncRes.action === "updated"
                          ? `✅ **Panel Custom Role Diperbarui!** Panel yang sudah ada di <#${syncRes.channelId}> diperbarui tanpa pesan duplikat.`
                          : `✅ **Panel Custom Role Berhasil Dikirim!** Panel otomatis telah terpasang di <#${syncRes.channelId}> (\`ID Pesan: ${syncRes.panelMessageId}\`).`;

                const panel = await buildCustomRoleConfigDashboard(client, guild, adminId, {
                    config: syncRes.config,
                    noticeType: "success",
                    noticeMessage: statusMsg,
                });
                await safeEditReply(interaction, panel);
                return true;
            }

            if (action === "cfg_refresh_panel" || action === "cfg_resend_panel") {
                const isResend = action === "cfg_resend_panel";
                const syncRes = await syncCustomRolePanel(client, guild, {
                    forceResend: isResend,
                    recreateIfMissing: true,
                    updatedBy: adminId,
                });

                if (!syncRes.ok) {
                    const panel = await buildCustomRoleConfigDashboard(client, guild, adminId, {
                        config: currentConfig,
                        noticeType: "error",
                        noticeMessage: `❌ **Gagal Memproses Panel:** ${syncRes.message}`,
                    });
                    await safeEditReply(interaction, panel);
                    return true;
                }

                let noticeText;
                if (syncRes.action === "resent") {
                    noticeText = `📨 **Panel Berhasil Dikirim Ulang!** Panel lama telah digantikan dengan pesan panel baru di <#${syncRes.channelId}> (\`ID: ${syncRes.panelMessageId}\`).`;
                } else if (syncRes.action === "recreated") {
                    noticeText = `🔄 **Panel Berhasil Dibuat Ulang!** Pesan panel sebelumnya yang terhapus telah diganti otomatis di <#${syncRes.channelId}> (\`ID: ${syncRes.panelMessageId}\`).`;
                } else {
                    noticeText = `🔄 **Panel Berhasil Diperbarui!** Tampilan panel di <#${syncRes.channelId}> telah disinkronkan tanpa mengirim pesan duplikat.`;
                }

                const panel = await buildCustomRoleConfigDashboard(client, guild, adminId, {
                    config: syncRes.config,
                    noticeType: "success",
                    noticeMessage: noticeText,
                });
                await safeEditReply(interaction, panel);
                return true;
            }

            if (action === "cfg_toggle_enabled") {
                const nextVal = !currentConfig.customRoleEnabled;
                let saved = await saveGuildCustomRoleConfig(client, guild.id, {
                    customRoleEnabled: nextVal,
                    updatedBy: adminId,
                });
                if (saved.channelId) {
                    const syncRes = await syncCustomRolePanel(client, guild, { forceResend: false, recreateIfMissing: true });
                    if (syncRes.ok && syncRes.config) saved = syncRes.config;
                }
                const panel = await buildCustomRoleConfigDashboard(client, guild, adminId, {
                    config: saved,
                    noticeType: nextVal ? "success" : "warning",
                    noticeMessage: nextVal
                        ? "🟢 **Fitur Custom Role berhasil DIAKTIFKAN** di server ini!"
                        : "🔴 **Fitur Custom Role berhasil DINONAKTIFKAN** untuk member di server ini.",
                });
                await safeEditReply(interaction, panel);
                return true;
            }

            if (action === "cfg_toggle_booster") {
                const nextVal = !currentConfig.boosterAccessEnabled;
                let saved = await saveGuildCustomRoleConfig(client, guild.id, {
                    boosterAccessEnabled: nextVal,
                    updatedBy: adminId,
                });
                if (saved.channelId) {
                    const syncRes = await syncCustomRolePanel(client, guild, { forceResend: false, recreateIfMissing: true });
                    if (syncRes.ok && syncRes.config) saved = syncRes.config;
                }
                const panel = await buildCustomRoleConfigDashboard(client, guild, adminId, {
                    config: saved,
                    noticeType: "success",
                    noticeMessage: nextVal
                        ? "💎 **Akses Server Booster DIAKTIFKAN!** Member yang mem-boost server ini dapat membuat dan mengelola Custom Role."
                        : "🔒 **Akses Server Booster DINONAKTIFKAN.** Hanya member dengan Role Khusus yang ditentukan admin yang memiliki akses.",
                });
                await safeEditReply(interaction, panel);
                return true;
            }

            if (action === "cfg_toggle_role") {
                const nextVal = !currentConfig.roleAccessEnabled;
                let saved = await saveGuildCustomRoleConfig(client, guild.id, {
                    roleAccessEnabled: nextVal,
                    updatedBy: adminId,
                });
                if (saved.channelId) {
                    const syncRes = await syncCustomRolePanel(client, guild, { forceResend: false, recreateIfMissing: true });
                    if (syncRes.ok && syncRes.config) saved = syncRes.config;
                }
                const panel = await buildCustomRoleConfigDashboard(client, guild, adminId, {
                    config: saved,
                    noticeType: nextVal
                        ? "🎭 **Akses Role Khusus DIAKTIFKAN!** Member yang memiliki salah satu role pada daftar izin dapat menggunakan Custom Role."
                        : "🔒 **Akses Role Khusus DINONAKTIFKAN.**",
                });
                await safeEditReply(interaction, panel);
                return true;
            }

            if (action === "cfg_add_roles") {
                const rawPicked = Array.isArray(interaction.values) ? interaction.values.map(String) : [];
                let rejectedEveryone = false;
                let rejectedBotRole = false;
                const validPicked = [];

                for (const rId of rawPicked) {
                    if (rId === String(guild.id)) {
                        rejectedEveryone = true;
                        continue;
                    }
                    const roleObj = guild.roles?.cache?.get?.(rId);
                    if (roleObj?.tags?.botId) {
                        rejectedBotRole = true;
                        continue;
                    }
                    validPicked.push(rId);
                }

                if (validPicked.length === 0) {
                    const reasonParts = [];
                    if (rejectedEveryone) {
                        reasonParts.push(
                            "Role `@everyone` tidak diizinkan karena fitur Custom Role tidak boleh dibuka secara bebas untuk seluruh member.",
                        );
                    }
                    if (rejectedBotRole) {
                        reasonParts.push("Role khusus milik aplikasi/bot tidak dapat dipilih sebagai role akses member.");
                    }
                    const panel = await buildCustomRoleConfigDashboard(client, guild, adminId, {
                        config: currentConfig,
                        noticeType: "error",
                        noticeMessage: `❌ **Role Ditolak:** ${reasonParts.join(" ") || "Pilih minimal satu role valid."}`,
                    });
                    await safeEditReply(interaction, panel);
                    return true;
                }

                const mergedRoles = [...new Set([...currentConfig.allowedRoles, ...validPicked])].slice(0, MAX_ALLOWED_ROLES_PER_GUILD);

                let saved = await saveGuildCustomRoleConfig(client, guild.id, {
                    allowedRoles: mergedRoles,
                    roleAccessEnabled: true,
                    updatedBy: adminId,
                });

                if (saved.channelId) {
                    const syncRes = await syncCustomRolePanel(client, guild, { forceResend: false, recreateIfMissing: true });
                    if (syncRes.ok && syncRes.config) saved = syncRes.config;
                }

                const addedMentions = validPicked.map((id) => `<@&${id}>`).join(", ");
                const warnNotes = [];
                if (rejectedEveryone) warnNotes.push("*(Role `@everyone` diabaikan)*");
                if (rejectedBotRole) warnNotes.push("*(Role bot diabaikan)*");

                const panel = await buildCustomRoleConfigDashboard(client, guild, adminId, {
                    config: saved,
                    noticeType: "success",
                    noticeMessage: `✅ **Daftar Role Izin Diperbarui!** Ditambahkan: ${addedMentions} ${warnNotes.join(" ")}`.trim(),
                });
                await safeEditReply(interaction, panel);
                return true;
            }

            if (action === "cfg_remove_roles") {
                const toRemove = new Set((interaction.values || []).map(String));
                const remaining = currentConfig.allowedRoles.filter((id) => !toRemove.has(String(id)));
                let saved = await saveGuildCustomRoleConfig(client, guild.id, {
                    allowedRoles: remaining,
                    updatedBy: adminId,
                });
                if (saved.channelId) {
                    const syncRes = await syncCustomRolePanel(client, guild, { forceResend: false, recreateIfMissing: true });
                    if (syncRes.ok && syncRes.config) saved = syncRes.config;
                }
                const removedText = [...toRemove].map((id) => `<@&${id}>`).join(", ");
                const panel = await buildCustomRoleConfigDashboard(client, guild, adminId, {
                    config: saved,
                    noticeType: "success",
                    noticeMessage: `🗑️ **Role Dihapus dari Daftar Izin:** ${removedText}`,
                });
                await safeEditReply(interaction, panel);
                return true;
            }

            if (action === "cfg_clear_roles") {
                let saved = await saveGuildCustomRoleConfig(client, guild.id, {
                    allowedRoles: [],
                    updatedBy: adminId,
                });
                if (saved.channelId) {
                    const syncRes = await syncCustomRolePanel(client, guild, { forceResend: false, recreateIfMissing: true });
                    if (syncRes.ok && syncRes.config) saved = syncRes.config;
                }
                const panel = await buildCustomRoleConfigDashboard(client, guild, adminId, {
                    config: saved,
                    noticeType: "success",
                    noticeMessage: "🧹 **Seluruh Role Khusus telah dihapus dari daftar izin server ini.**",
                });
                await safeEditReply(interaction, panel);
                return true;
            }

            if (action === "cfg_view_roles") {
                const viewPanel = await buildAllowedRolesListView(client, guild, adminId);
                await safeEditReply(interaction, viewPanel);
                return true;
            }

            if (
                action === "cfg_member_roles" ||
                action === "cfg_admin_pick" ||
                action === "cfg_admin_prev" ||
                action === "cfg_admin_next"
            ) {
                if (action === "cfg_admin_pick") {
                    draft.adminSelectedRoleId = interaction.values?.[0] || null;
                } else if (action === "cfg_admin_prev") {
                    draft.adminPage = Math.max(0, (draft.adminPage || 0) - 1);
                } else if (action === "cfg_admin_next") {
                    draft.adminPage = (draft.adminPage || 0) + 1;
                }

                const panel = await buildAdminMemberRolesPanel(client, guild, adminId);
                await safeEditReply(interaction, panel);
                return true;
            }

            if (action === "cfg_admin_delete" && extraRoleId) {
                const rec = await getGuildCustomRoleByRoleId(client, guild.id, extraRoleId);
                if (!rec) {
                    const panel = await buildAdminMemberRolesPanel(client, guild, adminId, "ℹ️ Role tersebut sudah terhapus.");
                    await safeEditReply(interaction, panel);
                    return true;
                }

                const liveRole = await resolveGuildRole(guild, rec.roleId);
                if (liveRole) {
                    const botCheck = await validateBotRoleManagement(guild, liveRole);
                    if (!botCheck.valid) {
                        const panel = await buildAdminMemberRolesPanel(client, guild, adminId, `❌ ${botCheck.message}`, "error");
                        await safeEditReply(interaction, panel);
                        return true;
                    }
                    await liveRole.delete(`Dihapus oleh Admin ${interaction.user.username} melalui /customrole-config`).catch(() => {});
                }

                await deleteCustomRoleRecord(client, guild.id, rec.userId, rec.roleId);
                draft.adminSelectedRoleId = null;

                const panel = await buildAdminMemberRolesPanel(
                    client,
                    guild,
                    adminId,
                    `🗑️ Custom Role **${escapeMarkdown(rec.roleName)}** milik <@${rec.userId}> berhasil dihapus dari Discord & MongoDB.`,
                    "success",
                );
                await safeEditReply(interaction, panel);
                return true;
            }
        } catch (err) {
            const panel = await buildCustomRoleConfigDashboard(client, guild, adminId, {
                noticeType: "error",
                noticeMessage: `❌ **Terjadi Kesalahan Penyimpanan:** \`${escapeInline(err?.message || "Database error")}\``,
            });
            await safeEditReply(interaction, panel);
        }

        return true;
    });
}

// ============================================================================
// Component & Modal Interaction Router
// ============================================================================

async function requireActiveUserRoleOrWarn(client, guild, interaction, config, canManage) {
    const userId = String(interaction.user.id);
    const roleCtx = await resolveUserRoleContext(client, guild, userId);

    if (!roleCtx.selectedRecord || !roleCtx.selectedLiveRole) {
        const panel = await buildCustomRoleDashboard(client, guild, interaction.user, {
            config,
            roleCtx,
            canManageConfig: canManage,
            noticeType: "warning",
            noticeMessage:
                "⚠️ **Anda belum memiliki Custom Role aktif di server ini.** Silakan pilih menu **➕ Buat Role** terlebih dahulu!",
        });
        await safeEditReply(interaction, panel);
        return null;
    }

    // Strict ownership enforcement: member can ONLY manage their own role
    if (String(roleCtx.selectedRecord.userId) !== userId) {
        return null;
    }

    return {
        roleCtx,
        record: roleCtx.selectedRecord,
        liveRole: roleCtx.selectedLiveRole,
    };
}

async function handleCustomRoleInteraction(client, interaction) {
    const customId = String(interaction?.customId || "");
    if (!customId.startsWith(`${CR_PREFIX}:`)) return false;

    const parts = customId.split(":");
    const action = parts[1];
    const ownerUserId = parts[2];
    const extraTargetRoleId = parts[3] || null;

    const guild = interaction.guild || client.guilds.cache.get(interaction.guildId);
    const botAvatar = getBotAvatarUrl(client);

    if (!guild) {
        await safeReply(interaction, {
            content: "⚠️ Data server ini belum siap. Silakan coba beberapa saat lagi.",
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    if (ownerUserId && String(interaction.user.id) !== String(ownerUserId)) {
        const notOwnerEmbed = new EmbedBuilder()
            .setColor(CR_COLORS.ERROR)
            .setTitle("🔒 AKSES DITOLAK — BUKAN MILIKMU")
            .setDescription(
                "Setiap member hanya boleh mengelola Custom Role miliknya sendiri. Silakan gunakan tombol pada **Panel Custom Role** untuk membuka sesi pribadimu.",
            )
            .setFooter({ text: CR_FOOTER, iconURL: botAvatar })
            .setTimestamp();

        await safeReply(interaction, { embeds: [notOwnerEmbed], flags: MessageFlags.Ephemeral });
        return true;
    }

    // Route `/customrole-config` Admin actions (`cfg_*` & `modal_cfg_*`)
    if (action.startsWith("cfg_") || action.startsWith("modal_cfg_")) {
        return handleAdminConfigInteraction(client, guild, interaction, action, extraTargetRoleId);
    }

    // Re-verify server access eligibility on EVERY member action (handles instant revocation if Booster/Role lost!)
    const access = await checkCustomRoleAccess(client, guild, interaction);
    if (!access.allowed) {
        stopActiveImageCollector(guild.id, String(interaction.user.id), "access_revoked");
        clearDraft(client, guild.id, String(interaction.user.id));

        const deniedEmbed = buildCustomRoleAccessDeniedEmbed(client, access.code, access.config);
        await safeReply(interaction, { embeds: [deniedEmbed], flags: MessageFlags.Ephemeral });
        return true;
    }

    const userId = String(interaction.user.id);
    const canManage = canManageCustomRoleConfig(interaction, guild);
    const config = access.config;

    // ------------------------------------------------------------------------
    // 0. Permanent Public Panel Buttons (`panel_create`, `panel_manage`, `panel_delete`)
    //    ALWAYS deferReply Ephemeral so the public panel in the channel is NEVER overwritten!
    // ------------------------------------------------------------------------
    if (action === "panel_create" || action === "panel_manage" || action === "panel_delete") {
        const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return true;

        return withCustomRoleLock(guild.id, userId, async () => {
            let roleCtx = await resolveUserRoleContext(client, guild, userId);

            // Proactively clean orphan DB records whose Discord role was deleted manually outside the bot
            if (roleCtx.orphanPairs.length > 0 && action !== "panel_delete") {
                for (const orphan of roleCtx.orphanPairs) {
                    await deleteCustomRoleRecord(client, guild.id, userId, orphan.record.roleId).catch(() => {});
                }
                roleCtx = await resolveUserRoleContext(client, guild, userId);
            }

            if (action === "panel_create") {
                const maxAllowed = config.maxRolesPerMember || 1;
                if (roleCtx.activePairs.length >= maxAllowed) {
                    const quotaEmbed = new EmbedBuilder()
                        .setColor(CR_COLORS.WARNING)
                        .setTitle("⚠️ BATAS CUSTOM ROLE TERCAPAI")
                        .setDescription(
                            [
                                `Kamu sudah memiliki **${roleCtx.activePairs.length}/${maxAllowed}** Custom Role aktif sesuai batas server **${escapeMarkdown(guild.name)}**.`,
                                "",
                                "Tekan tombol **Kelola Custom Role Milikku** di bawah atau tombol **`MANAGE ROLE`** pada panel untuk mengubah nama, warna, gradasi, atau ikon role milikmu.",
                            ].join("\n"),
                        )
                        .setFooter({ text: CR_FOOTER, iconURL: botAvatar })
                        .setTimestamp();

                    const manageRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`${CR_PREFIX}:cancel:${userId}`)
                            .setLabel("Kelola Custom Role Milikku")
                            .setEmoji("🎛️")
                            .setStyle(ButtonStyle.Primary),
                    );

                    await safeEditReply(interaction, { embeds: [quotaEmbed], components: [manageRow], files: [] });
                    return true;
                }

                const createStudio = await buildCreateRoleStudioPanel(client, guild, interaction.user, {
                    config,
                    roleCtx,
                });
                await safeEditReply(interaction, createStudio);
                return true;
            }

            if (action === "panel_manage") {
                if (roleCtx.activePairs.length === 0) {
                    const emptyEmbed = new EmbedBuilder()
                        .setColor(CR_COLORS.WARNING)
                        .setTitle("ℹ️ BELUM MEMILIKI CUSTOM ROLE")
                        .setDescription(
                            [
                                `Kamu belum memiliki **Custom Role** aktif di server **${escapeMarkdown(guild.name)}**.`,
                                "",
                                "Tekan tombol **Buat Custom Role Sekarang** di bawah atau tombol **`CREATE ROLE`** pada panel untuk membuat role pribadimu!",
                            ].join("\n"),
                        )
                        .setFooter({ text: CR_FOOTER, iconURL: botAvatar })
                        .setTimestamp();

                    const createRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`${CR_PREFIX}:open_create_studio:${userId}`)
                            .setLabel("Buat Custom Role Sekarang")
                            .setEmoji("➕")
                            .setStyle(ButtonStyle.Success),
                    );

                    await safeEditReply(interaction, { embeds: [emptyEmbed], components: [createRow], files: [] });
                    return true;
                }

                const manageDashboard = await buildCustomRoleDashboard(client, guild, interaction.user, {
                    config,
                    roleCtx,
                    canManageConfig: canManage,
                });
                await safeEditReply(interaction, manageDashboard);
                return true;
            }

            if (action === "panel_delete") {
                if (roleCtx.pairs.length === 0 || !roleCtx.selectedRecord) {
                    const noRoleEmbed = new EmbedBuilder()
                        .setColor(CR_COLORS.WARNING)
                        .setTitle("ℹ️ TIDAK ADA CUSTOM ROLE UNTUK DIHAPUS")
                        .setDescription(
                            `Kamu belum memiliki **Custom Role** terdaftar di server **${escapeMarkdown(guild.name)}**. Tekan tombol **\`CREATE ROLE\`** pada panel jika ingin membuat Custom Role baru.`,
                        )
                        .setFooter({ text: CR_FOOTER, iconURL: botAvatar })
                        .setTimestamp();

                    await safeEditReply(interaction, { embeds: [noRoleEmbed], components: [], files: [] });
                    return true;
                }

                const confirmPanel = buildDeleteConfirmPanel(
                    client,
                    userId,
                    roleCtx.selectedRecord,
                    roleCtx.selectedLiveRole,
                    roleCtx.pairs,
                );
                await safeEditReply(interaction, confirmPanel);
                return true;
            }

            return true;
        });
    }

    // ------------------------------------------------------------------------
    // 1. Actions that MUST open a Modal immediately (BEFORE deferUpdate!)
    // ------------------------------------------------------------------------
    const selectedMenuAction = action === "menu" ? interaction.values?.[0] : null;

    if (action === "create_name_modal") {
        const draft = getOrInitDraft(client, guild.id, userId);
        await safeShowModal(interaction, createDraftNameModal(userId, draft.createDraft.roleName, false));
        return true;
    }

    if (action === "create_hex_modal") {
        const draft = getOrInitDraft(client, guild.id, userId);
        await safeShowModal(interaction, createDraftHexModal(userId, draft.createDraft.colorHex || "#00E5FF"));
        return true;
    }

    if (action === "create_grad_modal") {
        const capabilities = detectGuildCustomRoleCapabilities(guild);
        if (!capabilities.hasEnhancedRoleColors) {
            await safeReply(interaction, {
                content: "⚠️ Server ini belum memiliki fitur `Enhanced Role Styles` Discord untuk menerapkan gradasi role.",
                flags: MessageFlags.Ephemeral,
            });
            return true;
        }
        const draft = getOrInitDraft(client, guild.id, userId);
        const colors = draft.createDraft.gradient?.colors || [draft.createDraft.colorHex || "#00E5FF", "#5865F2"];
        await safeShowModal(interaction, createDraftGradientModal(userId, colors));
        return true;
    }

    if (action === "create_icon_modal") {
        const capabilities = detectGuildCustomRoleCapabilities(guild);
        if (!capabilities.hasRoleIcons) {
            await safeReply(interaction, {
                content: "⚠️ Server ini membutuhkan **Server Boost Level 2 (`ROLE_ICONS`)** untuk memasang ikon role di Discord.",
                flags: MessageFlags.Ephemeral,
            });
            return true;
        }
        await safeShowModal(interaction, createDraftIconModal(userId));
        return true;
    }

    if (action === "create_submit") {
        const draft = getOrInitDraft(client, guild.id, userId);
        if (!String(draft.createDraft?.roleName || "").trim()) {
            await safeShowModal(interaction, createDraftNameModal(userId, "", true));
            return true;
        }
    }

    if (selectedMenuAction === "create" || action === "quick_create") {
        const ack = await safeDeferUpdate(interaction);
        if (!ack) return true;

        return withCustomRoleLock(guild.id, userId, async () => {
            const roleCtx = await resolveUserRoleContext(client, guild, userId);
            const maxAllowed = config.maxRolesPerMember || 1;

            if (roleCtx.activePairs.length >= maxAllowed) {
                const panel = await buildCustomRoleDashboard(client, guild, interaction.user, {
                    config,
                    roleCtx,
                    canManageConfig: canManage,
                    noticeType: "warning",
                    noticeMessage: `⚠️ Kamu sudah mencapai batas maksimal Custom Role di server ini (**${roleCtx.activePairs.length}/${maxAllowed}** Custom Role). Gunakan menu **Ubah Nama**, **Ubah Warna**, **Atur Gradasi**, atau **Atur Gambar Role** untuk mengelola role milikmu.`,
                });
                await safeEditReply(interaction, panel);
                return true;
            }

            const createStudio = await buildCreateRoleStudioPanel(client, guild, interaction.user, {
                config,
                roleCtx,
            });
            await safeEditReply(interaction, createStudio);
            return true;
        });
    }

    if (selectedMenuAction === "rename" || action === "quick_rename") {
        const roleCtx = await resolveUserRoleContext(client, guild, userId);
        if (!roleCtx.selectedRecord || !roleCtx.selectedLiveRole) {
            const ack = await safeDeferUpdate(interaction);
            if (!ack) return true;
            await requireActiveUserRoleOrWarn(client, guild, interaction, config, canManage);
            return true;
        }

        await safeShowModal(interaction, createRenameModal(userId, roleCtx.selectedRecord.roleId, roleCtx.selectedLiveRole.name, false));
        return true;
    }

    if (action === "color_hex_modal") {
        const draft = getOrInitDraft(client, guild.id, userId);
        const roleCtx = await resolveUserRoleContext(client, guild, userId);
        const rec = roleCtx.selectedRecord;
        await safeShowModal(interaction, createHexInputModal(userId, rec?.roleId || "0", draft.colorHex || rec?.color || "#00E5FF", false));
        return true;
    }

    if (action === "grad_custom_modal") {
        const draft = getOrInitDraft(client, guild.id, userId);
        const colors = draft.gradient?.colors || ["#00E5FF", "#5865F2"];
        await safeShowModal(interaction, createCustomGradientModal(userId, colors));
        return true;
    }

    if (action === "img_upload_modal") {
        const capabilities = detectGuildCustomRoleCapabilities(guild);
        await safeShowModal(interaction, createImageUploadModal(userId, capabilities.hasRoleIcons));
        return true;
    }

    // ------------------------------------------------------------------------
    // 2. Modal Submissions (`modal_create`, `modal_rename`, `modal_hex`, `modal_gradient`, `modal_image`)
    // ------------------------------------------------------------------------
    if (typeof interaction.isModalSubmit === "function" && interaction.isModalSubmit()) {
        const isFromMsg = typeof interaction.isFromMessage === "function" && interaction.isFromMessage();
        const acked = isFromMsg ? await safeDeferUpdate(interaction) : await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

        if (!acked) return true;

        return withCustomRoleLock(guild.id, userId, async () => {
            if (action === "modal_create") {
                const rawName = interaction.fields.getTextInputValue("role_name");
                const rawHex = interaction.fields.getTextInputValue("role_hex") || "#00E5FF";

                const roleCtx = await resolveUserRoleContext(client, guild, userId);
                const maxAllowed = config.maxRolesPerMember || 1;

                if (roleCtx.activePairs.length >= maxAllowed) {
                    const panel = await buildCustomRoleDashboard(client, guild, interaction.user, {
                        config,
                        roleCtx,
                        canManageConfig: canManage,
                        noticeType: "warning",
                        noticeMessage: `⚠️ Kamu sudah mencapai batas maksimal Custom Role di server ini (**${roleCtx.activePairs.length}/${maxAllowed}** Custom Role).`,
                    });
                    await safeEditReply(interaction, panel);
                    return true;
                }

                const botCheck = await validateBotRoleManagement(guild);
                if (!botCheck.valid) {
                    const panel = await buildCustomRoleDashboard(client, guild, interaction.user, {
                        config,
                        roleCtx,
                        canManageConfig: canManage,
                        noticeType: "error",
                        noticeMessage: `❌ **Gagal Membuat Role:**\n${botCheck.message}`,
                    });
                    await safeEditReply(interaction, panel);
                    return true;
                }

                const nameCheck = validateCustomRoleName(guild, rawName);
                if (!nameCheck.valid) {
                    const panel = await buildCustomRoleDashboard(client, guild, interaction.user, {
                        config,
                        roleCtx,
                        canManageConfig: canManage,
                        noticeType: "error",
                        noticeMessage: `❌ **Nama Role Tidak Valid:**\n${nameCheck.message}`,
                    });
                    await safeEditReply(interaction, panel);
                    return true;
                }

                const colorCheck = parseAndValidateHexColor(rawHex);
                if (!colorCheck.valid) {
                    const panel = await buildCustomRoleDashboard(client, guild, interaction.user, {
                        config,
                        roleCtx,
                        canManageConfig: canManage,
                        noticeType: "error",
                        noticeMessage: `❌ **Kode Warna Tidak Valid:**\n${colorCheck.message}`,
                    });
                    await safeEditReply(interaction, panel);
                    return true;
                }

                // Clean up stale DB records whose Discord roles were already deleted manually
                for (const orphan of roleCtx.orphanPairs) {
                    await deleteCustomRoleRecord(client, guild.id, userId, orphan.record.roleId).catch(() => {});
                }

                let createdRole;
                try {
                    createdRole = await guild.roles.create({
                        name: nameCheck.name,
                        colors: {
                            primaryColor: colorCheck.discordInt,
                            secondaryColor: null,
                            tertiaryColor: null,
                        },
                        permissions: [],
                        mentionable: false,
                        reason: `Lagukan Custom Role dibuat oleh ${interaction.user.username} (${userId})`,
                    });
                } catch (discordErr) {
                    Logger.error("[CustomRole] Gagal membuat role Discord:", discordErr);
                    const panel = await buildCustomRoleDashboard(client, guild, interaction.user, {
                        config,
                        canManageConfig: canManage,
                        noticeType: "error",
                        noticeMessage:
                            "❌ **Gagal Membuat Role di Discord:** Pastikan bot memiliki izin `Manage Roles` dan jumlah role server belum mencapai batas maksimal Discord (250 role).",
                    });
                    await safeEditReply(interaction, panel);
                    return true;
                }

                const member = await resolveGuildMember(guild, userId, interaction.member);
                if (member?.roles?.add) {
                    await member.roles.add(createdRole.id, "Lagukan Custom Role: Pemberian role otomatis kepada pembuat").catch((err) => {
                        Logger.warn(`[CustomRole] Gagal memasang role ${createdRole.id} ke member ${userId}: ${err.message}`);
                    });
                }

                try {
                    await saveUserCustomRoleRecord(client, {
                        guildId: guild.id,
                        userId,
                        roleId: createdRole.id,
                        roleName: createdRole.name,
                        color: colorCheck.hex,
                        gradient: {
                            enabled: false,
                            mode: "two_color",
                            colors: [],
                            direction: "horizontal",
                            appliedMode: "none",
                        },
                        imageUrl: null,
                        imageMeta: {},
                    });
                } catch (dbErr) {
                    await createdRole.delete("Rollback karena penyimpanan MongoDB gagal").catch(() => {});
                    const panel = await buildCustomRoleDashboard(client, guild, interaction.user, {
                        config,
                        canManageConfig: canManage,
                        noticeType: "error",
                        noticeMessage: `❌ **Gagal Menyimpan ke MongoDB:** \`${escapeInline(dbErr?.message || "Kesalahan database")}\``,
                    });
                    await safeEditReply(interaction, panel);
                    return true;
                }

                const draft = getOrInitDraft(client, guild.id, userId);
                draft.selectedRoleId = String(createdRole.id);
                clearEditDraftFields(client, guild.id, userId);

                const panel = await buildCustomRoleDashboard(client, guild, interaction.user, {
                    config,
                    canManageConfig: canManage,
                    noticeType: "success",
                    noticeMessage: `🎉 **Custom Role Berhasil Dibuat!** Role <@&${createdRole.id}> dengan warna \`${colorCheck.hex}\` telah dibuat, dipasang ke akun Anda, dan disimpan ke MongoDB.`,
                });
                await safeEditReply(interaction, panel);
                return true;
            }

            if (action === "modal_rename") {
                const found = await requireActiveUserRoleOrWarn(client, guild, interaction, config, canManage);
                if (!found) return true;
                const { record, liveRole } = found;

                const botCheck = await validateBotRoleManagement(guild, liveRole);
                if (!botCheck.valid) {
                    const panel = await buildCustomRoleDashboard(client, guild, interaction.user, {
                        config,
                        canManageConfig: canManage,
                        noticeType: "error",
                        noticeMessage: `❌ **Tidak Dapat Mengubah Role:**\n${botCheck.message}`,
                    });
                    await safeEditReply(interaction, panel);
                    return true;
                }

                const rawName = interaction.fields.getTextInputValue("role_name");
                const nameCheck = validateCustomRoleName(guild, rawName, liveRole.id);
                if (!nameCheck.valid) {
                    const panel = await buildCustomRoleDashboard(client, guild, interaction.user, {
                        config,
                        canManageConfig: canManage,
                        noticeType: "error",
                        noticeMessage: `❌ **Nama Role Tidak Valid:**\n${nameCheck.message}`,
                    });
                    await safeEditReply(interaction, panel);
                    return true;
                }

                try {
                    await liveRole.setName(nameCheck.name, `Lagukan Custom Role: Ubah nama oleh ${interaction.user.username} (${userId})`);
                } catch (discordErr) {
                    Logger.error("[CustomRole] Gagal mengubah nama role di Discord:", discordErr);
                    const panel = await buildCustomRoleDashboard(client, guild, interaction.user, {
                        config,
                        canManageConfig: canManage,
                        noticeType: "error",
                        noticeMessage: "❌ **Gagal Mengubah Nama Role di Discord.** Coba beberapa saat lagi.",
                    });
                    await safeEditReply(interaction, panel);
                    return true;
                }

                try {
                    await saveUserCustomRoleRecord(client, {
                        ...record,
                        roleName: nameCheck.name,
                    });
                } catch (dbErr) {
                    const panel = await buildCustomRoleDashboard(client, guild, interaction.user, {
                        config,
                        canManageConfig: canManage,
                        noticeType: "error",
                        noticeMessage: `⚠️ Nama role di Discord berubah, namun gagal memperbarui MongoDB: \`${escapeInline(dbErr?.message)}\``,
                    });
                    await safeEditReply(interaction, panel);
                    return true;
                }

                const panel = await buildCustomRoleDashboard(client, guild, interaction.user, {
                    config,
                    canManageConfig: canManage,
                    noticeType: "success",
                    noticeMessage: `✅ **Nama Role Berhasil Diperbarui!** Custom Role Anda kini bernama **${escapeMarkdown(nameCheck.name)}** (<@&${liveRole.id}>).`,
                });
                await safeEditReply(interaction, panel);
                return true;
            }

            if (action === "modal_hex") {
                const found = await requireActiveUserRoleOrWarn(client, guild, interaction, config, canManage);
                if (!found) return true;
                const { record, liveRole } = found;

                const rawHex = interaction.fields.getTextInputValue("hex_value");
                const parsed = parseAndValidateHexColor(rawHex);
                if (!parsed.valid) {
                    const panel = await buildColorStudioPanel(
                        client,
                        guild,
                        interaction.user,
                        record,
                        liveRole,
                        `❌ ${parsed.message}`,
                        "error",
                    );
                    await safeEditReply(interaction, panel);
                    return true;
                }

                const draft = getOrInitDraft(client, guild.id, userId);
                draft.colorHex = parsed.hex;

                const panel = await buildColorStudioPanel(
                    client,
                    guild,
                    interaction.user,
                    record,
                    liveRole,
                    `✨ Preview warna \`${parsed.hex}\` berhasil dimuat! Tekan **SIMPAN WARNA** untuk menerapkannya pada role Discord.`,
                );
                await safeEditReply(interaction, panel);
                return true;
            }

            if (action === "modal_gradient") {
                const found = await requireActiveUserRoleOrWarn(client, guild, interaction, config, canManage);
                if (!found) return true;
                const { record, liveRole } = found;

                const h1 = interaction.fields.getTextInputValue("grad_hex_1");
                const h2 = interaction.fields.getTextInputValue("grad_hex_2");
                const h3 = interaction.fields.getTextInputValue("grad_hex_3")?.trim() || "";

                const p1 = parseAndValidateHexColor(h1);
                const p2 = parseAndValidateHexColor(h2);
                const p3 = h3 ? parseAndValidateHexColor(h3) : null;

                if (!p1.valid || !p2.valid || (p3 && !p3.valid)) {
                    const errMsg = !p1.valid ? p1.message : !p2.valid ? p2.message : p3.message;
                    const panel = await buildGradientStudioPanel(
                        client,
                        guild,
                        interaction.user,
                        record,
                        liveRole,
                        `❌ ${errMsg}`,
                        "error",
                    );
                    await safeEditReply(interaction, panel);
                    return true;
                }

                const draft = getOrInitDraft(client, guild.id, userId);
                const prevDir = draft.gradient?.direction || "horizontal";
                draft.gradient = {
                    mode: p3 ? "three_color" : "two_color",
                    colors: p3 ? [p1.hex, p2.hex, p3.hex] : [p1.hex, p2.hex],
                    direction: prevDir,
                };

                const panel = await buildGradientStudioPanel(
                    client,
                    guild,
                    interaction.user,
                    record,
                    liveRole,
                    "✨ **Preview Gradasi Kustom Siap!** Periksa tampilan gradasi pada gambar di bawah, lalu tekan **SIMPAN**.",
                );
                await safeEditReply(interaction, panel);
                return true;
            }

            if (action === "modal_image") {
                const found = await requireActiveUserRoleOrWarn(client, guild, interaction, config, canManage);
                if (!found) return true;
                const { record, liveRole } = found;

                const uploadedCollection =
                    typeof interaction.fields.getUploadedFiles === "function"
                        ? interaction.fields.getUploadedFiles("role_icon_file")
                        : null;
                const attachment = uploadedCollection?.first?.() || null;

                const capabilities = detectGuildCustomRoleCapabilities(guild);
                const validation = await validateAndDownloadRoleImage(attachment, capabilities.hasRoleIcons);

                if (!validation.valid) {
                    const panel = await buildImageStudioPanel(
                        client,
                        guild,
                        interaction.user,
                        record,
                        liveRole,
                        `❌ **Validasi Gambar Gagal:**\n${validation.message}`,
                        "error",
                    );
                    await safeEditReply(interaction, panel);
                    return true;
                }

                const draft = getOrInitDraft(client, guild.id, userId);
                draft.pendingImage = {
                    buffer: validation.buffer,
                    meta: validation.meta,
                };

                const panel = await buildImageStudioPanel(
                    client,
                    guild,
                    interaction.user,
                    record,
                    liveRole,
                    "✅ **Gambar Berhasil Divalidasi!** Lihat preview di bawah, lalu tekan tombol **SIMPAN** untuk menerapkannya.",
                    "success",
                );
                await safeEditReply(interaction, panel);
                return true;
            }

            if (action === "modal_create_name") {
                const rawName = interaction.fields.getTextInputValue("role_name");
                const nameCheck = validateCustomRoleName(guild, rawName);
                if (!nameCheck.valid) {
                    const panel = await buildCreateRoleStudioPanel(client, guild, interaction.user, {
                        config,
                        noticeType: "error",
                        noticeMessage: `❌ **Nama Role Tidak Valid:**\n${nameCheck.message}`,
                    });
                    await safeEditReply(interaction, panel);
                    return true;
                }

                const draft = getOrInitDraft(client, guild.id, userId);
                draft.createDraft.roleName = nameCheck.name;

                const panel = await buildCreateRoleStudioPanel(client, guild, interaction.user, {
                    config,
                    noticeType: "success",
                    noticeMessage: `✅ Nama role **${escapeMarkdown(nameCheck.name)}** disimpan pada draft! Atur warna/gradasi/ikon atau tekan **BUAT ROLE SEKARANG**.`,
                });
                await safeEditReply(interaction, panel);
                return true;
            }

            if (action === "modal_create_finalize") {
                const rawName = interaction.fields.getTextInputValue("role_name");
                const draft = getOrInitDraft(client, guild.id, userId);
                draft.createDraft.roleName = String(rawName || "").trim();
                return executeRoleCreationFromDraft(client, guild, interaction, config, canManage, rawName);
            }

            if (action === "modal_create_hex") {
                const rawHex = interaction.fields.getTextInputValue("hex_value");
                const parsed = parseAndValidateHexColor(rawHex);
                if (!parsed.valid) {
                    const panel = await buildCreateRoleStudioPanel(client, guild, interaction.user, {
                        config,
                        noticeType: "error",
                        noticeMessage: `❌ ${parsed.message}`,
                    });
                    await safeEditReply(interaction, panel);
                    return true;
                }

                const draft = getOrInitDraft(client, guild.id, userId);
                draft.createDraft.colorHex = parsed.hex;
                if (draft.createDraft.gradient) {
                    draft.createDraft.gradient.enabled = false;
                }

                const panel = await buildCreateRoleStudioPanel(client, guild, interaction.user, {
                    config,
                    noticeType: "success",
                    noticeMessage: `🎨 Warna HEX \`${parsed.hex}\` berhasil dimuat ke preview pembuatan role!`,
                });
                await safeEditReply(interaction, panel);
                return true;
            }

            if (action === "modal_create_grad") {
                const capabilities = detectGuildCustomRoleCapabilities(guild);
                if (!capabilities.hasEnhancedRoleColors) {
                    const panel = await buildCreateRoleStudioPanel(client, guild, interaction.user, {
                        config,
                        noticeType: "warning",
                        noticeMessage: "⚠️ Server ini belum memiliki fitur `Enhanced Role Styles` Discord.",
                    });
                    await safeEditReply(interaction, panel);
                    return true;
                }

                const h1 = interaction.fields.getTextInputValue("grad_hex_1");
                const h2 = interaction.fields.getTextInputValue("grad_hex_2");
                const p1 = parseAndValidateHexColor(h1);
                const p2 = parseAndValidateHexColor(h2);

                if (!p1.valid || !p2.valid) {
                    const errMsg = !p1.valid ? p1.message : p2.message;
                    const panel = await buildCreateRoleStudioPanel(client, guild, interaction.user, {
                        config,
                        noticeType: "error",
                        noticeMessage: `❌ ${errMsg}`,
                    });
                    await safeEditReply(interaction, panel);
                    return true;
                }

                const draft = getOrInitDraft(client, guild.id, userId);
                draft.createDraft.colorHex = p1.hex;
                draft.createDraft.gradient = {
                    enabled: true,
                    mode: "two_color",
                    colors: [p1.hex, p2.hex],
                    direction: "horizontal",
                };

                const panel = await buildCreateRoleStudioPanel(client, guild, interaction.user, {
                    config,
                    noticeType: "success",
                    noticeMessage: `🌈 Gradasi \`${p1.hex}\` → \`${p2.hex}\` berhasil dimuat ke preview pembuatan role!`,
                });
                await safeEditReply(interaction, panel);
                return true;
            }

            if (action === "modal_create_icon") {
                const capabilities = detectGuildCustomRoleCapabilities(guild);
                if (!capabilities.hasRoleIcons) {
                    const panel = await buildCreateRoleStudioPanel(client, guild, interaction.user, {
                        config,
                        noticeType: "warning",
                        noticeMessage: "⚠️ Server ini membutuhkan **Server Boost Level 2 (`ROLE_ICONS`)** untuk memasang ikon role.",
                    });
                    await safeEditReply(interaction, panel);
                    return true;
                }

                const uploadedCollection =
                    typeof interaction.fields.getUploadedFiles === "function"
                        ? interaction.fields.getUploadedFiles("role_icon_file")
                        : null;
                const attachment = uploadedCollection?.first?.() || null;

                const validation = await validateAndDownloadRoleImage(attachment, true);
                if (!validation.valid) {
                    const panel = await buildCreateRoleStudioPanel(client, guild, interaction.user, {
                        config,
                        noticeType: "error",
                        noticeMessage: `❌ **Validasi Ikon Gagal:**\n${validation.message}`,
                    });
                    await safeEditReply(interaction, panel);
                    return true;
                }

                const draft = getOrInitDraft(client, guild.id, userId);
                draft.createDraft.pendingImage = {
                    buffer: validation.buffer,
                    meta: validation.meta,
                };

                const panel = await buildCreateRoleStudioPanel(client, guild, interaction.user, {
                    config,
                    noticeType: "success",
                    noticeMessage: `🖼️ Ikon role \`${escapeInline(validation.meta.fileName)}\` berhasil divalidasi dan siap dipasang saat role dibuat!`,
                });
                await safeEditReply(interaction, panel);
                return true;
            }

            return true;
        });
    }

    // ------------------------------------------------------------------------
    // 3. Standard Button & Select Menu Updates (`deferUpdate` -> `editReply`)
    // ------------------------------------------------------------------------
    const acknowledged = await safeDeferUpdate(interaction);
    if (!acknowledged) return true;

    return withCustomRoleLock(guild.id, userId, async () => {
        if (action === "open_create_studio") {
            const roleCtx = await resolveUserRoleContext(client, guild, userId);
            const maxAllowed = config.maxRolesPerMember || 1;
            if (roleCtx.activePairs.length >= maxAllowed) {
                const panel = await buildCustomRoleDashboard(client, guild, interaction.user, {
                    config,
                    roleCtx,
                    canManageConfig: canManage,
                    noticeType: "warning",
                    noticeMessage: `⚠️ Kamu sudah mencapai batas maksimal Custom Role di server ini (**${roleCtx.activePairs.length}/${maxAllowed}** Custom Role).`,
                });
                await safeEditReply(interaction, panel);
                return true;
            }

            const createStudio = await buildCreateRoleStudioPanel(client, guild, interaction.user, {
                config,
                roleCtx,
            });
            await safeEditReply(interaction, createStudio);
            return true;
        }

        if (
            action === "create_color_preset" ||
            action === "create_grad_preset" ||
            action === "create_icon_chat" ||
            action === "create_reset" ||
            action === "create_submit"
        ) {
            const draft = getOrInitDraft(client, guild.id, userId);
            const capabilities = detectGuildCustomRoleCapabilities(guild);

            if (action === "create_color_preset") {
                const pickedHex = interaction.values?.[0] || "#00E5FF";
                draft.createDraft.colorHex = pickedHex;
                if (draft.createDraft.gradient) {
                    draft.createDraft.gradient.enabled = false;
                }
                const panel = await buildCreateRoleStudioPanel(client, guild, interaction.user, {
                    config,
                    noticeType: "success",
                    noticeMessage: `🎨 Warna preset \`${pickedHex}\` dipilih!`,
                });
                await safeEditReply(interaction, panel);
                return true;
            }

            if (action === "create_grad_preset") {
                const val = interaction.values?.[0] || "off";
                if (val === "off" || !capabilities.hasEnhancedRoleColors) {
                    draft.createDraft.gradient = null;
                    const panel = await buildCreateRoleStudioPanel(client, guild, interaction.user, {
                        config,
                        noticeMessage: "⚪ Mode gradasi dinonaktifkan (menggunakan warna solid).",
                    });
                    await safeEditReply(interaction, panel);
                    return true;
                }

                const chosen = GRADIENT_PRESETS.find((gp) => gp.id === val);
                if (chosen) {
                    draft.createDraft.colorHex = chosen.colors[0];
                    draft.createDraft.gradient = {
                        enabled: true,
                        mode: chosen.mode,
                        colors: [...chosen.colors],
                        direction: "horizontal",
                    };
                }

                const panel = await buildCreateRoleStudioPanel(client, guild, interaction.user, {
                    config,
                    noticeType: "success",
                    noticeMessage: `🌈 Paket gradasi **${chosen?.label || ""}** berhasil dipilih!`,
                });
                await safeEditReply(interaction, panel);
                return true;
            }

            if (action === "create_reset") {
                stopActiveImageCollector(guild.id, userId, "reset");
                resetCreateDraft(client, guild.id, userId);
                const panel = await buildCreateRoleStudioPanel(client, guild, interaction.user, {
                    config,
                    noticeMessage: "🔄 Draft pembuatan Custom Role telah direset ke pengaturan awal.",
                });
                await safeEditReply(interaction, panel);
                return true;
            }

            if (action === "create_icon_chat") {
                if (!capabilities.hasRoleIcons) {
                    const panel = await buildCreateRoleStudioPanel(client, guild, interaction.user, {
                        config,
                        noticeType: "warning",
                        noticeMessage: "⚠️ Server ini membutuhkan **Server Boost Level 2 (`ROLE_ICONS`)** untuk memasang ikon role.",
                    });
                    await safeEditReply(interaction, panel);
                    return true;
                }

                if (!interaction.channel || typeof interaction.channel.createMessageCollector !== "function") {
                    const panel = await buildCreateRoleStudioPanel(client, guild, interaction.user, {
                        config,
                        noticeType: "error",
                        noticeMessage: "⚠️ Channel ini tidak mendukung pembacaan lampiran chat. Gunakan tombol **🖼️ Upload Ikon**.",
                    });
                    await safeEditReply(interaction, panel);
                    return true;
                }

                const existingKey = `${guild.id}:${userId}`;
                stopActiveImageCollector(guild.id, userId, "replaced");

                const collector = interaction.channel.createMessageCollector({
                    filter: (m) => m.author?.id === userId && m.attachments?.size > 0,
                    max: 1,
                    time: 60_000,
                });
                activeChatUploadCollectors.set(existingKey, collector);

                collector.on("collect", async (msg) => {
                    activeChatUploadCollectors.delete(existingKey);

                    const freshMember = await resolveGuildMember(guild, userId, msg.member);
                    const freshConfig = await getGuildCustomRoleConfig(client, guild.id);
                    const freshCheck = evaluateMemberEligibilityWithConfig(
                        guild,
                        freshConfig,
                        freshMember,
                        msg.member,
                        canManageCustomRoleConfig(freshMember || interaction, guild),
                    );

                    if (!freshCheck.allowed) {
                        clearDraft(client, guild.id, userId);
                        const deniedEmbed = buildCustomRoleAccessDeniedEmbed(client, freshCheck.code, freshConfig);
                        await safeEditReply(interaction, { embeds: [deniedEmbed], components: [], files: [] });
                        return;
                    }

                    const att = msg.attachments.first();
                    const validation = await validateAndDownloadRoleImage(att, true);
                    if (!validation.valid) {
                        const errPanel = await buildCreateRoleStudioPanel(client, guild, interaction.user, {
                            config: freshConfig,
                            noticeType: "error",
                            noticeMessage: `❌ **Validasi Ikon Gagal:**\n${validation.message}`,
                        });
                        await safeEditReply(interaction, errPanel);
                        return;
                    }

                    draft.createDraft.pendingImage = {
                        buffer: validation.buffer,
                        meta: validation.meta,
                    };

                    const okPanel = await buildCreateRoleStudioPanel(client, guild, interaction.user, {
                        config: freshConfig,
                        noticeType: "success",
                        noticeMessage: "✅ **Ikon dari Attachment Berhasil Diterima!** Tekan **BUAT ROLE SEKARANG** untuk membuat role.",
                    });
                    await safeEditReply(interaction, okPanel);
                });

                collector.on("end", (_, reason) => {
                    if (activeChatUploadCollectors.get(existingKey) === collector) {
                        activeChatUploadCollectors.delete(existingKey);
                    }
                    if (reason === "time") {
                        buildCreateRoleStudioPanel(client, guild, interaction.user, {
                            config,
                            noticeMessage: "⌛ Waktu tunggu unggah ikon lewat chat (60 detik) berakhir.",
                        })
                            .then((timeoutPanel) => safeEditReply(interaction, timeoutPanel))
                            .catch(() => {});
                    }
                });

                const waitingPanel = await buildCreateRoleStudioPanel(client, guild, interaction.user, {
                    config,
                    noticeMessage:
                        "📲 **Menunggu Attachment Gambar (60 Detik):** Kirim gambar **PNG / JPG / JPEG / WEBP** (maks. **256 KB**) ke chat ini!",
                });
                await safeEditReply(interaction, waitingPanel);
                return true;
            }

            if (action === "create_submit") {
                return executeRoleCreationFromDraft(client, guild, interaction, config, canManage);
            }
        }

        if (action === "delete_select_role") {
            const pickedRoleId = interaction.values?.[0] || null;
            const draft = getOrInitDraft(client, guild.id, userId);
            draft.selectedRoleId = pickedRoleId;

            const roleCtx = await resolveUserRoleContext(client, guild, userId);
            if (!roleCtx.selectedRecord) {
                const panel = await buildCustomRoleDashboard(client, guild, interaction.user, {
                    config,
                    canManageConfig: canManage,
                    noticeType: "warning",
                    noticeMessage: "ℹ️ Custom Role tidak ditemukan.",
                });
                await safeEditReply(interaction, panel);
                return true;
            }

            const confirmPanel = buildDeleteConfirmPanel(client, userId, roleCtx.selectedRecord, roleCtx.selectedLiveRole, roleCtx.pairs);
            await safeEditReply(interaction, confirmPanel);
            return true;
        }

        if (action === "delete_cancel") {
            const roleCtx = await resolveUserRoleContext(client, guild, userId);
            if (roleCtx.activePairs.length > 0) {
                const panel = await buildCustomRoleDashboard(client, guild, interaction.user, {
                    config,
                    roleCtx,
                    canManageConfig: canManage,
                    noticeMessage: "↩️ Penghapusan Custom Role dibatalkan.",
                });
                await safeEditReply(interaction, panel);
            } else {
                const cancelledEmbed = new EmbedBuilder()
                    .setColor(CR_COLORS.PRIMARY)
                    .setTitle("↩️ PENGHAPUSAN DIBATALKAN")
                    .setDescription("Penghapusan Custom Role telah dibatalkan. Tidak ada perubahan yang dilakukan.")
                    .setFooter({ text: CR_FOOTER, iconURL: botAvatar })
                    .setTimestamp();
                await safeEditReply(interaction, { embeds: [cancelledEmbed], components: [], files: [] });
            }
            return true;
        }

        if (action === "cancel") {
            stopActiveImageCollector(guild.id, userId, "cancelled");
            clearEditDraftFields(client, guild.id, userId);
            const panel = await buildCustomRoleDashboard(client, guild, interaction.user, {
                config,
                canManageConfig: canManage,
            });
            await safeEditReply(interaction, panel);
            return true;
        }

        if (action === "select_own_role") {
            const pickedRoleId = interaction.values?.[0] || null;
            const draft = getOrInitDraft(client, guild.id, userId);
            draft.selectedRoleId = pickedRoleId;
            clearEditDraftFields(client, guild.id, userId);

            const panel = await buildCustomRoleDashboard(client, guild, interaction.user, {
                config,
                canManageConfig: canManage,
                noticeType: "success",
                noticeMessage: pickedRoleId ? `🎭 Menampilkan Custom Role <@&${pickedRoleId}> milikmu.` : null,
            });
            await safeEditReply(interaction, panel);
            return true;
        }

        const navTarget =
            selectedMenuAction ||
            (action === "quick_color" ? "color" : action === "quick_gradient" ? "gradient" : action === "quick_image" ? "image" : null);

        if (navTarget === "open_config") {
            if (!canManage) {
                const denied = buildAdminConfigDeniedEmbed(client);
                await safeEditReply(interaction, { embeds: [denied], components: [], files: [] });
                return true;
            }
            const cfgPanel = await buildCustomRoleConfigDashboard(client, guild, userId, { config });
            await safeEditReply(interaction, cfgPanel);
            return true;
        }

        if (navTarget) {
            const found = await requireActiveUserRoleOrWarn(client, guild, interaction, config, canManage);
            if (!found) return true;
            const { record, liveRole } = found;

            if (navTarget === "color") {
                const draft = getOrInitDraft(client, guild.id, userId);
                draft.colorHex = record.color || "#00E5FF";
                const panel = await buildColorStudioPanel(client, guild, interaction.user, record, liveRole);
                await safeEditReply(interaction, panel);
                return true;
            }

            if (navTarget === "gradient") {
                const panel = await buildGradientStudioPanel(client, guild, interaction.user, record, liveRole);
                await safeEditReply(interaction, panel);
                return true;
            }

            if (navTarget === "image") {
                const panel = await buildImageStudioPanel(client, guild, interaction.user, record, liveRole);
                await safeEditReply(interaction, panel);
                return true;
            }

            if (navTarget === "view") {
                const panel = await buildViewCustomRolePanel(client, guild, interaction.user, record, liveRole);
                await safeEditReply(interaction, panel);
                return true;
            }

            if (navTarget === "delete") {
                const panel = buildDeleteConfirmPanel(client, userId, record, liveRole, found.roleCtx.pairs);
                await safeEditReply(interaction, panel);
                return true;
            }
        }

        // Color Studio Actions
        if (
            action === "color_preset" ||
            action === "picker_hue_prev" ||
            action === "picker_hue_next" ||
            action === "picker_bright_up" ||
            action === "picker_bright_down" ||
            action === "color_save"
        ) {
            const found = await requireActiveUserRoleOrWarn(client, guild, interaction, config, canManage);
            if (!found) return true;
            const { record, liveRole } = found;
            const draft = getOrInitDraft(client, guild.id, userId);
            const baseHex = draft.colorHex || record.color || "#00E5FF";
            const [r, g, b] = hexToRgb(baseHex);
            let [h, s, l] = rgbToHsl(r, g, b);
            if (s < 20 && (action === "picker_hue_prev" || action === "picker_hue_next")) s = 85;

            if (action === "color_preset") {
                draft.colorHex = interaction.values?.[0] || "#00E5FF";
            } else if (action === "picker_hue_prev") {
                draft.colorHex = hslToHex(h - 30, s, l);
            } else if (action === "picker_hue_next") {
                draft.colorHex = hslToHex(h + 30, s, l);
            } else if (action === "picker_bright_up") {
                draft.colorHex = hslToHex(h, s, Math.min(92, l + 10));
            } else if (action === "picker_bright_down") {
                draft.colorHex = hslToHex(h, s, Math.max(12, l - 10));
            }

            if (action !== "color_save") {
                const panel = await buildColorStudioPanel(
                    client,
                    guild,
                    interaction.user,
                    record,
                    liveRole,
                    `🎨 Preview diperbarui ke \`${draft.colorHex}\`. Tekan **SIMPAN WARNA** untuk menerapkan ke role Discord.`,
                );
                await safeEditReply(interaction, panel);
                return true;
            }

            if (!checkMutationCooldown(userId)) {
                const panel = await buildColorStudioPanel(
                    client,
                    guild,
                    interaction.user,
                    record,
                    liveRole,
                    "⏳ Mohon tunggu sebentar sebelum menyimpan perubahan lagi.",
                );
                await safeEditReply(interaction, panel);
                return true;
            }

            const botCheck = await validateBotRoleManagement(guild, liveRole);
            if (!botCheck.valid) {
                const panel = await buildColorStudioPanel(
                    client,
                    guild,
                    interaction.user,
                    record,
                    liveRole,
                    `❌ ${botCheck.message}`,
                    "error",
                );
                await safeEditReply(interaction, panel);
                return true;
            }

            const parsed = parseAndValidateHexColor(draft.colorHex || record.color);
            try {
                await liveRole.setColors(
                    {
                        primaryColor: parsed.discordInt,
                        secondaryColor: null,
                        tertiaryColor: null,
                    },
                    `Lagukan Custom Role: Ubah warna ke ${parsed.hex} oleh ${interaction.user.username}`,
                );
            } catch (discordErr) {
                Logger.error("[CustomRole] Gagal mengubah warna role Discord:", discordErr);
                const panel = await buildColorStudioPanel(
                    client,
                    guild,
                    interaction.user,
                    record,
                    liveRole,
                    "❌ **Gagal Menerapkan Warna ke Discord.** Periksa posisi role dan coba lagi.",
                    "error",
                );
                await safeEditReply(interaction, panel);
                return true;
            }

            await saveUserCustomRoleRecord(client, {
                ...record,
                color: parsed.hex,
                gradient: {
                    ...record.gradient,
                    enabled: false,
                    appliedMode: "none",
                },
            });

            clearEditDraftFields(client, guild.id, userId);
            const panel = await buildCustomRoleDashboard(client, guild, interaction.user, {
                config,
                canManageConfig: canManage,
                noticeType: "success",
                noticeMessage: `✅ **Warna Role Berhasil Disimpan!** Warna \`${parsed.hex}\` telah langsung diterapkan pada role <@&${liveRole.id}> dan disimpan ke MongoDB.`,
            });
            await safeEditReply(interaction, panel);
            return true;
        }

        // Gradient Studio Actions
        if (action === "grad_preset" || action === "grad_dir" || action === "grad_save") {
            const found = await requireActiveUserRoleOrWarn(client, guild, interaction, config, canManage);
            if (!found) return true;
            const { record, liveRole } = found;
            const draft = getOrInitDraft(client, guild.id, userId);

            if (!draft.gradient) {
                draft.gradient = {
                    mode: record.gradient?.mode || "two_color",
                    colors: record.gradient?.colors?.length >= 2 ? [...record.gradient.colors] : [record.color || "#00E5FF", "#5865F2"],
                    direction: record.gradient?.direction || "horizontal",
                };
            }

            if (action === "grad_preset") {
                const presetId = interaction.values?.[0];
                const chosen = GRADIENT_PRESETS.find((gp) => gp.id === presetId);
                if (chosen) {
                    draft.gradient.mode = chosen.mode;
                    draft.gradient.colors = [...chosen.colors];
                }
                const panel = await buildGradientStudioPanel(
                    client,
                    guild,
                    interaction.user,
                    record,
                    liveRole,
                    `✨ Paket gradasi **${chosen?.label || ""}** dimuat ke preview!`,
                );
                await safeEditReply(interaction, panel);
                return true;
            }

            if (action === "grad_dir") {
                draft.gradient.direction = interaction.values?.[0] || "horizontal";
                const panel = await buildGradientStudioPanel(
                    client,
                    guild,
                    interaction.user,
                    record,
                    liveRole,
                    `🧭 Arah preview gradasi diubah menjadi **${formatDirectionLabel(draft.gradient.direction)}**.`,
                );
                await safeEditReply(interaction, panel);
                return true;
            }

            if (action === "grad_save") {
                if (!checkMutationCooldown(userId)) {
                    const panel = await buildGradientStudioPanel(
                        client,
                        guild,
                        interaction.user,
                        record,
                        liveRole,
                        "⏳ Mohon tunggu sebentar sebelum menyimpan lagi.",
                    );
                    await safeEditReply(interaction, panel);
                    return true;
                }

                const botCheck = await validateBotRoleManagement(guild, liveRole);
                if (!botCheck.valid) {
                    const panel = await buildGradientStudioPanel(
                        client,
                        guild,
                        interaction.user,
                        record,
                        liveRole,
                        `❌ ${botCheck.message}`,
                        "error",
                    );
                    await safeEditReply(interaction, panel);
                    return true;
                }

                const capabilities = detectGuildCustomRoleCapabilities(guild);
                const grad = draft.gradient;
                const p1 = parseAndValidateHexColor(grad.colors[0]);
                const p2 = parseAndValidateHexColor(grad.colors[1] || grad.colors[0]);

                let appliedMode = "preview_only";
                let statusNotice;

                try {
                    if (capabilities.hasEnhancedRoleColors) {
                        if (grad.mode === "holographic") {
                            const holo = Constants?.HolographicStyle || {
                                Primary: 11127295,
                                Secondary: 16759788,
                                Tertiary: 16761760,
                            };
                            await liveRole.setColors(
                                {
                                    primaryColor: holo.Primary,
                                    secondaryColor: holo.Secondary,
                                    tertiaryColor: holo.Tertiary,
                                },
                                `Lagukan Custom Role: Gaya Holografik oleh ${interaction.user.username}`,
                            );
                            appliedMode = "holographic";
                            statusNotice = `🎉 **Gaya Holografik 3-Warna Resmi Discord Berhasil Diterapkan** pada role <@&${liveRole.id}> dan disimpan ke MongoDB!`;
                        } else {
                            await liveRole.setColors(
                                {
                                    primaryColor: p1.discordInt,
                                    secondaryColor: p2.discordInt,
                                    tertiaryColor: null,
                                },
                                `Lagukan Custom Role: Gradasi ${p1.hex} -> ${p2.hex} oleh ${interaction.user.username}`,
                            );
                            appliedMode = "gradient_2";
                            statusNotice =
                                grad.mode === "three_color"
                                    ? `✅ **Gradasi Disimpan!** Warna 1 & 2 (\`${p1.hex}\` → \`${p2.hex}\`) telah diterapkan langsung pada role Discord <@&${liveRole.id}>, dan desain penuh 3-warna beserta arahnya disimpan di MongoDB.`
                                    : `🎉 **Gradasi 2-Warna Berhasil Diterapkan** langsung pada role Discord <@&${liveRole.id}> (\`${p1.hex}\` → \`${p2.hex}\`) dan disimpan ke MongoDB!`;
                        }
                    } else {
                        await liveRole.setColors(
                            {
                                primaryColor: p1.discordInt,
                                secondaryColor: null,
                                tertiaryColor: null,
                            },
                            `Lagukan Custom Role: Warna utama gradasi ${p1.hex} oleh ${interaction.user.username}`,
                        );
                        appliedMode = "preview_only";
                        statusNotice = `✅ **Desain Gradasi Disimpan ke MongoDB!** Karena server ini belum memiliki fitur \`Enhanced Role Styles\` Discord, warna utama \`${p1.hex}\` diterapkan pada role <@&${liveRole.id}> dan desain gradasi penuh (${grad.colors.map((c) => `\`${c}\``).join(" → ")}) disimpan sebagai **Desain Preview Custom Role**.`;
                    }
                } catch (discordErr) {
                    Logger.warn(`[CustomRole] Fallback ke warna solid saat menyimpan gradasi: ${discordErr.message}`);
                    await liveRole
                        .setColors({
                            primaryColor: p1.discordInt,
                            secondaryColor: null,
                            tertiaryColor: null,
                        })
                        .catch(() => {});
                    appliedMode = "preview_only";
                    statusNotice = `✅ Warna utama \`${p1.hex}\` diterapkan pada role <@&${liveRole.id}>, dan desain gradasi disimpan sebagai **Desain Preview** di MongoDB.`;
                }

                await saveUserCustomRoleRecord(client, {
                    ...record,
                    color: p1.hex,
                    gradient: {
                        enabled: true,
                        mode: grad.mode,
                        colors: grad.colors,
                        direction: grad.direction,
                        appliedMode,
                    },
                });

                clearEditDraftFields(client, guild.id, userId);
                const panel = await buildCustomRoleDashboard(client, guild, interaction.user, {
                    config,
                    canManageConfig: canManage,
                    noticeType: "success",
                    noticeMessage: statusNotice,
                });
                await safeEditReply(interaction, panel);
                return true;
            }
        }

        // Image Studio Actions (`img_upload_chat`, `img_save`, `img_remove`)
        if (action === "img_upload_chat" || action === "img_save" || action === "img_remove") {
            const found = await requireActiveUserRoleOrWarn(client, guild, interaction, config, canManage);
            if (!found) return true;
            const { record, liveRole } = found;
            const capabilities = detectGuildCustomRoleCapabilities(guild);
            const draft = getOrInitDraft(client, guild.id, userId);

            if (action === "img_upload_chat") {
                if (!interaction.channel || typeof interaction.channel.createMessageCollector !== "function") {
                    const panel = await buildImageStudioPanel(
                        client,
                        guild,
                        interaction.user,
                        record,
                        liveRole,
                        "⚠️ Channel ini tidak mendukung pembacaan pesan lampiran. Silakan gunakan tombol **📁 Pilih Gambar (Galeri HP)**.",
                        "error",
                    );
                    await safeEditReply(interaction, panel);
                    return true;
                }

                const existingKey = `${guild.id}:${userId}`;
                stopActiveImageCollector(guild.id, userId, "replaced");

                const collector = interaction.channel.createMessageCollector({
                    filter: (m) => m.author?.id === userId && m.attachments?.size > 0,
                    max: 1,
                    time: 60_000,
                });
                activeChatUploadCollectors.set(existingKey, collector);

                collector.on("collect", async (msg) => {
                    activeChatUploadCollectors.delete(existingKey);

                    // Re-verify eligibility before accepting delayed chat attachment!
                    const freshMember = await resolveGuildMember(guild, userId, msg.member);
                    const freshConfig = await getGuildCustomRoleConfig(client, guild.id);
                    const freshCheck = evaluateMemberEligibilityWithConfig(
                        guild,
                        freshConfig,
                        freshMember,
                        msg.member,
                        canManageCustomRoleConfig(freshMember || interaction, guild),
                    );

                    if (!freshCheck.allowed) {
                        clearDraft(client, guild.id, userId);
                        const deniedEmbed = buildCustomRoleAccessDeniedEmbed(client, freshCheck.code);
                        await safeEditReply(interaction, { embeds: [deniedEmbed], components: [], files: [] });
                        return;
                    }

                    const att = msg.attachments.first();
                    const validation = await validateAndDownloadRoleImage(att, capabilities.hasRoleIcons);

                    if (!validation.valid) {
                        const errPanel = await buildImageStudioPanel(
                            client,
                            guild,
                            interaction.user,
                            record,
                            liveRole,
                            `❌ **Validasi Gambar Gagal:**\n${validation.message}`,
                            "error",
                        );
                        await safeEditReply(interaction, errPanel);
                        return;
                    }

                    draft.pendingImage = {
                        buffer: validation.buffer,
                        meta: validation.meta,
                    };

                    const okPanel = await buildImageStudioPanel(
                        client,
                        guild,
                        interaction.user,
                        record,
                        liveRole,
                        "✅ **Gambar dari Galeri Berhasil Diterima!** Periksa preview di bawah lalu tekan **SIMPAN**.",
                        "success",
                    );
                    await safeEditReply(interaction, okPanel);
                });

                collector.on("end", (_, reason) => {
                    if (activeChatUploadCollectors.get(existingKey) === collector) {
                        activeChatUploadCollectors.delete(existingKey);
                    }
                    if (reason === "time") {
                        buildImageStudioPanel(
                            client,
                            guild,
                            interaction.user,
                            record,
                            liveRole,
                            "⌛ Waktu tunggu unggah gambar lewat chat (60 detik) telah berakhir. Anda dapat menekan **Pilih Gambar (Galeri HP)** atau **Unggah Lewat Chat** kembali.",
                        )
                            .then((timeoutPanel) => safeEditReply(interaction, timeoutPanel))
                            .catch(() => {});
                    }
                });

                const waitingPanel = await buildImageStudioPanel(
                    client,
                    guild,
                    interaction.user,
                    record,
                    liveRole,
                    "📲 **Menunggu Gambar Anda (60 Detik):** Silakan tekan ikon **`+`** di kolom chat channel ini, pilih gambar (**PNG / JPG / JPEG / WEBP**) dari **Galeri HP** Anda, lalu kirimkan ke chat!",
                );
                await safeEditReply(interaction, waitingPanel);
                return true;
            }

            if (action === "img_remove") {
                const botCheck = await validateBotRoleManagement(guild, liveRole);
                if (!botCheck.valid) {
                    const panel = await buildImageStudioPanel(
                        client,
                        guild,
                        interaction.user,
                        record,
                        liveRole,
                        `❌ ${botCheck.message}`,
                        "error",
                    );
                    await safeEditReply(interaction, panel);
                    return true;
                }

                if (liveRole.icon) {
                    await liveRole.setIcon(null, `Lagukan Custom Role: Hapus gambar oleh ${interaction.user.username}`).catch(() => {});
                }

                await saveUserCustomRoleRecord(client, {
                    ...record,
                    imageUrl: null,
                    imageMeta: {},
                });
                draft.pendingImage = null;

                const panel = await buildCustomRoleDashboard(client, guild, interaction.user, {
                    config,
                    canManageConfig: canManage,
                    noticeType: "success",
                    noticeMessage: "🗑️ **Gambar / Ikon Custom Role berhasil dihapus.**",
                });
                await safeEditReply(interaction, panel);
                return true;
            }

            if (action === "img_save") {
                if (!draft.pendingImage?.buffer) {
                    const panel = await buildImageStudioPanel(
                        client,
                        guild,
                        interaction.user,
                        record,
                        liveRole,
                        "⚠️ Silakan unggah gambar terlebih dahulu sebelum menekan **SIMPAN**.",
                        "error",
                    );
                    await safeEditReply(interaction, panel);
                    return true;
                }

                const botCheck = await validateBotRoleManagement(guild, liveRole);
                if (!botCheck.valid) {
                    const panel = await buildImageStudioPanel(
                        client,
                        guild,
                        interaction.user,
                        record,
                        liveRole,
                        `❌ ${botCheck.message}`,
                        "error",
                    );
                    await safeEditReply(interaction, panel);
                    return true;
                }

                let appliedToDiscord = false;
                let saveNotice;

                if (capabilities.hasRoleIcons) {
                    try {
                        await liveRole.setIcon(
                            draft.pendingImage.buffer,
                            `Lagukan Custom Role: Pasang ikon role oleh ${interaction.user.username}`,
                        );
                        appliedToDiscord = true;
                        saveNotice = `🎉 **Gambar Role Berhasil Dipasang!** Ikon baru telah diterapkan langsung pada role Discord <@&${liveRole.id}> dan disimpan ke MongoDB.`;
                    } catch (iconErr) {
                        Logger.error("[CustomRole] Gagal memasang ikon role Discord:", iconErr);
                        const panel = await buildImageStudioPanel(
                            client,
                            guild,
                            interaction.user,
                            record,
                            liveRole,
                            `❌ **Gagal Memasang Ikon pada Discord:** Pastikan ukuran file maksimal **256 KB** dan server memiliki fitur **Role Icons (Boost Level 2+)**.`,
                            "error",
                        );
                        await safeEditReply(interaction, panel);
                        return true;
                    }
                } else {
                    saveNotice =
                        "✅ **Gambar & Metadata Disimpan ke MongoDB!** Karena server ini belum mencapai **Boost Level 2 (`ROLE_ICONS`)**, gambar disimpan sebagai preview desain Custom Role Anda.";
                }

                await saveUserCustomRoleRecord(client, {
                    ...record,
                    imageUrl: draft.pendingImage.meta.url,
                    imageMeta: {
                        fileName: draft.pendingImage.meta.fileName,
                        contentType: draft.pendingImage.meta.contentType,
                        size: draft.pendingImage.meta.size,
                        width: draft.pendingImage.meta.width,
                        height: draft.pendingImage.meta.height,
                        appliedToDiscord,
                    },
                });

                clearEditDraftFields(client, guild.id, userId);
                const panel = await buildCustomRoleDashboard(client, guild, interaction.user, {
                    config,
                    canManageConfig: canManage,
                    noticeType: "success",
                    noticeMessage: saveNotice,
                });
                await safeEditReply(interaction, panel);
                return true;
            }
        }

        // Delete Custom Role Confirmation (Strictly owner-only & strictly Custom-Role-owned)
        if (action === "delete_confirm") {
            const roleCtx = await resolveUserRoleContext(client, guild, userId);
            const targetId = extraTargetRoleId || roleCtx.selectedRecord?.roleId;
            const targetPair = roleCtx.pairs.find(
                (p) => String(p.record.roleId) === String(targetId) && String(p.record.userId) === userId,
            );

            if (!targetPair) {
                const deniedDeleteEmbed = new EmbedBuilder()
                    .setColor(CR_COLORS.WARNING)
                    .setTitle("⚠️ CUSTOM ROLE TIDAK DITEMUKAN")
                    .setDescription("Custom Role tersebut tidak ditemukan atau bukan milik Anda.")
                    .setFooter({ text: CR_FOOTER, iconURL: botAvatar })
                    .setTimestamp();
                await safeEditReply(interaction, { embeds: [deniedDeleteEmbed], components: [], files: [] });
                return true;
            }

            const { record, liveRole } = targetPair;

            // Extra DB verification: NEVER delete a role that is not registered in MongoDB as THIS user's Custom Role!
            if (isMongoReady()) {
                const verifiedDbRec = await getGuildCustomRoleByRoleId(client, guild.id, record.roleId);
                if (
                    !verifiedDbRec ||
                    String(verifiedDbRec.guildId) !== String(guild.id) ||
                    String(verifiedDbRec.userId) !== String(userId)
                ) {
                    const mismatchEmbed = new EmbedBuilder()
                        .setColor(CR_COLORS.ERROR)
                        .setTitle("🔒 PENGHAPUSAN DITOLAK")
                        .setDescription(
                            "Role tersebut tidak terdaftar sebagai Custom Role milik Anda di database sistem. Sistem tidak pernah menghapus role di luar Custom Role.",
                        )
                        .setFooter({ text: CR_FOOTER, iconURL: botAvatar })
                        .setTimestamp();
                    await safeEditReply(interaction, { embeds: [mismatchEmbed], components: [], files: [] });
                    return true;
                }
            }

            if (liveRole) {
                if (String(liveRole.id) === String(guild.id) || liveRole.managed) {
                    const invalidRoleEmbed = new EmbedBuilder()
                        .setColor(CR_COLORS.ERROR)
                        .setTitle("🔒 ROLE DILINDUNGI")
                        .setDescription("Role sistem / integrasi tidak dapat dihapus oleh Custom Role System.")
                        .setFooter({ text: CR_FOOTER, iconURL: botAvatar })
                        .setTimestamp();
                    await safeEditReply(interaction, { embeds: [invalidRoleEmbed], components: [], files: [] });
                    return true;
                }

                const botCheck = await validateBotRoleManagement(guild, liveRole);
                if (!botCheck.valid) {
                    const errEmbed = new EmbedBuilder()
                        .setColor(CR_COLORS.ERROR)
                        .setTitle("❌ GAGAL MENGHAPUS ROLE DI DISCORD")
                        .setDescription(botCheck.message)
                        .setFooter({ text: CR_FOOTER, iconURL: botAvatar })
                        .setTimestamp();
                    await safeEditReply(interaction, { embeds: [errEmbed], components: [], files: [] });
                    return true;
                }

                await liveRole.delete(`Lagukan Custom Role dihapus oleh ${interaction.user.username} (${userId})`).catch((err) => {
                    Logger.warn(`[CustomRole] Gagal menghapus role Discord ${liveRole.id}: ${err.message}`);
                });
            }

            await deleteCustomRoleRecord(client, guild.id, userId, record.roleId);
            const draft = getOrInitDraft(client, guild.id, userId);
            draft.selectedRoleId = null;
            clearEditDraftFields(client, guild.id, userId);

            const remainingCtx = await resolveUserRoleContext(client, guild, userId);
            if (remainingCtx.activePairs.length > 0) {
                const panel = await buildCustomRoleDashboard(client, guild, interaction.user, {
                    config,
                    roleCtx: remainingCtx,
                    canManageConfig: canManage,
                    noticeType: "success",
                    noticeMessage: `🗑️ **Custom Role Berhasil Dihapus!** Role **${escapeMarkdown(record.roleName)}** dan datanya pada server ini telah dihapus dari Discord & MongoDB.`,
                });
                await safeEditReply(interaction, panel);
                return true;
            }

            const deletedEmbed = new EmbedBuilder()
                .setColor(CR_COLORS.SUCCESS)
                .setTitle("🗑️ CUSTOM ROLE BERHASIL DIHAPUS")
                .setDescription(
                    [
                        `Custom Role **${escapeMarkdown(record.roleName)}** milik <@${userId}> beserta seluruh datanya di MongoDB untuk server **${escapeMarkdown(guild.name)}** telah berhasil dihapus.`,
                        "",
                        "Kamu dapat membuat Custom Role baru kapan saja melalui tombol **`CREATE ROLE`** pada panel!",
                    ].join("\n"),
                )
                .setFooter({ text: CR_FOOTER, iconURL: botAvatar })
                .setTimestamp();

            const recreateRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`${CR_PREFIX}:open_create_studio:${userId}`)
                    .setLabel("Buat Custom Role Baru")
                    .setEmoji("➕")
                    .setStyle(ButtonStyle.Success),
            );

            await safeEditReply(interaction, { embeds: [deletedEmbed], components: [recreateRow], files: [] });
            return true;
        }

        return true;
    });
}

module.exports = {
    CR_PREFIX,
    CR_FOOTER,
    CR_COLORS,
    PRESET_COLORS,
    GRADIENT_PRESETS,
    GRADIENT_DIRECTIONS,
    generateColorOrGradientPng,
    parseAndValidateHexColor,
    validateCustomRoleName,
    detectGuildCustomRoleCapabilities,
    validateAndDownloadRoleImage,
    canManageCustomRoleConfig,
    isUserStrictAdmin,
    checkCustomRoleAccess,
    buildCustomRoleAccessDeniedEmbed,
    buildAdminConfigDeniedEmbed,
    handleGuildMemberCustomRoleAccessUpdate,
    getGuildCustomRoleConfig,
    saveGuildCustomRoleConfig,
    getGuildCustomRoleByRoleId,
    getUserCustomRoleRecords,
    saveUserCustomRoleRecord,
    deleteCustomRoleRecord,
    buildCustomRolePublicPanel,
    syncCustomRolePanel,
    initializeCustomRolePanels,
    buildCreateRoleStudioPanel,
    buildCustomRoleDashboard,
    buildCustomRoleConfigDashboard,
    handleCustomRoleInteraction,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
