const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const {
    ALLOWED_MODELS,
    ALLOWED_DB_OPERATIONS,
    generateInstallationCredentials,
    hashApiKey,
    verifyApiKeyHash,
    buildTenantIsolatedFilter,
    buildTenantIsolatedUpdate,
    buildTenantIsolatedDoc,
    redactSecretsFromText,
} = require("./security");

const INSTALL_STAGES_ORDER = ["env_check", "deps_check", "repo_clone", "npm_deps", "config_setup", "token_verify", "api_test", "bot_ready"];

let atlasConn = null;
let atlasConnectingPromise = null;
let atlasLastError = null;
const tenantAtlasModels = new Map();
let installationAtlasModel = null;

// ============================================================================
// Persistent Local Fallback Store (used ONLY when MONGO_URI is not set in dev/preview)
// ============================================================================
const LOCAL_STORE_DIR = path.join(__dirname, "../.data");
const LOCAL_STORE_FILE = path.join(LOCAL_STORE_DIR, "central-store.json");

let localMemoryStore = null;

function loadLocalStore() {
    if (localMemoryStore) return localMemoryStore;
    try {
        if (fs.existsSync(LOCAL_STORE_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(LOCAL_STORE_FILE, "utf8"));
            if (parsed && typeof parsed === "object") {
                localMemoryStore = {
                    installations: Array.isArray(parsed.installations) ? parsed.installations : [],
                    collections: parsed.collections && typeof parsed.collections === "object" ? parsed.collections : {},
                };
                return localMemoryStore;
            }
        }
    } catch {
        // Initialize fresh store if unreadable
    }
    localMemoryStore = { installations: [], collections: {} };
    return localMemoryStore;
}

function saveLocalStore() {
    try {
        if (!fs.existsSync(LOCAL_STORE_DIR)) {
            fs.mkdirSync(LOCAL_STORE_DIR, { recursive: true, mode: 0o700 });
        }
        fs.writeFileSync(LOCAL_STORE_FILE, JSON.stringify(localMemoryStore, null, 2), { mode: 0o600 });
    } catch {
        // Ignore write errors on read-only serverless filesystems
    }
}

function getNestedValue(obj, dotPath) {
    if (!obj || typeof obj !== "object") return undefined;
    const parts = String(dotPath).split(".");
    let cur = obj;
    for (const part of parts) {
        if (cur === null || cur === undefined) return undefined;
        cur = cur[part];
    }
    return cur;
}

function setNestedValue(obj, dotPath, val) {
    const parts = String(dotPath).split(".");
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i += 1) {
        const p = parts[i];
        if (!cur[p] || typeof cur[p] !== "object" || Array.isArray(cur[p])) {
            cur[p] = {};
        }
        cur = cur[p];
    }
    cur[parts[parts.length - 1]] = val;
}

function deleteNestedValue(obj, dotPath) {
    const parts = String(dotPath).split(".");
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i += 1) {
        if (!cur || typeof cur !== "object") return;
        cur = cur[parts[i]];
    }
    if (cur && typeof cur === "object") {
        delete cur[parts[parts.length - 1]];
    }
}

function compareValues(a, b) {
    const aTime = a instanceof Date ? a.getTime() : typeof a === "string" && /^\d{4}-\d{2}-\d{2}T/.test(a) ? Date.parse(a) : null;
    const bTime = b instanceof Date ? b.getTime() : typeof b === "string" && /^\d{4}-\d{2}-\d{2}T/.test(b) ? Date.parse(b) : null;
    if (aTime !== null && bTime !== null && !Number.isNaN(aTime) && !Number.isNaN(bTime)) {
        return aTime - bTime;
    }
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a ?? "").localeCompare(String(b ?? ""));
}

function matchesCondition(fieldVal, cond) {
    if (cond === null || typeof cond !== "object" || cond instanceof Date || Array.isArray(cond)) {
        if (Array.isArray(fieldVal) && !Array.isArray(cond)) {
            return fieldVal.includes(cond);
        }
        return fieldVal === cond;
    }

    for (const [op, target] of Object.entries(cond)) {
        switch (op) {
            case "$eq":
                if (fieldVal !== target) return false;
                break;
            case "$ne":
                if (fieldVal === target) return false;
                break;
            case "$in":
                if (!Array.isArray(target)) return false;
                if (Array.isArray(fieldVal)) {
                    if (!fieldVal.some((v) => target.includes(v))) return false;
                } else if (!target.includes(fieldVal)) {
                    return false;
                }
                break;
            case "$nin":
                if (!Array.isArray(target)) return false;
                if (Array.isArray(fieldVal)) {
                    if (fieldVal.some((v) => target.includes(v))) return false;
                } else if (target.includes(fieldVal)) {
                    return false;
                }
                break;
            case "$gt":
                if (!(compareValues(fieldVal, target) > 0)) return false;
                break;
            case "$gte":
                if (!(compareValues(fieldVal, target) >= 0)) return false;
                break;
            case "$lt":
                if (!(compareValues(fieldVal, target) < 0)) return false;
                break;
            case "$lte":
                if (!(compareValues(fieldVal, target) <= 0)) return false;
                break;
            case "$exists":
                if (Boolean(target) !== (fieldVal !== undefined)) return false;
                break;
            case "$regex": {
                const flags = typeof cond.$options === "string" ? cond.$options : "";
                const re = new RegExp(String(target), flags);
                if (!re.test(String(fieldVal ?? ""))) return false;
                break;
            }
            case "$options":
                break;
            default:
                break;
        }
    }
    return true;
}

function matchesMongoFilter(doc, filter = {}) {
    if (!filter || typeof filter !== "object") return true;

    for (const [key, cond] of Object.entries(filter)) {
        if (key === "$and") {
            if (!Array.isArray(cond) || !cond.every((sub) => matchesMongoFilter(doc, sub))) return false;
            continue;
        }
        if (key === "$or") {
            if (!Array.isArray(cond) || !cond.some((sub) => matchesMongoFilter(doc, sub))) return false;
            continue;
        }
        if (key === "$nor") {
            if (!Array.isArray(cond) || cond.some((sub) => matchesMongoFilter(doc, sub))) return false;
            continue;
        }
        const fieldVal = getNestedValue(doc, key);
        if (!matchesCondition(fieldVal, cond)) return false;
    }
    return true;
}

function applyMongoUpdateToDoc(targetDoc, update = {}, isInsert = false) {
    const nowIso = new Date().toISOString();

    if (isInsert && update.$setOnInsert && typeof update.$setOnInsert === "object") {
        for (const [k, v] of Object.entries(update.$setOnInsert)) {
            setNestedValue(targetDoc, k, structuredClone(v));
        }
    }

    if (update.$set && typeof update.$set === "object") {
        for (const [k, v] of Object.entries(update.$set)) {
            setNestedValue(targetDoc, k, structuredClone(v));
        }
    }

    if (update.$unset && typeof update.$unset === "object") {
        for (const k of Object.keys(update.$unset)) {
            deleteNestedValue(targetDoc, k);
        }
    }

    if (update.$inc && typeof update.$inc === "object") {
        for (const [k, delta] of Object.entries(update.$inc)) {
            const cur = Number(getNestedValue(targetDoc, k) || 0);
            setNestedValue(targetDoc, k, cur + Number(delta || 0));
        }
    }

    if (update.$push && typeof update.$push === "object") {
        for (const [k, pushSpec] of Object.entries(update.$push)) {
            const curArr = Array.isArray(getNestedValue(targetDoc, k)) ? [...getNestedValue(targetDoc, k)] : [];
            if (pushSpec && typeof pushSpec === "object" && Array.isArray(pushSpec.$each)) {
                curArr.push(...structuredClone(pushSpec.$each));
                if (typeof pushSpec.$slice === "number") {
                    const sl = pushSpec.$slice;
                    const sliced = sl < 0 ? curArr.slice(sl) : curArr.slice(0, sl);
                    setNestedValue(targetDoc, k, sliced);
                } else {
                    setNestedValue(targetDoc, k, curArr);
                }
            } else {
                curArr.push(structuredClone(pushSpec));
                setNestedValue(targetDoc, k, curArr);
            }
        }
    }

    if (update.$addToSet && typeof update.$addToSet === "object") {
        for (const [k, item] of Object.entries(update.$addToSet)) {
            const curArr = Array.isArray(getNestedValue(targetDoc, k)) ? [...getNestedValue(targetDoc, k)] : [];
            if (!curArr.includes(item)) curArr.push(structuredClone(item));
            setNestedValue(targetDoc, k, curArr);
        }
    }

    if (update.$pull && typeof update.$pull === "object") {
        for (const [k, pullCond] of Object.entries(update.$pull)) {
            const curArr = Array.isArray(getNestedValue(targetDoc, k)) ? getNestedValue(targetDoc, k) : [];
            const filtered = curArr.filter((el) => {
                if (pullCond && typeof pullCond === "object" && !Array.isArray(pullCond)) {
                    return !matchesMongoFilter(el, pullCond);
                }
                return el !== pullCond;
            });
            setNestedValue(targetDoc, k, filtered);
        }
    }

    if (!targetDoc._id) targetDoc._id = crypto.randomBytes(12).toString("hex");
    if (!targetDoc.createdAt) targetDoc.createdAt = nowIso;
    targetDoc.updatedAt = nowIso;
    return targetDoc;
}

function applyQueryModifiers(docs, modifiers = {}) {
    let out = [...docs];

    if (modifiers?.sort && typeof modifiers.sort === "object") {
        const sortEntries = Object.entries(modifiers.sort);
        out.sort((a, b) => {
            for (const [field, dir] of sortEntries) {
                const cmp = compareValues(getNestedValue(a, field), getNestedValue(b, field));
                if (cmp !== 0) return Number(dir) < 0 ? -cmp : cmp;
            }
            return 0;
        });
    }

    if (Number(modifiers?.skip) > 0) {
        out = out.slice(Number(modifiers.skip));
    }

    if (Number(modifiers?.limit) > 0) {
        out = out.slice(0, Math.min(Number(modifiers.limit), 500));
    }

    return out;
}

function sanitizeOutgoingTenantDoc(doc) {
    if (!doc || typeof doc !== "object") return doc;
    if (Array.isArray(doc)) return doc.map(sanitizeOutgoingTenantDoc);
    const plain = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
    delete plain.installationId;
    delete plain.__v;
    return plain;
}

// ============================================================================
// Central MongoDB Atlas Connection (Owner Server Only)
// ============================================================================
function getConfiguredMongoUri() {
    return String(process.env.MONGO_URI || "").trim();
}

async function ensureCentralDatabaseConnection() {
    const uri = getConfiguredMongoUri();
    if (!uri) {
        loadLocalStore();
        return { mode: "local-isolated", connected: true };
    }

    if (atlasConn && atlasConn.readyState === 1) {
        return { mode: "mongodb-atlas", connected: true };
    }

    if (!atlasConnectingPromise) {
        atlasConnectingPromise = (async () => {
            try {
                const conn = mongoose.createConnection(uri, {
                    serverSelectionTimeoutMS: 7000,
                    maxPoolSize: 15,
                });
                await conn.asPromise();
                atlasConn = conn;
                atlasLastError = null;
                initAtlasModels(conn);
                return { mode: "mongodb-atlas", connected: true };
            } catch (err) {
                atlasLastError = redactSecretsFromText(err?.message || "Connection error");
                atlasConn = null;
                return { mode: "mongodb-atlas", connected: false, error: atlasLastError };
            } finally {
                atlasConnectingPromise = null;
            }
        })();
    }

    return atlasConnectingPromise;
}

function initAtlasModels(conn) {
    if (!installationAtlasModel) {
        const instSchema = new mongoose.Schema(
            {
                installationId: { type: String, required: true, unique: true, index: true },
                keySalt: { type: String, required: true },
                keyHash: { type: String, required: true },
                label: { type: String, default: "Android Termux" },
                platform: { type: String, default: "android-termux" },
                nodeVersion: { type: String, default: null },
                lagukanVersion: { type: String, default: process.env.LAGUKAN_BOT_VERSION || "3.1.0" },
                status: { type: String, default: "pending" },
                botUsername: { type: String, default: null },
                botApplicationId: { type: String, default: null },
                guildCount: { type: Number, default: 0 },
                ping: { type: Number, default: null },
                stagesCompleted: { type: [String], default: [] },
                installedAt: { type: Date, default: Date.now },
                lastHeartbeatAt: { type: Date, default: null },
                lastDbActivityAt: { type: Date, default: null },
            },
            { timestamps: true },
        );
        installationAtlasModel = conn.models.InstallerInstallation || conn.model("InstallerInstallation", instSchema);
    }

    for (const modelName of ALLOWED_MODELS) {
        if (!tenantAtlasModels.has(modelName)) {
            const tenantSchema = new mongoose.Schema(
                {
                    installationId: { type: String, required: true, index: true },
                },
                {
                    strict: false,
                    timestamps: true,
                    collection: `cloud_${modelName.toLowerCase()}`,
                },
            );
            tenantSchema.index({ installationId: 1, id: 1 });
            tenantSchema.index({ installationId: 1, guildId: 1 });
            tenantSchema.index({ installationId: 1, userId: 1 });
            const compiled = conn.models[`Cloud_${modelName}`] || conn.model(`Cloud_${modelName}`, tenantSchema);
            tenantAtlasModels.set(modelName, compiled);
        }
    }
}

// ============================================================================
// Public Service & Installation Operations
// ============================================================================
async function getCentralDbHealth() {
    const start = Date.now();
    const uriConfigured = Boolean(getConfiguredMongoUri());
    const state = await ensureCentralDatabaseConnection();
    const latencyMs = Date.now() - start;

    let totalInstallations = 0;
    if (state.mode === "mongodb-atlas" && state.connected && installationAtlasModel) {
        totalInstallations = await installationAtlasModel.countDocuments({}).catch(() => 0);
    } else if (state.mode === "local-isolated") {
        totalInstallations = loadLocalStore().installations.length;
    }

    return {
        ok: state.connected,
        mode: state.mode,
        atlasConfigured: uriConfigured,
        statusText:
            state.mode === "mongodb-atlas"
                ? state.connected
                    ? "Operational (Central MongoDB Atlas)"
                    : "Degraded (Central MongoDB Atlas Unreachable)"
                : "Operational (Central Gateway — Isolated Store)",
        tenantIsolation: "Enforced (installationId + Scrypt Auth)",
        latencyMs,
        totalInstallations,
        error: state.connected ? null : atlasLastError,
    };
}

function serializeInstallationForClient(record) {
    if (!record) return null;
    const lastBeat = record.lastHeartbeatAt ? new Date(record.lastHeartbeatAt).getTime() : 0;
    const isOnlineRecently = lastBeat > 0 && Date.now() - lastBeat < 3 * 60 * 1000;
    const computedBotStatus = isOnlineRecently
        ? "online"
        : record.lastHeartbeatAt
          ? "offline"
          : record.stagesCompleted?.includes("config_setup")
            ? "configured_standby"
            : "awaiting_setup";

    return {
        installationId: record.installationId,
        label: record.label || "Android Termux",
        platform: record.platform || "android-termux",
        nodeVersion: record.nodeVersion || null,
        lagukanVersion: record.lagukanVersion || process.env.LAGUKAN_BOT_VERSION || "3.1.0",
        installationStatus: record.status || "pending",
        botConnectionStatus: computedBotStatus,
        botUsername: record.botUsername || null,
        botApplicationId: record.botApplicationId || null,
        guildCount: Number(record.guildCount || 0),
        ping: record.ping ?? null,
        stagesCompleted: Array.isArray(record.stagesCompleted) ? record.stagesCompleted : [],
        stagesOrder: INSTALL_STAGES_ORDER,
        installedAt: record.installedAt || record.createdAt || null,
        lastHeartbeatAt: record.lastHeartbeatAt || null,
        lastDbActivityAt: record.lastDbActivityAt || null,
    };
}

async function createInstallation({ label = "Android Termux", platform = "android-termux" } = {}) {
    const state = await ensureCentralDatabaseConnection();
    if (!state.connected) {
        throw new Error("Layanan database pusat sedang tidak dapat dijangkau. Coba lagi sesaat lagi.");
    }

    const creds = generateInstallationCredentials();
    const safeLabel = String(label || "Android Termux")
        .trim()
        .slice(0, 60);
    const safePlatform = String(platform || "android-termux")
        .trim()
        .slice(0, 40);
    const now = new Date();

    const newRecord = {
        installationId: creds.installationId,
        keySalt: creds.salt,
        keyHash: creds.keyHash,
        label: safeLabel || "Android Termux",
        platform: safePlatform || "android-termux",
        nodeVersion: null,
        lagukanVersion: process.env.LAGUKAN_BOT_VERSION || "3.1.0",
        status: "pending",
        botUsername: null,
        botApplicationId: null,
        guildCount: 0,
        ping: null,
        stagesCompleted: [],
        installedAt: now.toISOString(),
        lastHeartbeatAt: null,
        lastDbActivityAt: null,
    };

    if (state.mode === "mongodb-atlas" && installationAtlasModel) {
        const created = await installationAtlasModel.create(newRecord);
        return {
            installation: serializeInstallationForClient(created),
            apiKey: creds.apiKey,
        };
    }

    const store = loadLocalStore();
    store.installations.push(newRecord);
    saveLocalStore();

    return {
        installation: serializeInstallationForClient(newRecord),
        apiKey: creds.apiKey,
    };
}

async function findRawInstallationById(installationId) {
    const state = await ensureCentralDatabaseConnection();
    if (!state.connected) return null;

    if (state.mode === "mongodb-atlas" && installationAtlasModel) {
        return installationAtlasModel.findOne({ installationId: String(installationId) }).lean();
    }

    const store = loadLocalStore();
    return store.installations.find((item) => item.installationId === String(installationId)) || null;
}

async function verifyInstallationCredentials(installationId, rawApiKey) {
    if (!installationId || !rawApiKey) return null;
    const record = await findRawInstallationById(installationId);
    if (!record || record.status === "revoked") return null;

    const ok = verifyApiKeyHash(rawApiKey, record.keySalt, record.keyHash);
    if (!ok) return null;
    return record;
}

async function updateInstallationMetadata(installationId, patch = {}) {
    const state = await ensureCentralDatabaseConnection();
    if (!state.connected) return null;

    const allowedFields = [
        "label",
        "platform",
        "nodeVersion",
        "lagukanVersion",
        "status",
        "botUsername",
        "botApplicationId",
        "guildCount",
        "ping",
        "lastHeartbeatAt",
        "lastDbActivityAt",
    ];

    const setPatch = {};
    for (const key of allowedFields) {
        if (patch[key] !== undefined) {
            setPatch[key] = patch[key];
        }
    }

    if (state.mode === "mongodb-atlas" && installationAtlasModel) {
        const updateQuery = { $set: setPatch };
        if (patch.addStage && INSTALL_STAGES_ORDER.includes(patch.addStage)) {
            updateQuery.$addToSet = { stagesCompleted: patch.addStage };
        }
        if (Array.isArray(patch.addStages)) {
            const validStages = patch.addStages.filter((s) => INSTALL_STAGES_ORDER.includes(s));
            if (validStages.length) {
                updateQuery.$addToSet = { stagesCompleted: { $each: validStages } };
            }
        }
        const updated = await installationAtlasModel
            .findOneAndUpdate({ installationId: String(installationId) }, updateQuery, { returnDocument: "after" })
            .lean();
        return serializeInstallationForClient(updated);
    }

    const store = loadLocalStore();
    const target = store.installations.find((item) => item.installationId === String(installationId));
    if (!target) return null;

    Object.assign(target, setPatch);
    if (patch.addStage && INSTALL_STAGES_ORDER.includes(patch.addStage)) {
        if (!target.stagesCompleted.includes(patch.addStage)) {
            target.stagesCompleted.push(patch.addStage);
        }
    }
    if (Array.isArray(patch.addStages)) {
        for (const st of patch.addStages) {
            if (INSTALL_STAGES_ORDER.includes(st) && !target.stagesCompleted.includes(st)) {
                target.stagesCompleted.push(st);
            }
        }
    }
    saveLocalStore();
    return serializeInstallationForClient(target);
}

async function rotateInstallationApiKey(installationId) {
    const state = await ensureCentralDatabaseConnection();
    if (!state.connected) throw new Error("Database pusat tidak terhubung.");

    const freshCreds = generateInstallationCredentials();
    if (state.mode === "mongodb-atlas" && installationAtlasModel) {
        const updated = await installationAtlasModel
            .findOneAndUpdate(
                { installationId: String(installationId) },
                { $set: { keySalt: freshCreds.salt, keyHash: freshCreds.keyHash } },
                { returnDocument: "after" },
            )
            .lean();
        if (!updated) throw new Error("Instalasi tidak ditemukan.");
        return { apiKey: freshCreds.apiKey, installation: serializeInstallationForClient(updated) };
    }

    const store = loadLocalStore();
    const target = store.installations.find((item) => item.installationId === String(installationId));
    if (!target) throw new Error("Instalasi tidak ditemukan.");
    target.keySalt = freshCreds.salt;
    target.keyHash = freshCreds.keyHash;
    saveLocalStore();
    return { apiKey: freshCreds.apiKey, installation: serializeInstallationForClient(target) };
}

// ============================================================================
// Tenant-Isolated Cloud Database RPC Executor (Strictly Scoped to installationId)
// ============================================================================
async function executeTenantDatabaseOperation(installationId, modelName, operation, payload = {}) {
    if (!ALLOWED_MODELS.has(modelName)) {
        throw new Error(`Model "${modelName}" tidak terdaftar pada skema resmi Lagukan.`);
    }
    if (!ALLOWED_DB_OPERATIONS.has(operation)) {
        throw new Error(`Operasi database "${operation}" tidak diizinkan.`);
    }

    const state = await ensureCentralDatabaseConnection();
    if (!state.connected) {
        throw new Error("Koneksi ke database pusat sedang tidak tersedia.");
    }

    const tenantFilter = operation !== "create" ? buildTenantIsolatedFilter(payload.filter, installationId) : null;
    const modifiers = payload.queryModifiers || {};

    // Touch lastDbActivityAt asynchronously
    void updateInstallationMetadata(installationId, {
        lastDbActivityAt: new Date().toISOString(),
        status: "configured",
    }).catch(() => {});

    // 1. MongoDB Atlas Execution Path
    if (state.mode === "mongodb-atlas") {
        const Model = tenantAtlasModels.get(modelName);
        if (!Model) throw new Error(`Model tenant "${modelName}" belum diinisialisasi.`);

        switch (operation) {
            case "find": {
                let q = Model.find(tenantFilter);
                if (modifiers.sort && typeof modifiers.sort === "object") q = q.sort(modifiers.sort);
                if (Number(modifiers.skip) > 0) q = q.skip(Number(modifiers.skip));
                q = q.limit(Number(modifiers.limit) > 0 ? Math.min(Number(modifiers.limit), 500) : 500);
                const docs = await q.lean();
                return sanitizeOutgoingTenantDoc(docs);
            }
            case "findOne": {
                let q = Model.findOne(tenantFilter);
                if (modifiers.sort && typeof modifiers.sort === "object") q = q.sort(modifiers.sort);
                const doc = await q.lean();
                return sanitizeOutgoingTenantDoc(doc);
            }
            case "findOneAndUpdate": {
                const tenantUpdate = buildTenantIsolatedUpdate(payload.update, installationId);
                const upsert = Boolean(payload.options?.upsert);
                const doc = await Model.findOneAndUpdate(tenantFilter, tenantUpdate, {
                    upsert,
                    returnDocument: "after",
                }).lean();
                return sanitizeOutgoingTenantDoc(doc);
            }
            case "findOneAndDelete": {
                const doc = await Model.findOneAndDelete(tenantFilter).lean();
                return sanitizeOutgoingTenantDoc(doc);
            }
            case "updateOne": {
                const tenantUpdate = buildTenantIsolatedUpdate(payload.update, installationId);
                const res = await Model.updateOne(tenantFilter, tenantUpdate, {
                    upsert: Boolean(payload.options?.upsert),
                });
                return { matchedCount: res.matchedCount, modifiedCount: res.modifiedCount, upsertedCount: res.upsertedCount || 0 };
            }
            case "updateMany": {
                const tenantUpdate = buildTenantIsolatedUpdate(payload.update, installationId);
                const res = await Model.updateMany(tenantFilter, tenantUpdate);
                return { matchedCount: res.matchedCount, modifiedCount: res.modifiedCount };
            }
            case "deleteOne": {
                const res = await Model.deleteOne(tenantFilter);
                return { deletedCount: res.deletedCount || 0 };
            }
            case "deleteMany": {
                const res = await Model.deleteMany(tenantFilter);
                return { deletedCount: res.deletedCount || 0 };
            }
            case "countDocuments": {
                return Model.countDocuments(tenantFilter);
            }
            case "create": {
                const tenantDoc = buildTenantIsolatedDoc(payload.doc, installationId);
                const created = await Model.create(tenantDoc);
                return sanitizeOutgoingTenantDoc(created);
            }
            default:
                throw new Error("Operasi tidak didukung.");
        }
    }

    // 2. Local Isolated Store Execution Path (identical tenant isolation semantics)
    const store = loadLocalStore();
    if (!Array.isArray(store.collections[modelName])) {
        store.collections[modelName] = [];
    }
    const coll = store.collections[modelName];

    switch (operation) {
        case "find": {
            const matched = coll.filter((doc) => matchesMongoFilter(doc, tenantFilter));
            return sanitizeOutgoingTenantDoc(applyQueryModifiers(matched, modifiers));
        }
        case "findOne": {
            const matched = coll.filter((doc) => matchesMongoFilter(doc, tenantFilter));
            const sorted = applyQueryModifiers(matched, modifiers);
            return sanitizeOutgoingTenantDoc(sorted[0] || null);
        }
        case "findOneAndUpdate": {
            const tenantUpdate = buildTenantIsolatedUpdate(payload.update, installationId);
            const idx = coll.findIndex((doc) => matchesMongoFilter(doc, tenantFilter));
            if (idx >= 0) {
                applyMongoUpdateToDoc(coll[idx], tenantUpdate, false);
                saveLocalStore();
                return sanitizeOutgoingTenantDoc(coll[idx]);
            }
            if (payload.options?.upsert) {
                const seed = {};
                for (const [fk, fv] of Object.entries(tenantFilter)) {
                    if (!fk.startsWith("$") && (fv === null || typeof fv !== "object")) {
                        setNestedValue(seed, fk, fv);
                    }
                }
                applyMongoUpdateToDoc(seed, tenantUpdate, true);
                seed.installationId = String(installationId);
                coll.push(seed);
                saveLocalStore();
                return sanitizeOutgoingTenantDoc(seed);
            }
            return null;
        }
        case "findOneAndDelete": {
            const idx = coll.findIndex((doc) => matchesMongoFilter(doc, tenantFilter));
            if (idx < 0) return null;
            const [removed] = coll.splice(idx, 1);
            saveLocalStore();
            return sanitizeOutgoingTenantDoc(removed);
        }
        case "updateOne": {
            const tenantUpdate = buildTenantIsolatedUpdate(payload.update, installationId);
            const idx = coll.findIndex((doc) => matchesMongoFilter(doc, tenantFilter));
            if (idx >= 0) {
                applyMongoUpdateToDoc(coll[idx], tenantUpdate, false);
                saveLocalStore();
                return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
            }
            if (payload.options?.upsert) {
                const seed = { installationId: String(installationId) };
                for (const [fk, fv] of Object.entries(tenantFilter)) {
                    if (!fk.startsWith("$") && (fv === null || typeof fv !== "object")) {
                        setNestedValue(seed, fk, fv);
                    }
                }
                applyMongoUpdateToDoc(seed, tenantUpdate, true);
                coll.push(seed);
                saveLocalStore();
                return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
            }
            return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
        }
        case "updateMany": {
            const tenantUpdate = buildTenantIsolatedUpdate(payload.update, installationId);
            let count = 0;
            for (const doc of coll) {
                if (matchesMongoFilter(doc, tenantFilter)) {
                    applyMongoUpdateToDoc(doc, tenantUpdate, false);
                    count += 1;
                }
            }
            if (count > 0) saveLocalStore();
            return { matchedCount: count, modifiedCount: count };
        }
        case "deleteOne": {
            const idx = coll.findIndex((doc) => matchesMongoFilter(doc, tenantFilter));
            if (idx < 0) return { deletedCount: 0 };
            coll.splice(idx, 1);
            saveLocalStore();
            return { deletedCount: 1 };
        }
        case "deleteMany": {
            const before = coll.length;
            store.collections[modelName] = coll.filter((doc) => !matchesMongoFilter(doc, tenantFilter));
            const deletedCount = before - store.collections[modelName].length;
            if (deletedCount > 0) saveLocalStore();
            return { deletedCount };
        }
        case "countDocuments": {
            return coll.filter((doc) => matchesMongoFilter(doc, tenantFilter)).length;
        }
        case "create": {
            const tenantDoc = buildTenantIsolatedDoc(payload.doc, installationId);
            const nowIso = new Date().toISOString();
            if (Array.isArray(tenantDoc)) {
                const inserted = tenantDoc.map((d) => ({
                    _id: crypto.randomBytes(12).toString("hex"),
                    createdAt: nowIso,
                    updatedAt: nowIso,
                    ...d,
                }));
                coll.push(...inserted);
                saveLocalStore();
                return sanitizeOutgoingTenantDoc(inserted);
            }
            const single = {
                _id: crypto.randomBytes(12).toString("hex"),
                createdAt: nowIso,
                updatedAt: nowIso,
                ...tenantDoc,
            };
            coll.push(single);
            saveLocalStore();
            return sanitizeOutgoingTenantDoc(single);
        }
        default:
            throw new Error("Operasi tidak didukung.");
    }
}

module.exports = {
    INSTALL_STAGES_ORDER,
    ensureCentralDatabaseConnection,
    getCentralDbHealth,
    createInstallation,
    findRawInstallationById,
    serializeInstallationForClient,
    verifyInstallationCredentials,
    updateInstallationMetadata,
    rotateInstallationApiKey,
    executeTenantDatabaseOperation,
};
