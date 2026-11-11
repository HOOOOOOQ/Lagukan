const Logger = require("../utils/logger");
const pkg = require("../../package.json");

const CLIENT_MODEL_BINDINGS = Object.freeze([
    { prop: "guildData", modelName: "guild" },
    { prop: "userData", modelName: "user" },
    { prop: "playlistData", modelName: "playlist" },
    { prop: "userMusicProfileData", modelName: "UserMusicProfiles" },
    { prop: "listeningHistoryData", modelName: "ListeningHistory" },
    { prop: "favoriteTrackData", modelName: "FavoriteTracks" },
    { prop: "userPlaylistData", modelName: "UserPlaylists" },
    { prop: "musicStatisticsData", modelName: "MusicStatistics" },
    { prop: "musicWrappedData", modelName: "MusicWrapped" },
    { prop: "musicLeaderboardData", modelName: "MusicLeaderboard" },
    { prop: "musicRequestConfigData", modelName: "MusicRequestConfig" },
    { prop: "djConfigData", modelName: "DJConfig" },
    { prop: "musicPartyData", modelName: "MusicParty" },
    { prop: "guessTheSongData", modelName: "GuessTheSong" },
    { prop: "musicBattleData", modelName: "MusicBattle" },
    { prop: "premiumConfigData", modelName: "PremiumConfig" },
    { prop: "customRoleData", modelName: "customRole" },
    { prop: "customRoleConfigData", modelName: "customRoleConfig" },
    { prop: "serverTagConfigData", modelName: "serverTagConfig" },
    { prop: "serverTagMemberData", modelName: "serverTagMember" },
    { prop: "serverTagAutoRoleData", modelName: "serverTagAutoRole" },
]);

let cloudReadyState = false;

function isCloudDatabaseReady() {
    return cloudReadyState;
}

function getCloudConfig(client) {
    const cloud = client?.config?.cloudDb || {};
    const apiUrl = String(cloud.apiUrl || process.env.LAGUKAN_API_URL || "")
        .trim()
        .replace(/\/+$/, "");
    const installationId = String(cloud.installationId || process.env.LAGUKAN_INSTALL_ID || "").trim();
    const apiKey = String(cloud.apiKey || process.env.LAGUKAN_API_KEY || "").trim();
    const mongoUri = String(client?.config?.mongoUri || process.env.MONGO_URI || "").trim();
    const explicitCloud =
        cloud.enabled === true ||
        String(process.env.LAGUKAN_CLOUD_MODE || "")
            .trim()
            .toLowerCase() === "true";

    const enabled = Boolean(apiUrl && installationId && apiKey && (explicitCloud || !mongoUri));

    return {
        enabled,
        apiUrl,
        installationId,
        apiKey,
    };
}

function isCloudDatabaseMode(client) {
    return getCloudConfig(client).enabled;
}

function stripInternalDocFields(doc) {
    if (!doc || typeof doc !== "object") return {};
    const copy = {};
    for (const [key, val] of Object.entries(doc)) {
        if (key === "_id" || key === "__v" || key === "installationId") continue;
        if (typeof val === "function") continue;
        copy[key] = val;
    }
    return copy;
}

function attachDocumentHelpers(rawDoc, executeRpc) {
    if (!rawDoc || typeof rawDoc !== "object" || Array.isArray(rawDoc)) return rawDoc;

    if (!Object.prototype.hasOwnProperty.call(rawDoc, "toObject")) {
        Object.defineProperty(rawDoc, "toObject", {
            enumerable: false,
            configurable: true,
            value: () => ({ ...rawDoc }),
        });
    }

    if (!Object.prototype.hasOwnProperty.call(rawDoc, "save")) {
        Object.defineProperty(rawDoc, "save", {
            enumerable: false,
            configurable: true,
            value: async function saveRemoteDoc() {
                const payload = stripInternalDocFields(this);
                const filter = this._id ? { _id: this._id } : payload;
                const updated = await executeRpc("findOneAndUpdate", {
                    filter,
                    update: { $set: payload },
                    options: { upsert: true, returnDocument: "after" },
                });
                if (updated && typeof updated === "object") {
                    Object.assign(this, updated);
                }
                return this;
            },
        });
    }

    return rawDoc;
}

class RemoteQuery {
    constructor(executeRpc, operation, baseParams = {}) {
        this._executeRpc = executeRpc;
        this._operation = operation;
        this._params = {
            ...baseParams,
            queryModifiers: {},
        };
        this._isLean = false;
        this._promise = null;
    }

    sort(spec) {
        this._params.queryModifiers.sort = spec;
        return this;
    }

    skip(count) {
        this._params.queryModifiers.skip = Number(count) || 0;
        return this;
    }

    limit(count) {
        this._params.queryModifiers.limit = Number(count) || 0;
        return this;
    }

    select(projection) {
        this._params.projection = projection;
        return this;
    }

    lean() {
        this._isLean = true;
        return this;
    }

    exec() {
        if (!this._promise) {
            this._promise = this._executeRpc(this._operation, this._params).then((result) => {
                if (this._isLean || !result) return result;
                if (Array.isArray(result)) {
                    return result.map((item) => attachDocumentHelpers(item, this._executeRpc));
                }
                if (typeof result === "object") {
                    return attachDocumentHelpers(result, this._executeRpc);
                }
                return result;
            });
        }
        return this._promise;
    }

    then(onFulfilled, onRejected) {
        return this.exec().then(onFulfilled, onRejected);
    }

    catch(onRejected) {
        return this.exec().catch(onRejected);
    }

    finally(onFinally) {
        return this.exec().finally(onFinally);
    }
}

function createRemoteModelProxy(modelName, httpClient) {
    const executeRpc = async (operation, payload = {}) => {
        const response = await httpClient.post(`/api/v1/db/${encodeURIComponent(modelName)}/${encodeURIComponent(operation)}`, payload);
        if (!response?.data?.ok) {
            throw new Error(response?.data?.error || `Cloud DB error on ${modelName}.${operation}`);
        }
        return response.data.result;
    };

    return {
        modelName,
        find(filter = {}, projection = null) {
            return new RemoteQuery(executeRpc, "find", { filter, projection });
        },
        findOne(filter = {}, projection = null) {
            return new RemoteQuery(executeRpc, "findOne", { filter, projection });
        },
        findById(id, projection = null) {
            return new RemoteQuery(executeRpc, "findOne", { filter: { _id: id }, projection });
        },
        findOneAndUpdate(filter = {}, update = {}, options = {}) {
            return new RemoteQuery(executeRpc, "findOneAndUpdate", { filter, update, options });
        },
        findOneAndDelete(filter = {}, options = {}) {
            return new RemoteQuery(executeRpc, "findOneAndDelete", { filter, options });
        },
        updateOne(filter = {}, update = {}, options = {}) {
            return new RemoteQuery(executeRpc, "updateOne", { filter, update, options });
        },
        updateMany(filter = {}, update = {}, options = {}) {
            return new RemoteQuery(executeRpc, "updateMany", { filter, update, options });
        },
        deleteOne(filter = {}) {
            return new RemoteQuery(executeRpc, "deleteOne", { filter });
        },
        deleteMany(filter = {}) {
            return new RemoteQuery(executeRpc, "deleteMany", { filter });
        },
        countDocuments(filter = {}) {
            return new RemoteQuery(executeRpc, "countDocuments", { filter });
        },
        async create(docOrDocs) {
            const created = await executeRpc("create", { doc: docOrDocs });
            if (Array.isArray(created)) {
                return created.map((item) => attachDocumentHelpers(item, executeRpc));
            }
            return attachDocumentHelpers(created, executeRpc);
        },
    };
}

function startCloudHeartbeat(client, httpClient) {
    const sendHeartbeat = async (status = "online") => {
        try {
            await httpClient.post("/api/v1/installations/heartbeat", {
                status,
                version: pkg.version || "3.1.0",
                guildCount: client?.guilds?.cache?.size || 0,
                ping: Number.isFinite(client?.ws?.ping) ? Math.round(client.ws.ping) : null,
                botUsername: client?.user?.username || null,
                botApplicationId: client?.user?.id || null,
                nodeVersion: process.version,
                platform: `${process.platform}-${process.arch}`,
            });
        } catch {
            // Silently ignore transient heartbeat network hiccups; never log secrets
        }
    };

    if (typeof client?.on === "function") {
        client.on("clientReady", () => {
            void sendHeartbeat("online");
        });
    }

    const timer = setInterval(() => {
        if (client?.isReady?.()) {
            void sendHeartbeat("online");
        }
    }, 60_000);

    if (typeof timer.unref === "function") {
        timer.unref();
    }

    client._cloudHeartbeatTimer = timer;
}

function createCloudHttpClient(cfg) {
    const baseHeaders = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
        "X-Lagukan-Installation-Id": cfg.installationId,
        "User-Agent": `LagukanBot/${pkg.version || "3.1.0"} (${process.platform})`,
    };

    return {
        async post(endpoint, body = {}) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15_000);
            try {
                const res = await fetch(`${cfg.apiUrl}${endpoint}`, {
                    method: "POST",
                    headers: baseHeaders,
                    body: JSON.stringify(body),
                    signal: controller.signal,
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok) {
                    const err = new Error(json?.error || `HTTP ${res.status}`);
                    err.response = { status: res.status, data: json };
                    throw err;
                }
                return { status: res.status, data: json };
            } finally {
                clearTimeout(timer);
            }
        },
    };
}

async function connectCloudDatabase(client) {
    const cfg = getCloudConfig(client);
    if (!cfg.enabled) return false;

    const httpClient = createCloudHttpClient(cfg);

    // Attach remote model proxies synchronously so boot-time handlers can use them immediately
    for (const binding of CLIENT_MODEL_BINDINGS) {
        client[binding.prop] = createRemoteModelProxy(binding.modelName, httpClient);
    }

    try {
        const res = await httpClient.post("/api/v1/db/ping", {
            version: pkg.version || "3.1.0",
            nodeVersion: process.version,
        });

        if (res?.data?.ok) {
            cloudReadyState = true;
            client.isCloudDbConnected = true;
            Logger.info(`Connected to Lagukan Cloud Database Gateway (Installation: ${cfg.installationId})`);
        } else {
            cloudReadyState = false;
            client.isCloudDbConnected = false;
            Logger.error("Lagukan Cloud Database Gateway menolak koneksi: periksa LAGUKAN_INSTALL_ID dan LAGUKAN_API_KEY Anda.");
        }
    } catch (err) {
        cloudReadyState = false;
        client.isCloudDbConnected = false;
        const safeMsg = err?.response?.data?.error || err?.message || "Unknown network error";
        Logger.error(`Gagal menghubungi Lagukan Cloud Database Gateway (${cfg.apiUrl}): ${safeMsg}`);
    }

    startCloudHeartbeat(client, httpClient);
    return cloudReadyState;
}

module.exports = {
    CLIENT_MODEL_BINDINGS,
    isCloudDatabaseMode,
    isCloudDatabaseReady,
    connectCloudDatabase,
    createRemoteModelProxy,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
