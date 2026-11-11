const { RainlinkConnectState, RainlinkVoice, RainlinkPlayer, RainlinkWebsocket, RainlinkTrack, Lavalink4 } = require("rainlink");
const Logger = require("../utils/logger");

const NODE_STATE_CONNECTED = RainlinkConnectState?.Connected ?? 0;
const NODE_STATE_DISCONNECTED = RainlinkConnectState?.Disconnected ?? 1;
const NODE_STATE_CLOSED = RainlinkConnectState?.Closed ?? 2;

const VOICE_STATE_CONNECTING = 0;
const VOICE_STATE_DISCONNECTED = 5;
const SESSION_READY = 0;
const SESSION_ID_MISSING = 1;
const SESSION_ENDPOINT_MISSING = 2;

const nodeCapabilitiesCache = new Map();
const nodeHealthMetrics = new Map();
const guildPlaybackFailures = new Map();
const daveWarnedNodes = new Set();

let rainlinkPrototypesPatched = false;

function clampInt(value, min, max, fallback) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
}

function getNodeKey(node) {
    return String(node?.options?.name || `${node?.options?.host || "unknown"}:${node?.options?.port || 0}`);
}

function parseSemverTuple(versionStr) {
    const match = /(\d+)\.(\d+)\.(\d+)/.exec(String(versionStr || ""));
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isLavalinkDaveCapable(versionStr) {
    const tuple = parseSemverTuple(versionStr);
    if (!tuple) return null;
    const [major, minor] = tuple;
    if (major > 4) return true;
    if (major < 4) return false;
    return minor >= 2;
}

function syncNodeRestSession(node) {
    if (!node) return null;
    const driverSession = node.driver?.sessionId || null;
    if (driverSession && node.rest && node.rest.sessionId !== driverSession) {
        node.rest.sessionId = driverSession;
    }
    return driverSession || node.rest?.sessionId || null;
}

/**
 * Waits briefly if a Lavalink WebSocket has just opened (`Connected`) while `{ op: "ready", sessionId }`
 * is still arriving over the wire.
 */
async function waitForNodeSessionReady(node, timeoutMs = 5000) {
    if (!node) return false;
    if (syncNodeRestSession(node)) return true;
    // Allow custom test/mock drivers that do not use Lavalink4 WebSocket session handshakes
    if (!node.driver || !("sessionId" in node.driver)) return true;

    const deadline = Date.now() + Math.max(100, timeoutMs);
    while (Date.now() < deadline) {
        if (node.state !== NODE_STATE_CONNECTED || node.sudoDisconnect) {
            return false;
        }
        if (syncNodeRestSession(node)) {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 60));
    }
    return Boolean(syncNodeRestSession(node));
}

/**
 * Applies idempotent runtime fixes to Rainlink 1.2.9 prototypes without modifying `node_modules`:
 * 1. Fixes `RainlinkVoice` race when Discord sends `VOICE_SERVER_UPDATE` before `VOICE_STATE_UPDATE`,
 *    and propagates `sessionId` refreshes to Lavalink so sessions never go silent (`4006`).
 * 2. Fixes `RainlinkPlayer#play` leaving `this.paused = true` from constructor and prevents fake
 *    `this.playing = true` if Lavalink rejects the REST `PATCH` player update.
 * 3. Fixes `Lavalink4#requester` silently swallowing HTTP 400/404/500 player update errors and
 *    scrubs plaintext `Authorization` headers from debug output.
 * 4. Forces `RainlinkWebsocket` onto the RFC-6455 `ws` driver (avoiding Rainlink's custom socket
 *    parser bugs on opcode 10 pong fallthrough and `socket.unshift` frame drops) and allows
 *    live streams / direct HTTP audio (`duration === 0`) in `RainlinkTrack#isPlayable`.
 */
function patchRainlinkRuntime() {
    if (rainlinkPrototypesPatched) return;
    rainlinkPrototypesPatched = true;

    // 0. RFC-6455 compliant WebSocket transport & live/direct stream playability
    if (RainlinkWebsocket?.prototype && !RainlinkWebsocket.prototype._lagukanWsPatched) {
        RainlinkWebsocket.prototype._lagukanWsPatched = true;
        const origConnect = RainlinkWebsocket.prototype.connect;
        RainlinkWebsocket.prototype.connect = function patchedWsConnect(...args) {
            if (this.options && this.options.legacy === undefined) {
                this.options.legacy = true;
            }
            return origConnect.apply(this, args);
        };

        RainlinkWebsocket.prototype.close = function patchedWsClose(code, reason) {
            if (this.legacyWs) {
                try {
                    this.legacyWs.close(code ?? 1000, reason ?? "Self closed");
                } catch {}
                return true;
            }
            const closeReason = reason ?? "normal close";
            const data = Buffer.allocUnsafe(2 + Buffer.byteLength(closeReason));
            data.writeUInt16BE(code ?? 1000);
            data.write(closeReason, 2);
            this.sendData(data, { len: data.length, fin: true, opcode: 8 });
            return true;
        };
    }

    if (RainlinkTrack?.prototype && !RainlinkTrack.prototype._lagukanTrackPatched) {
        RainlinkTrack.prototype._lagukanTrackPatched = true;
        Object.defineProperty(RainlinkTrack.prototype, "isPlayable", {
            configurable: true,
            get() {
                const hasDuration = Boolean(this.duration) || Boolean(this.isStream) || this.source === "http" || this.source === "local";
                return Boolean(this.encoded && this.source && this.identifier && hasDuration && this.title && this.uri);
            },
        });
    }

    // 1. Order-independent Discord Voice Gateway handshake in RainlinkVoice
    if (RainlinkVoice?.prototype && !RainlinkVoice.prototype._lagukanVoicePatched) {
        RainlinkVoice.prototype._lagukanVoicePatched = true;

        RainlinkVoice.prototype.setServerUpdate = function patchedSetServerUpdate(data) {
            if (!data || !data.endpoint) {
                this._pendingServerUpdate = null;
                this.emit("connectionUpdate", SESSION_ENDPOINT_MISSING);
                return;
            }

            if (!this.sessionId) {
                // Discord Gateway v10 may deliver VOICE_SERVER_UPDATE before VOICE_STATE_UPDATE.
                // Cache serverUpdate while connecting so setStateUpdate completes the handshake!
                if (this.state === VOICE_STATE_CONNECTING) {
                    this._pendingServerUpdate = data;
                    this.debugDiscord("Cached early VOICE_SERVER_UPDATE while awaiting VOICE_STATE_UPDATE session_id");
                    return;
                }
                this.emit("connectionUpdate", SESSION_ID_MISSING);
                return;
            }

            this._pendingServerUpdate = null;
            this.lastRegion = this.region ? String(this.region) : null;
            this.region = data.endpoint.split(".").shift()?.replace(/[0-9]/g, "") || null;
            if (this.region && this.lastRegion !== this.region) {
                this.debugDiscord(`Voice Region Moved | Old Region: ${this.lastRegion} New Region: ${this.region}`);
            }

            this.serverUpdate = data;
            this.emit("connectionUpdate", SESSION_READY);
            this.debugDiscord(`Server Update Received | Server: ${this.region}`);
        };

        RainlinkVoice.prototype.setStateUpdate = function patchedSetStateUpdate({ session_id, channel_id, self_deaf, self_mute } = {}) {
            const prevSessionId = this.sessionId;
            this.lastvoiceId = this.voiceId ? String(this.voiceId) : null;
            this.voiceId = channel_id || null;

            if (this.voiceId && this.lastvoiceId && this.lastvoiceId !== this.voiceId) {
                this.debugDiscord(`Channel Moved | Old Channel: ${this.lastvoiceId} -> New Channel: ${this.voiceId}`);
            }

            if (!this.voiceId) {
                this._pendingServerUpdate = null;
                this.state = VOICE_STATE_DISCONNECTED;
                this.debugDiscord("Channel Disconnected");
            }

            this.deaf = Boolean(self_deaf);
            this.mute = Boolean(self_mute);
            this.sessionId = session_id || null;
            this.debugDiscord(`State Update Received | Channel: ${this.voiceId} SessionLoaded: ${Boolean(session_id)}`);

            if (this.voiceId && this.sessionId) {
                if (this._pendingServerUpdate?.endpoint) {
                    const pending = this._pendingServerUpdate;
                    this._pendingServerUpdate = null;
                    this.setServerUpdate(pending);
                } else if (
                    this.serverUpdate?.endpoint &&
                    ((prevSessionId && prevSessionId !== this.sessionId) || (this.lastvoiceId && this.lastvoiceId !== this.voiceId))
                ) {
                    // Propagate updated sessionId or moved channelId to Lavalink immediately
                    this.emit("connectionUpdate", SESSION_READY);
                }
            }
        };

        const origDisconnect = RainlinkVoice.prototype.disconnect;
        RainlinkVoice.prototype.disconnect = function patchedVoiceDisconnect(...args) {
            this._pendingServerUpdate = null;
            return origDisconnect.apply(this, args);
        };
    }

    // 2. Accurate RainlinkPlayer voice sync & non-faking play() state
    if (RainlinkPlayer?.prototype && !RainlinkPlayer.prototype._lagukanPlayerPatched) {
        RainlinkPlayer.prototype._lagukanPlayerPatched = true;

        RainlinkPlayer.prototype.sendServerUpdate = async function patchedSendServerUpdate() {
            syncNodeRestSession(this.node);
            const token = this.voice?.serverUpdate?.token;
            const endpoint = this.voice?.serverUpdate?.endpoint;
            const sessionId = this.voice?.sessionId;
            const channelId = this.voice?.voiceId || this.voiceId;

            if (!token || !endpoint || !sessionId || !channelId) {
                const missing = [!token && "token", !endpoint && "endpoint", !sessionId && "sessionId", !channelId && "channelId"]
                    .filter(Boolean)
                    .join(", ");
                const err = new Error(`Incomplete Discord voice state for Lavalink (${missing})`);
                Logger.music("error", "Voice handshake missing required fields", {
                    guildId: this.guildId,
                    playerStatus: `state=${this.state}`,
                    nodeStatus: getNodeKey(this.node),
                    errorMessage: err.message,
                });
                throw err;
            }

            const playerUpdate = {
                guildId: this.guildId,
                playerOptions: {
                    voice: {
                        token,
                        endpoint,
                        sessionId,
                        channelId: String(channelId),
                    },
                },
            };

            await this.node.rest.updatePlayer(playerUpdate);
        };

        const origPlay = RainlinkPlayer.prototype.play;
        RainlinkPlayer.prototype.play = async function patchedPlay(track, options) {
            this._manualStopAt = 0;
            syncNodeRestSession(this.node);
            if (!Number.isFinite(this.volume) || this.volume <= 0) {
                this.volume = this.manager?.rainlinkOptions?.options?.defaultVolume || 100;
            }

            try {
                const result = await origPlay.call(this, track, options);
                // RainlinkPlayer constructor sets `this.paused = true` and `origPlay` forgets
                // to clear `this.paused = false` when `options.paused` is omitted!
                if (!options?.paused && this.playing) {
                    this.paused = false;
                }
                return result;
            } catch (err) {
                // Roll back optimistic state so player never claims `playing: true` after failed REST PATCH
                this.playing = false;
                this.paused = true;
                this.track = null;
                Logger.music("error", "Failed to start track on Lavalink player", {
                    guildId: this.guildId,
                    playerStatus: "play_failed",
                    nodeStatus: getNodeKey(this.node),
                    errorMessage: err,
                });
                throw err;
            }
        };
    }

    // 3. Non-silent HTTP error handling & credential redaction in Lavalink4#requester
    if (Lavalink4?.prototype && !Lavalink4.prototype._lagukanRequesterPatched) {
        Lavalink4.prototype._lagukanRequesterPatched = true;

        Lavalink4.prototype.requester = async function patchedLavalink4Requester(options) {
            if (options.path.includes("/sessions") && this.sessionId == null) {
                throw new Error("Lavalink sessionId is not initialized yet. Waiting for node ready handshake.");
            }

            const url = new URL(`${this.httpUrl}${options.path}`);
            if (options.params) url.search = new URLSearchParams(options.params).toString();
            if (options.data) {
                options.body = JSON.stringify(options.data);
            }

            const lavalinkHeaders = {
                authorization: this.node.options.auth,
                "user-agent": this.manager.rainlinkOptions.options.userAgent,
                ...(options.headers || {}),
            };
            const fetchOptions = {
                ...options,
                headers: lavalinkHeaders,
            };

            if (options.path === "/decodetrack") {
                const decoded = this.decode(options.params ? options.params.encodedTrack : "");
                if (decoded) return decoded;
            }

            const res = await fetch(url, fetchOptions);
            const method = options.method || "GET";

            if (res.status === 204) {
                this.debug(`${method} ${url.pathname + url.search} status=204`);
                return undefined;
            }

            if (res.status !== 200) {
                let errorDetail = `HTTP ${res.status}`;
                try {
                    const rawText = await res.text();
                    if (rawText) {
                        try {
                            const parsed = JSON.parse(rawText);
                            errorDetail = parsed?.message || parsed?.error || `HTTP ${res.status}`;
                        } catch {
                            errorDetail = rawText.slice(0, 200);
                        }
                    }
                } catch {
                    // Ignore body parse failure
                }

                // Never log authorization headers
                this.debug(`${method} ${options.path} failed (${res.status}): ${Logger.sanitize(errorDetail)}`);

                const isSessionPlayerMutation =
                    options.path.includes("/sessions/") && options.path.includes("/players/") && (method === "PATCH" || method === "POST");

                if (isSessionPlayerMutation) {
                    const guildMatch = /\/players\/([^/?]+)/.exec(options.path);
                    const guildId = guildMatch?.[1] || "-";
                    recordNodeEvent(this.node, "error", `HTTP ${res.status}: ${errorDetail}`);
                    Logger.music("error", "Lavalink rejected player REST update", {
                        guildId,
                        playerStatus: `${method} ${res.status}`,
                        nodeStatus: getNodeKey(this.node),
                        errorMessage: errorDetail,
                    });
                    throw new Error(`Lavalink player update failed (HTTP ${res.status}): ${errorDetail}`);
                }

                return undefined;
            }

            const finalData = await res.json();
            this.debug(`${method} ${url.pathname + url.search} status=200`);
            return finalData;
        };
    }
}

/**
 * Computes a lower-is-better health penalty score for a connected RainlinkNode.
 */
function scoreNodeHealth(node) {
    if (!node || node.state !== NODE_STATE_CONNECTED || node.sudoDisconnect) {
        return Number.POSITIVE_INFINITY;
    }

    const stats = node.stats || {};
    const players = Number(stats.players || 0);
    const playingPlayers = Number(stats.playingPlayers || 0);
    const cpuCores = Math.max(1, Number(stats.cpu?.cores || 1));
    const lavalinkLoad = Number(stats.cpu?.lavalinkLoad || 0) / cpuCores;
    const systemLoad = Number(stats.cpu?.systemLoad || 0) / cpuCores;
    const memAllocated = Number(stats.memory?.allocated || 0);
    const memUsed = Number(stats.memory?.used || 0);
    const memRatio = memAllocated > 0 ? memUsed / memAllocated : 0;
    const frameDeficit = Math.max(0, Number(stats.frameStats?.deficit || 0));
    const frameNulled = Math.max(0, Number(stats.frameStats?.nulled || 0));

    const metrics = nodeHealthMetrics.get(getNodeKey(node));
    const recentErrors = Number(metrics?.recentErrors || 0);
    const missingSessionPenalty = node.driver && "sessionId" in node.driver && !node.driver.sessionId ? 500 : 0;

    return (
        playingPlayers * 15 +
        players * 8 +
        lavalinkLoad * 120 +
        systemLoad * 60 +
        memRatio * 40 +
        frameDeficit * 3 +
        frameNulled * 2 +
        recentErrors * 25 +
        missingSessionPenalty
    );
}

/**
 * Custom Rainlink `nodeResolver` selecting the healthiest online Lavalink node.
 */
async function selectHealthyNode(nodes) {
    const list = Array.isArray(nodes) ? nodes : [];
    const connected = list.filter((n) => n && n.state === NODE_STATE_CONNECTED && !n.sudoDisconnect);
    if (!connected.length) return undefined;

    for (const node of connected) {
        syncNodeRestSession(node);
    }

    const scored = connected.map((node) => ({ node, score: scoreNodeHealth(node) })).sort((a, b) => a.score - b.score);
    const chosen = scored[0]?.node;
    if (chosen) {
        await waitForNodeSessionReady(chosen, 4000);
    }
    return chosen;
}

/**
 * Queries Lavalink `/v4/info` once connected to discover installed plugins, sources, filters,
 * and Discord DAVE E2EE (`libdave` / Lavalink v4.2.0+) compatibility.
 */
async function fetchNodeCapabilities(node, force = false) {
    if (!node || node.state !== NODE_STATE_CONNECTED) return null;

    const key = getNodeKey(node);
    const existing = nodeCapabilitiesCache.get(key);
    if (existing && !force && Date.now() - existing.fetchedAt < 10 * 60 * 1000) {
        return existing;
    }

    try {
        if (typeof node.driver?.requester !== "function") return existing || null;

        const info = await node.driver.requester({
            path: "/info",
            headers: { "content-type": "application/json" },
            method: "GET",
        });

        if (!info || typeof info !== "object") return existing || null;

        const versionStr = String(info.version?.semver || info.version || "unknown");
        const daveCapable = isLavalinkDaveCapable(versionStr);

        const normalized = {
            name: key,
            version: versionStr,
            daveCapable,
            jvm: info.jvm || "unknown",
            lavaplayer: info.lavaplayer || "unknown",
            sourceManagers: Array.isArray(info.sourceManagers) ? info.sourceManagers.map((s) => String(s).toLowerCase()) : [],
            filters: Array.isArray(info.filters) ? info.filters.map((f) => String(f).toLowerCase()) : [],
            plugins: Array.isArray(info.plugins)
                ? info.plugins.map((p) => ({
                      name: String(p?.name || ""),
                      version: String(p?.version || ""),
                  }))
                : [],
            fetchedAt: Date.now(),
        };

        nodeCapabilitiesCache.set(key, normalized);

        if (daveCapable === false && !daveWarnedNodes.has(key)) {
            daveWarnedNodes.add(key);
            Logger.warn(
                `[NodeHealth] Node Lavalink '${key}' menjalankan versi lama (v${versionStr} < 4.2.0 tanpa libdave). Discord mewajibkan enkripsi suara DAVE E2EE — perbarui server Lavalink ke v4.2.2+ jika bot masuk voice tanpa suara atau terputus dengan kode 4017.`,
            );
        }

        return normalized;
    } catch (err) {
        Logger.debug(`[NodeHealth] Tidak dapat mengambil /v4/info dari node ${key}: ${err?.message || err}`);
        return existing || null;
    }
}

function getCachedNodeCapabilities(node) {
    if (!node) return null;
    return nodeCapabilitiesCache.get(getNodeKey(node)) || null;
}

function getAnyConnectedNode(client) {
    const allNodes = typeof client?.rainlink?.nodes?.all === "function" ? client.rainlink.nodes.all() : [];
    const connected = allNodes.filter((n) => n && n.state === NODE_STATE_CONNECTED && !n.sudoDisconnect);
    if (!connected.length) return null;
    for (const n of connected) syncNodeRestSession(n);
    connected.sort((a, b) => scoreNodeHealth(a) - scoreNodeHealth(b));
    return connected[0];
}

function nodeSupportsSource(node, sourceName) {
    const caps = getCachedNodeCapabilities(node);
    if (!caps || !caps.sourceManagers.length) return null;
    return caps.sourceManagers.includes(String(sourceName).toLowerCase());
}

function nodeSupportsFilter(node, filterKey) {
    const caps = getCachedNodeCapabilities(node);
    if (!caps || !caps.filters.length) return true;
    return caps.filters.includes(String(filterKey).toLowerCase());
}

function recordNodeEvent(node, eventType, detail = null) {
    const key = getNodeKey(node);
    const current = nodeHealthMetrics.get(key) || {
        connects: 0,
        disconnects: 0,
        errors: 0,
        recentErrors: 0,
        lastConnectedAt: null,
        lastDisconnectedAt: null,
        lastError: null,
        recoveryAttempts: 0,
    };

    if (eventType === "connect") {
        current.connects += 1;
        current.recentErrors = 0;
        current.recoveryAttempts = 0;
        current.lastConnectedAt = Date.now();
    } else if (eventType === "disconnect") {
        current.disconnects += 1;
        current.lastDisconnectedAt = Date.now();
    } else if (eventType === "error") {
        current.errors += 1;
        current.recentErrors = Math.min(current.recentErrors + 1, 20);
        current.lastError = detail ? Logger.sanitize(detail?.message || detail) : "Unknown error";
    } else if (eventType === "closed") {
        current.lastDisconnectedAt = Date.now();
    }

    nodeHealthMetrics.set(key, current);
    return current;
}

function getNodeHealthSummary(client) {
    const allNodes = typeof client?.rainlink?.nodes?.all === "function" ? client.rainlink.nodes.all() : [];
    return allNodes.map((node) => {
        const key = getNodeKey(node);
        return {
            name: key,
            online: node.state === NODE_STATE_CONNECTED,
            sessionReady: Boolean(syncNodeRestSession(node)),
            state: node.state,
            retryCounter: node.retryCounter || 0,
            score: scoreNodeHealth(node),
            stats: node.stats || {},
            capabilities: nodeCapabilitiesCache.get(key) || null,
            metrics: nodeHealthMetrics.get(key) || null,
        };
    });
}

/**
 * Circuit breaker for consecutive track exceptions / resolve failures in a guild
 * so broken queues never trigger infinite skip loops.
 */
function recordPlaybackFailure(guildId) {
    const gId = String(guildId || "");
    if (!gId) return { count: 1, tripped: false };

    const now = Date.now();
    const prev = guildPlaybackFailures.get(gId);
    const withinWindow = prev && now - prev.updatedAt < 45000;
    const count = withinWindow ? prev.count + 1 : 1;

    guildPlaybackFailures.set(gId, { count, updatedAt: now });
    return {
        count,
        tripped: count >= 5,
    };
}

function resetPlaybackFailure(guildId) {
    if (!guildId) return;
    guildPlaybackFailures.delete(String(guildId));
}

function patchClientLibrarySendPacket(client) {
    const lib = client?.rainlink?.library;
    if (!lib || lib._lagukanSendPacketPatched || typeof lib.sendPacket !== "function") return;
    lib._lagukanSendPacketPatched = true;

    lib.sendPacket = function patchedSendPacket(shardId, payload, important) {
        const shards = client?.ws?.shards;
        if (!shards) return undefined;

        const guildId = payload?.d?.guild_id;
        const guildShardId = guildId ? client?.guilds?.cache?.get?.(String(guildId))?.shardId : undefined;
        const candidateIds = [shardId, Number(shardId), guildShardId, 0].filter((id) => id !== undefined && !Number.isNaN(id));

        let shard = null;
        for (const id of candidateIds) {
            shard = shards.get?.(id);
            if (shard) break;
        }
        if (!shard && typeof shards.first === "function") {
            shard = shards.first();
        }

        if (!shard || typeof shard.send !== "function") {
            Logger.music("warn", "Cannot send Discord voice gateway packet: shard unavailable", {
                guildId,
                playerStatus: `op=${payload?.op}`,
                nodeStatus: `shard=${shardId}`,
            });
            return undefined;
        }

        return shard.send(payload, important);
    };
}

/**
 * Applies bounded reconnect limits, healthy node selection, Rainlink voice/REST hardening,
 * and periodic closed-node recovery at runtime without modifying `src/settings/config.js`.
 */
function initializeNodeHealthManager(client) {
    patchRainlinkRuntime();

    if (!client?.rainlink || client._nodeHealthInitialized) return;
    client._nodeHealthInitialized = true;

    patchClientLibrarySendPacket(client);

    const maxRetries = clampInt(process.env.LAVALINK_RETRY_COUNT, 1, 50, 10);
    const retryTimeout = clampInt(process.env.LAVALINK_RETRY_TIMEOUT, 2000, 60000, 5000);
    const voiceTimeout = clampInt(process.env.VOICE_CONNECTION_TIMEOUT, 5000, 30000, 15000);

    if (client.rainlink.rainlinkOptions?.options) {
        client.rainlink.rainlinkOptions.options.retryCount = maxRetries;
        client.rainlink.rainlinkOptions.options.retryTimeout = retryTimeout;
        client.rainlink.rainlinkOptions.options.voiceConnectionTimeout = voiceTimeout;
        client.rainlink.rainlinkOptions.options.nodeResolver = selectHealthyNode;
    }

    const recoveryIntervalMs = clampInt(process.env.LAVALINK_RECOVERY_INTERVAL, 30000, 600000, 60000);
    const maxCooldownRecoveries = clampInt(process.env.LAVALINK_MAX_RECOVERY_CYCLES, 1, 20, 6);

    const timer = setInterval(() => {
        try {
            const nodes = typeof client.rainlink?.nodes?.all === "function" ? client.rainlink.nodes.all() : [];
            for (const node of nodes) {
                if (!node || node.sudoDisconnect) continue;

                if (node.state === NODE_STATE_CONNECTED) {
                    syncNodeRestSession(node);
                    const m = nodeHealthMetrics.get(getNodeKey(node));
                    if (m && m.recentErrors > 0) {
                        m.recentErrors = Math.max(0, m.recentErrors - 1);
                    }
                    continue;
                }

                if (node.state === NODE_STATE_CLOSED) {
                    const key = getNodeKey(node);
                    const metrics = nodeHealthMetrics.get(key) || recordNodeEvent(node, "closed");
                    if (metrics.recoveryAttempts >= maxCooldownRecoveries) {
                        continue;
                    }
                    metrics.recoveryAttempts += 1;
                    nodeHealthMetrics.set(key, metrics);

                    Logger.warn(
                        `[NodeHealth] Mencoba pemulihan berkala (${metrics.recoveryAttempts}/${maxCooldownRecoveries}) untuk node tertutup ${key}...`,
                    );
                    try {
                        node.reconnect(false);
                    } catch (err) {
                        Logger.debug(`[NodeHealth] Gagal memicu reconnect node ${key}: ${err?.message || err}`);
                    }
                }
            }
        } catch (err) {
            Logger.debug(`[NodeHealth] Error pada monitor kesehatan node: ${err?.message || err}`);
        }
    }, recoveryIntervalMs);

    if (typeof timer.unref === "function") timer.unref();
    client._nodeHealthTimer = timer;
}

// Apply prototype safety patches immediately on module load so standalone tests benefit too
patchRainlinkRuntime();

module.exports = {
    NODE_STATE_CONNECTED,
    NODE_STATE_DISCONNECTED,
    NODE_STATE_CLOSED,
    isLavalinkDaveCapable,
    syncNodeRestSession,
    waitForNodeSessionReady,
    patchRainlinkRuntime,
    scoreNodeHealth,
    selectHealthyNode,
    fetchNodeCapabilities,
    getCachedNodeCapabilities,
    getAnyConnectedNode,
    nodeSupportsSource,
    nodeSupportsFilter,
    recordNodeEvent,
    getNodeHealthSummary,
    recordPlaybackFailure,
    resetPlaybackFailure,
    initializeNodeHealthManager,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
