const Logger = require("../utils/logger");

// State is attached to each Rainlink node, never keyed globally by guild or node name.
function captureNodePlayers(node) {
    const players = node?.manager?.players?.all?.() || [];
    if (!node._lagukanSnapshots) node._lagukanSnapshots = new Map();
    for (const player of players) {
        if (player.node !== node || player.sudoDestroy || node._lagukanSnapshots.has(String(player.guildId))) continue;
        node._lagukanSnapshots.set(String(player.guildId), {
            player,
            current: player.queue?.current || null,
            encoded: player.queue?.current?.encoded || player.track || null,
            position: Math.max(0, Number(player.position) || 0),
            paused: Boolean(player.paused),
            playing: Boolean(player.playing),
            volume: player.volume,
        });
    }
}

function invalidateSession(node, rejectedSession = null) {
    if (!node?.driver) return;
    // A late 404 for an older request must not invalidate a newer ready session.
    if (rejectedSession && node.driver.sessionId && rejectedSession !== node.driver.sessionId) return;
    captureNodePlayers(node);
    node._lagukanInvalidSession = true;
    node.driver.sessionId = null;
    if (node.rest) node.rest.sessionId = "";
}

function sessionExpired(node, rejectedSession) {
    if (!node || node._lagukanInvalidSession || (node.driver?.sessionId && node.driver.sessionId !== rejectedSession)) return;
    Logger.warn(`[SessionRecovery] Session expired on node ${node.options?.name || "Lavalink"}; reconnecting.`);
    invalidateSession(node, rejectedSession);
    // Closing the socket lets Rainlink's bounded reconnect path own the reconnect; do not open a second socket.
    try {
        const ws = node.driver?.wsClient;
        if (ws?.close) ws.close(4000, "Lavalink session expired");
        else Logger.warn("[SessionRecovery] WebSocket unavailable; waiting for node health monitor.");
    } catch (error) {
        Logger.warn(`[SessionRecovery] Could not close websocket: ${Logger.sanitize(error.message)}`);
    }
}

async function recoverNodePlayers(client, node) {
    const { waitForNodeSessionReady } = require("./nodeHealthManager.js");
    if (node._lagukanRecoveryPromise) return node._lagukanRecoveryPromise;
    node._lagukanRecoveryPromise = (async () => {
        if (!(await waitForNodeSessionReady(node, 10000))) {
            Logger.warn(`[SessionRecovery] Node unavailable: ${node.options?.name || "Lavalink"}`);
            return;
        }
        Logger.info(`[SessionRecovery] Session recovered on ${node.options?.name || "Lavalink"}`);
        const snapshots = node._lagukanSnapshots || new Map();
        for (const [guildId, snapshot] of snapshots) {
            const player = client.rainlink?.players?.get?.(guildId);
            if (player !== snapshot.player || player?.node !== node || player.sudoDestroy || player.queue?.current !== snapshot.current) {
                snapshots.delete(guildId);
                continue;
            }
            let failure;
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    if (attempt) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
                    if (client.rainlink.players.get(guildId) !== player || player.queue?.current !== snapshot.current) break;
                    await player.sendServerUpdate();
                    if (snapshot.encoded && snapshot.current) {
                        const options = {
                            track: { encoded: snapshot.encoded },
                            paused: snapshot.paused,
                            volume: snapshot.volume,
                        };
                        if (!snapshot.current.isStream) options.position = snapshot.position;
                        await node.rest.updatePlayer({ guildId, playerOptions: options });
                        player.playing = snapshot.playing;
                        player.paused = snapshot.paused;
                        player.track = snapshot.encoded;
                    }
                    failure = null;
                    Logger.info(`[SessionRecovery] Player synchronized for bot ${client.user?.id || "?"} guild ${guildId}`);
                    break;
                } catch (error) {
                    failure = error;
                    if (node._lagukanInvalidSession || node.state !== 0) break;
                }
            }
            if (failure) {
                Logger.error(`[SessionRecovery] Playback failed for guild ${guildId}:`, failure);
                // Keep queue and current track intact rather than silently skipping it.
                const channel = client.channels?.cache?.get?.(player.textId);
                await channel
                    ?.send?.({
                        content:
                            "Pemutaran tidak dapat dipulihkan otomatis. Antrean tetap disimpan; coba /play atau /skip setelah Lavalink tersedia.",
                    })
                    .catch(() => {});
            }
            if (!node._lagukanInvalidSession) snapshots.delete(guildId);
        }
    })().finally(() => {
        node._lagukanRecoveryPromise = null;
    });
    return node._lagukanRecoveryPromise;
}

module.exports = { captureNodePlayers, invalidateSession, sessionExpired, recoverNodePlayers };
