const test = require("node:test");
const assert = require("node:assert/strict");
const { Lavalink4 } = require("rainlink");
const { waitForNodeSessionReady } = require("../src/functions/nodeHealthManager.js");
const { invalidateSession, recoverNodePlayers } = require("../src/functions/sessionRecoveryManager.js");
const { ensureBotAuto247Connected } = require("../src/functions/auto247Manager.js");
const { detectMusicQuery } = require("../src/functions/musicSourceResolver.js");

function makeNode(guildId = "123456789012345678") {
    const node = { state: 0, options: { name: "test", auth: "secret" }, rest: {}, manager: {} };
    node.driver = {
        sessionId: "old",
        wsClient: {
            close() {
                node.closed = (node.closed || 0) + 1;
            },
        },
    };
    node.rest.sessionId = "old";
    const current = { encoded: "encoded", isStream: false };
    const player = {
        guildId,
        node,
        queue: { current, upcoming: ["next"] },
        voiceId: "voice",
        position: 4200,
        volume: 70,
        playing: true,
        paused: false,
        sendServerUpdate: async () => {
            node.voiceSync = (node.voiceSync || 0) + 1;
        },
    };
    node.manager.players = { all: () => [player], get: () => player };
    return { node, player };
}

test("404 session invalidates only old session, blocks stale writes, and resyncs queue on ready", async () => {
    const { node, player } = makeNode();
    const driver = Object.assign(node.driver, {
        node,
        manager: { rainlinkOptions: { options: { userAgent: "test" } } },
        httpUrl: "http://localhost/v4",
        debug() {},
    });
    const originalFetch = global.fetch;
    const urls = [];
    global.fetch = async (url) => {
        urls.push(String(url));
        return { status: 404, text: async () => JSON.stringify({ message: "Session not found" }) };
    };
    try {
        await assert.rejects(
            Lavalink4.prototype.requester.call(driver, { path: `/sessions/old/players/${player.guildId}`, method: "PATCH", data: {} }),
            /Session not found/,
        );
        assert.equal(node.closed, 1);
        assert.equal(driver.sessionId, null);
        assert.equal(node.rest.sessionId, "");
        assert.equal(node._lagukanSnapshots.size, 1);
        node.state = 1;
        assert.equal(await waitForNodeSessionReady(node, 100), false);
        node.state = 0;
        driver.sessionId = "fresh";
        node._lagukanInvalidSession = false;
        const updates = [];
        node.rest.updatePlayer = async (payload) => updates.push(payload);
        const client = { user: { id: "bot1" }, rainlink: { players: node.manager.players } };
        await recoverNodePlayers(client, node);
        assert.equal(node.rest.sessionId, "fresh");
        assert.equal(node.voiceSync, 1);
        assert.equal(updates[0].playerOptions.track.encoded, "encoded");
        assert.equal(updates[0].playerOptions.position, 4200);
        assert.deepEqual(player.queue.upcoming, ["next"]);
        assert.equal(node._lagukanSnapshots.size, 0);
        global.fetch = async (url) => {
            urls.push(String(url));
            return { status: 204 };
        };
        await Lavalink4.prototype.requester.call(driver, { path: `/sessions/old/players/${player.guildId}`, method: "PATCH", data: {} });
        assert.match(urls.at(-1), /sessions\/fresh\/players/);
    } finally {
        global.fetch = originalFetch;
    }
});

test("old late 404 cannot invalidate a newer session", () => {
    const { node } = makeNode();
    node.driver.sessionId = "new";
    invalidateSession(node, "old");
    assert.equal(node.driver.sessionId, "new");
    assert.equal(node._lagukanInvalidSession, undefined);
});

test("ten bot recovery snapshots stay isolated and do not duplicate player objects", async () => {
    const instances = Array.from({ length: 10 }, (_, i) => {
        const x = makeNode();
        x.node.options.name = "shared-node";
        x.node.driver.sessionId = `bot-${i}-old`;
        invalidateSession(x.node);
        x.node.driver.sessionId = `bot-${i}-new`;
        x.node._lagukanInvalidSession = false;
        x.node.rest.updatePlayer = async (payload) => {
            x.update = payload;
        };
        x.client = { user: { id: `bot-${i}` }, rainlink: { players: x.node.manager.players } };
        return x;
    });
    await Promise.all(instances.map((x) => recoverNodePlayers(x.client, x.node)));
    for (const [i, x] of instances.entries()) {
        assert.equal(x.node.rest.sessionId, `bot-${i}-new`);
        assert.equal(x.node.voiceSync, 1);
        assert.equal(x.node._lagukanSnapshots.size, 0);
        assert.equal(x.client.rainlink.players.get(), x.player);
        assert.equal(x.update.playerOptions.position, 4200);
    }
});

test("24/7 acquires the guild lock before the database await", async () => {
    let resolveConfig;
    const pending = new Promise((resolve) => {
        resolveConfig = resolve;
    });
    const guildId = "123456789012345678";
    const voiceId = "234567890123456789";
    let creates = 0;
    const node = { state: 0, driver: {}, options: { name: "test" } };
    const guild = {
        id: guildId,
        name: "test",
        shardId: 0,
        channels: { cache: new Map([[voiceId, { id: voiceId, name: "vc", type: 2 }]]) },
        members: {},
    };
    const client = {
        user: { id: "bot" },
        guilds: { cache: new Map([[guildId, guild]]) },
        data: new Map(),
        config: {},
        auto247ConfigData: { db: { readyState: 1 }, findOne: () => pending },
        rainlink: {
            players: { get: () => null },
            nodes: { all: () => [node] },
            create: async () => {
                creates++;
                return null;
            },
        },
    };
    const first = ensureBotAuto247Connected(client, guildId, { explicitNode: node });
    const second = await ensureBotAuto247Connected(client, guildId, { explicitNode: node });
    assert.equal(second.reason, "connect_in_progress");
    resolveConfig({ botApplicationId: "bot", guildId, voiceChannelId: voiceId, enabled: true });
    assert.equal((await first).reason, "create_player_failed");
    assert.equal(creates, 1);
});

test("Spotify links still use the existing resolver", () => {
    assert.equal(detectMusicQuery("https://open.spotify.com/track/abc").type, "spotify");
});

test("node reconnect uses bounded exponential backoff", () => {
    const { RainlinkNode } = require("rainlink");
    const { node } = makeNode();
    node.manager.rainlinkOptions = { options: { retryCount: 2, retryTimeout: 100 } };
    node.manager.emit = () => {};
    node.retryCounter = 0;
    node.reconnect = () => {};
    node.nodeClosed = () => {
        node.closedAtLimit = true;
    };
    RainlinkNode.prototype.wsCloseEvent.call(node, 1006, "disconnect");
    assert.equal(node.retryCounter, 1);
    assert.equal(node._lagukanReconnectTimer._idleTimeout, 100);
    clearTimeout(node._lagukanReconnectTimer);
    node._lagukanReconnectTimer = null;
    RainlinkNode.prototype.wsCloseEvent.call(node, 1006, "disconnect");
    assert.equal(node.retryCounter, 2);
    assert.equal(node._lagukanReconnectTimer._idleTimeout, 200);
    clearTimeout(node._lagukanReconnectTimer);
    node._lagukanReconnectTimer = null;
    RainlinkNode.prototype.wsCloseEvent.call(node, 1006, "disconnect");
    assert.equal(node.closedAtLimit, true);
});

test("node waits for fresh ready handshake, not stale session", async () => {
    const { node } = makeNode();
    invalidateSession(node);
    const ready = waitForNodeSessionReady(node, 500);
    setTimeout(() => {
        node.driver.sessionId = "new-session";
        node._lagukanInvalidSession = false;
    }, 20);
    assert.equal(await ready, true);
    assert.equal(node.rest.sessionId, "new-session");
});

test("stop keeps Rainlink queue intact on REST failure", async () => {
    const { RainlinkPlayer } = require("rainlink");
    let cleared = false;
    const fake = {
        checkDestroyed() {},
        queue: { current: "song", upcoming: ["next"] },
        node: {
            rest: {
                updatePlayer: async () => {
                    throw new Error("offline");
                },
            },
        },
        clear() {
            cleared = true;
        },
        manager: { emit() {} },
        guildId: "guild",
    };
    await assert.rejects(RainlinkPlayer.prototype.stop.call(fake), /offline/);
    assert.equal(cleared, false);
    assert.deepEqual(fake.queue.upcoming, ["next"]);
});

test("pause and resume acknowledge before waiting for player REST", async () => {
    for (const name of ["pause", "resume"]) {
        const command = require(`../src/commands/interaction/music/${name}.js`);
        const events = [];
        const interaction = {
            deferred: false,
            replied: false,
            deferReply: async function () {
                events.push("defer");
                this.deferred = true;
            },
            editReply: async () => {
                events.push("edit");
            },
        };
        const player = {
            paused: name === "resume",
            [name]: async () => {
                events.push("rest");
            },
        };
        await command.run({ config: { embedColor: "5865F2" } }, interaction, player);
        assert.deepEqual(events, ["defer", "rest", "edit"]);
    }
});

test("ten simulated bots use separate saved 24/7 voice channels without duplicate create", async () => {
    const guildId = "123456789012345678";
    const instances = Array.from({ length: 10 }, (_, i) => {
        const botId = `bot-${i}`;
        const voiceId = String(234567890123456700n + BigInt(i));
        const node = { state: 0, driver: {}, options: { name: "shared" } };
        const channel = { id: voiceId, name: `voice-${i}`, type: 2 };
        const guild = { id: guildId, name: "guild", shardId: 0, channels: { cache: new Map([[voiceId, channel]]) }, members: {} };
        const players = new Map();
        let creates = 0;
        const client = {
            user: { id: botId },
            config: {},
            data: new Map(),
            guilds: { cache: new Map([[guildId, guild]]) },
            auto247ConfigData: {
                db: { readyState: 1 },
                findOne: async (query) =>
                    query.botApplicationId === botId
                        ? { botApplicationId: botId, guildId, voiceChannelId: voiceId, enabled: true, autoReconnect: true }
                        : null,
            },
            rainlink: {
                players,
                nodes: { all: () => [node] },
                create: async (options) => {
                    creates++;
                    const p = { guildId, voiceId: options.voiceId, state: 0, data: new Map() };
                    players.set(guildId, p);
                    return p;
                },
            },
        };
        return { client, node, voiceId, creates: () => creates };
    });
    await Promise.all(
        instances.map(async (x) => {
            const first = await ensureBotAuto247Connected(x.client, guildId, { explicitNode: x.node });
            const second = await ensureBotAuto247Connected(x.client, guildId, { explicitNode: x.node });
            assert.equal(first.connected, true);
            assert.equal(second.alreadyConnected, true);
            assert.equal(first.player.voiceId, x.voiceId);
            assert.equal(x.creates(), 1);
        }),
    );
    assert.equal(new Set(instances.map((x) => x.voiceId)).size, 10);
});

test("player creation guard serializes concurrent entry points per bot and guild", async () => {
    const { installPlayerCreationGuard } = require("../src/functions/nodeHealthManager.js");
    let release;
    const wait = new Promise((resolve) => {
        release = resolve;
    });
    let callsA = 0;
    let callsB = 0;
    const a = {
        rainlink: {
            create: async () => {
                callsA++;
                await wait;
                return { bot: "a" };
            },
        },
    };
    const b = {
        rainlink: {
            create: async () => {
                callsB++;
                return { bot: "b" };
            },
        },
    };
    installPlayerCreationGuard(a);
    installPlayerCreationGuard(b);
    const first = a.rainlink.create({ guildId: "guild", voiceId: "voice-a" });
    const second = a.rainlink.create({ guildId: "guild", voiceId: "voice-a" });
    const otherBot = b.rainlink.create({ guildId: "guild", voiceId: "voice-b" });
    await assert.rejects(a.rainlink.create({ guildId: "guild", voiceId: "other" }), /another channel/);
    release();
    const [x, y, z] = await Promise.all([first, second, otherBot]);
    assert.equal(x, y);
    assert.equal(z.bot, "b");
    assert.equal(callsA, 1);
    assert.equal(callsB, 1);
});

test("failed initial player update removes only its incomplete player and voice", async () => {
    const { installPlayerCreationGuard } = require("../src/functions/nodeHealthManager.js");
    const players = new Map();
    const voices = new Map();
    let disconnects = 0;
    const node = { _lagukanSnapshots: new Map() };
    const rainlink = {
        players,
        voices,
        create: async ({ guildId }) => {
            const voice = {
                disconnect() {
                    disconnects++;
                },
            };
            const player = { guildId, state: 2, node };
            voices.set(guildId, voice);
            players.set(guildId, player);
            node._lagukanSnapshots.set(guildId, { player });
            throw new Error("Lavalink player update failed (HTTP 404): Session not found");
        },
    };
    installPlayerCreationGuard({ rainlink });
    await assert.rejects(rainlink.create({ guildId: "guild", voiceId: "voice" }), /Session not found/);
    assert.equal(disconnects, 1);
    assert.equal(players.has("guild"), false);
    assert.equal(voices.has("guild"), false);
    assert.equal(node._lagukanSnapshots.has("guild"), false);
});

test("stale cleanup waits for an in-progress voice connection instead of deleting it", async () => {
    const { installPlayerCreationGuard } = require("../src/functions/nodeHealthManager.js");
    const { cleanupStalePlayerIfDisconnected, prepareGuildForReconnect } = require("../src/functions/voiceSessionManager.js");
    let release;
    const wait = new Promise((resolve) => {
        release = resolve;
    });
    const players = new Map();
    let disconnects = 0;
    const voices = new Map();
    const player = { guildId: "guild", voiceId: "voice", state: 2 };
    const client = {
        rainlink: {
            players,
            voices,
            create: async () => {
                players.set("guild", player);
                voices.set("guild", {
                    disconnect() {
                        disconnects++;
                    },
                });
                await wait;
                player.state = 0;
                return player;
            },
        },
    };
    installPlayerCreationGuard(client);
    const creation = client.rainlink.create({ guildId: "guild", voiceId: "voice" });
    await Promise.resolve();
    const cleanup = cleanupStalePlayerIfDisconnected(client, { id: "guild", members: { me: { voice: { channelId: null } } } });
    const prepare = prepareGuildForReconnect(client, "guild");
    release();
    assert.equal(await creation, player);
    assert.equal(await cleanup, player);
    assert.equal(await prepare, false);
    assert.equal(players.get("guild"), player);
    assert.equal(disconnects, 0);
});
