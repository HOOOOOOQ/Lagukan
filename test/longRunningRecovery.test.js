const test = require("node:test");
const assert = require("node:assert/strict");
const { initializeNodeHealthManager } = require("../src/functions/nodeHealthManager.js");
const {
    getAuto247Config,
    scheduleAuto247Reconnect,
    cancelAuto247Timer,
    MAX_BACKOFF_ATTEMPTS,
    LONG_OUTAGE_RETRY_MS,
} = require("../src/functions/auto247Manager.js");

function makeClient() {
    return {
        user: { id: "bot-long-running" },
        config: {},
        data: new Map(),
        auto247ConfigData: { db: { readyState: 1 } },
    };
}

test("failed config reads do not permanently cache a false missing config", async () => {
    const client = makeClient();
    let calls = 0;
    client.auto247ConfigData.findOne = async () => {
        if (++calls === 1) throw new Error("temporary database issue");
        return { botApplicationId: client.user.id, guildId: "guild", enabled: true, autoReconnect: true };
    };
    assert.equal(await getAuto247Config(client, "guild"), null);
    assert.equal(client._auto247Cache.has("guild"), false);
    assert.equal((await getAuto247Config(client, "guild")).enabled, true);
    assert.equal(calls, 2);
});

test("24/7 retries after fast attempts without a tight loop or duplicate timer", async () => {
    const client = makeClient();
    client.auto247ConfigData.findOne = async () => ({
        botApplicationId: client.user.id,
        guildId: "guild",
        enabled: true,
        autoReconnect: true,
    });
    await getAuto247Config(client, "guild");
    client._auto247Attempts.set("guild", MAX_BACKOFF_ATTEMPTS);
    const result = await scheduleAuto247Reconnect(client, "guild", "test", 0);
    assert.equal(result.scheduled, true);
    assert.equal(result.delayMs, LONG_OUTAGE_RETRY_MS);
    assert.equal(client._auto247Attempts.get("guild"), MAX_BACKOFF_ATTEMPTS);
    assert.equal((await scheduleAuto247Reconnect(client, "guild")).reason, "reconnect_already_scheduled");
    cancelAuto247Timer(client, "guild");
    assert.equal(client._auto247Timers.size, 0);
});

test("24/7 retries reading configuration after database recovers", async () => {
    const client = makeClient();
    client.auto247ConfigData.db.readyState = 0;
    const result = await scheduleAuto247Reconnect(client, "guild");
    assert.deepEqual(result, { scheduled: true, reason: "database_unavailable", delayMs: LONG_OUTAGE_RETRY_MS });
    assert.equal(client._auto247Cache.has("guild"), false);
    assert.equal((await scheduleAuto247Reconnect(client, "guild")).reason, "reconnect_already_scheduled");
    cancelAuto247Timer(client, "guild");
    client.auto247ConfigData.db.readyState = 1;
    client.auto247ConfigData.findOne = async () => null;
    assert.equal((await scheduleAuto247Reconnect(client, "guild")).reason, "auto_reconnect_disabled");
    assert.equal(client._auto247Timers.size, 0);
});

test("node recovery starts a fresh bounded burst after prolonged outage", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 1000000 });
    const oldInterval = process.env.LAVALINK_RECOVERY_INTERVAL;
    const oldCycles = process.env.LAVALINK_MAX_RECOVERY_CYCLES;
    process.env.LAVALINK_RECOVERY_INTERVAL = "30000";
    process.env.LAVALINK_MAX_RECOVERY_CYCLES = "2";
    const node = {
        state: 2,
        options: { name: "offline" },
        reconnects: 0,
        reconnect() {
            this.reconnects++;
        },
    };
    const client = { rainlink: { nodes: { all: () => [node] } } };
    try {
        initializeNodeHealthManager(client);
        t.mock.timers.tick(60000);
        assert.equal(node.reconnects, 2);
        t.mock.timers.tick(570000);
        assert.equal(node.reconnects, 2);
        t.mock.timers.tick(30000);
        assert.equal(node.reconnects, 3);
    } finally {
        clearInterval(client._nodeHealthTimer);
        if (oldInterval === undefined) delete process.env.LAVALINK_RECOVERY_INTERVAL;
        else process.env.LAVALINK_RECOVERY_INTERVAL = oldInterval;
        if (oldCycles === undefined) delete process.env.LAVALINK_MAX_RECOVERY_CYCLES;
        else process.env.LAVALINK_MAX_RECOVERY_CYCLES = oldCycles;
    }
});

test("a delayed 24/7 retry reloads config after a transient database error", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const client = makeClient();
    let calls = 0;
    client.auto247ConfigData.findOne = async () => {
        if (++calls === 1) throw new Error("temporary database error");
        return { botApplicationId: client.user.id, guildId: "guild", enabled: true, autoReconnect: true };
    };
    const scheduled = await scheduleAuto247Reconnect(client, "guild");
    assert.equal(scheduled.reason, "database_unavailable");
    t.mock.timers.tick(LONG_OUTAGE_RETRY_MS);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 2);
    assert.equal(client._auto247Cache.get("guild").enabled, true);
    assert.equal(client._auto247Timers.size, 1);
    cancelAuto247Timer(client, "guild");
});
