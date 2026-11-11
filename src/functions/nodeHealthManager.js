const { RainlinkConnectState } = require("rainlink");
const Logger = require("../utils/logger");

const NODE_STATE_CONNECTED = RainlinkConnectState?.Connected ?? 0;
const NODE_STATE_DISCONNECTED = RainlinkConnectState?.Disconnected ?? 1;
const NODE_STATE_CLOSED = RainlinkConnectState?.Closed ?? 2;

const nodeCapabilitiesCache = new Map();
const nodeHealthMetrics = new Map();
const guildPlaybackFailures = new Map();

function clampInt(value, min, max, fallback) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
}

function getNodeKey(node) {
    return String(node?.options?.name || `${node?.options?.host || "unknown"}:${node?.options?.port || 0}`);
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

    return (
        playingPlayers * 15 +
        players * 8 +
        lavalinkLoad * 120 +
        systemLoad * 60 +
        memRatio * 40 +
        frameDeficit * 3 +
        frameNulled * 2 +
        recentErrors * 25
    );
}

/**
 * Custom Rainlink `nodeResolver` selecting the healthiest online Lavalink node.
 */
async function selectHealthyNode(nodes) {
    const list = Array.isArray(nodes) ? nodes : [];
    const connected = list.filter((n) => n && n.state === NODE_STATE_CONNECTED && !n.sudoDisconnect);
    if (!connected.length) return undefined;

    const scored = connected.map((node) => ({ node, score: scoreNodeHealth(node) })).sort((a, b) => a.score - b.score);

    return scored[0]?.node;
}

/**
 * Queries Lavalink `/v4/info` once connected to discover installed plugins, sources, and filters.
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

        const normalized = {
            name: key,
            version: info.version?.semver || info.version || "unknown",
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
        current.lastError = detail ? String(detail?.message || detail) : "Unknown error";
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

/**
 * Applies bounded reconnect limits, healthy node selection, and periodic closed-node recovery
 * at runtime without modifying `src/settings/config.js` (preserving Termux git-pull cleanliness).
 */
function initializeNodeHealthManager(client) {
    if (!client?.rainlink || client._nodeHealthInitialized) return;
    client._nodeHealthInitialized = true;

    const maxRetries = clampInt(process.env.LAVALINK_RETRY_COUNT, 1, 50, 10);
    const retryTimeout = clampInt(process.env.LAVALINK_RETRY_TIMEOUT, 2000, 60000, 5000);

    if (client.rainlink.rainlinkOptions?.options) {
        client.rainlink.rainlinkOptions.options.retryCount = maxRetries;
        client.rainlink.rainlinkOptions.options.retryTimeout = retryTimeout;
        client.rainlink.rainlinkOptions.options.nodeResolver = selectHealthyNode;
    }

    const recoveryIntervalMs = clampInt(process.env.LAVALINK_RECOVERY_INTERVAL, 30000, 600000, 60000);
    const maxCooldownRecoveries = clampInt(process.env.LAVALINK_MAX_RECOVERY_CYCLES, 1, 20, 6);

    const timer = setInterval(() => {
        try {
            const nodes = typeof client.rainlink?.nodes?.all === "function" ? client.rainlink.nodes.all() : [];
            for (const node of nodes) {
                if (!node || node.sudoDisconnect) continue;

                // Decay recent error penalty gradually while node stays connected
                if (node.state === NODE_STATE_CONNECTED) {
                    const m = nodeHealthMetrics.get(getNodeKey(node));
                    if (m && m.recentErrors > 0) {
                        m.recentErrors = Math.max(0, m.recentErrors - 1);
                    }
                    continue;
                }

                // Controlled recovery only when node has fully entered Closed state
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

module.exports = {
    NODE_STATE_CONNECTED,
    NODE_STATE_DISCONNECTED,
    NODE_STATE_CLOSED,
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
