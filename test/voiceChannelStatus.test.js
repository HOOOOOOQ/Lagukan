const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
    musicStatus,
    resolveStatusEmoji,
    setPlaybackVoiceStatus,
    clearPlaybackVoiceStatus,
} = require("../src/functions/voiceChannelStatus.js");

function setup(guildId, channelId) {
    const client = new EventEmitter();
    const requests = [];
    client.rest = {
        put: async (route, body) => {
            requests.push({ route, ...body });
            client.emit("raw", { t: "VOICE_CHANNEL_STATUS_UPDATE", d: { guild_id: guildId, id: channelId, status: body.body.status } });
        },
    };
    const player = { guildId, voiceId: channelId, state: 0, paused: false, data: new Map() };
    return { client, player, requests };
}

test("formats custom emoji, handles long titles and avoids broken UTF-16", () => {
    assert.equal(
        musicStatus({ title: "Song", author: "Artist" }, false, "<a:music:123456789012345678>"),
        "<a:music:123456789012345678> Now Playing • Song — Artist",
    );
    assert.match(musicStatus({ title: "Song" }, true, "invalid"), /^🎵 Paused/);
    const status = musicStatus({ title: "😀".repeat(400) }, false, "");
    assert.ok(status.length <= 500);
    assert.ok(!/[\uD800-\uDBFF]$/.test(status));
});

test("sets, changes and clears only its own observed status", async () => {
    const { client, player, requests } = setup("guild-a", "voice-a");
    assert.equal(await setPlaybackVoiceStatus(client, player, { title: "First", author: "Singer" }), true);
    assert.match(requests[0].body.status, /Now Playing • First — Singer/);
    assert.equal(await setPlaybackVoiceStatus(client, player, { title: "First" }, { paused: true }), true);
    assert.match(requests[1].body.status, /Paused • First/);
    player.voiceId = ""; // Rainlink clears voiceId before emitting playerDestroy.
    assert.equal(await clearPlaybackVoiceStatus(client, player), true);
    assert.deepEqual(requests.at(-1), { route: "/channels/voice-a/voice-status", body: { status: null } });
});

test("manual changes and unobserved status are never cleared", async () => {
    const { client, player, requests } = setup("guild-b", "voice-b");
    await setPlaybackVoiceStatus(client, player, { title: "Track" });
    client.emit("raw", { t: "VOICE_CHANNEL_STATUS_UPDATE", d: { guild_id: "guild-b", id: "voice-b", status: "Member's status" } });
    assert.equal(await clearPlaybackVoiceStatus(client, player), false);
    assert.equal(requests.length, 1);
    const silent = setup("guild-c", "voice-c");
    silent.client.rest.put = async (route, options) => silent.requests.push({ route, ...options });
    await setPlaybackVoiceStatus(silent.client, silent.player, { title: "Track" });
    assert.equal(await clearPlaybackVoiceStatus(silent.client, silent.player), false);
    assert.equal(silent.requests.length, 1);
});

test("shared channel last owner wins and old player cannot clear it", async () => {
    const one = setup("guild-d", "voice-d");
    const player2 = { ...one.player, data: new Map() };
    await setPlaybackVoiceStatus(one.client, one.player, { title: "First" });
    await setPlaybackVoiceStatus(one.client, player2, { title: "Second" });
    assert.equal(await clearPlaybackVoiceStatus(one.client, one.player), false);
    assert.equal(await clearPlaybackVoiceStatus(one.client, player2), true);
    assert.equal(one.requests.length, 3);
});

test("rate queued writes preserve order and a missing permission does not break playback", async () => {
    const { client, player, requests } = setup("guild-e", "voice-e");
    let release;
    const firstPut = client.rest.put;
    client.rest.put = async (route, body) => {
        if (!requests.length)
            await new Promise((resolve) => {
                release = resolve;
            });
        return firstPut(route, body);
    };
    const first = setPlaybackVoiceStatus(client, player, { title: "One" });
    await new Promise((resolve) => setImmediate(resolve));
    const second = setPlaybackVoiceStatus(client, player, { title: "Two" });
    release();
    await Promise.all([first, second]);
    assert.match(requests[0].body.status, /One/);
    assert.match(requests[1].body.status, /Two/);
    const denied = setup("guild-f", "voice-f");
    denied.client.rest.put = async () => {
        throw Object.assign(new Error("Missing permissions"), { code: 50013 });
    };
    assert.equal(await setPlaybackVoiceStatus(denied.client, denied.player, { title: "Song" }), false);
});

test("guess-the-song does not leak the track in voice status", async () => {
    const { client, player, requests } = setup("guild-g", "voice-g");
    player.data.set("guessTheSongActive", true);
    assert.equal(await setPlaybackVoiceStatus(client, player, { title: "Secret" }), false);
    assert.equal(requests.length, 0);
});

test("Spotify1 name resolves local emoji before external matches and avoids ambiguous IDs", async () => {
    const { client, player, requests } = setup("guild-spotify", "voice-spotify");
    const local = { id: "123456789012345678", name: "Spotify1", animated: true, available: true };
    const external = { id: "234567890123456789", name: "Spotify1", available: true };
    client.guilds = { cache: new Map([[player.guildId, { emojis: { cache: new Map([[local.id, local]]) } }]]) };
    client.emojis = {
        cache: new Map([
            [local.id, local],
            [external.id, external],
        ]),
    };
    assert.equal(resolveStatusEmoji(client, player.guildId, ":Spotify1:"), "<a:Spotify1:123456789012345678>");
    assert.equal(await setPlaybackVoiceStatus(client, player, { title: "Song" }), true);
    assert.match(requests[0].body.status, /^<a:Spotify1:123456789012345678> Now Playing/);
    client.guilds.cache.clear();
    assert.equal(resolveStatusEmoji(client, player.guildId, ":Spotify1:"), null);
    client.emojis.cache.delete(external.id);
    assert.equal(resolveStatusEmoji(client, player.guildId, ":Spotify1:"), "<a:Spotify1:123456789012345678>");
    local.available = false;
    assert.equal(resolveStatusEmoji(client, player.guildId, ":Spotify1:"), null);
    assert.equal(resolveStatusEmoji(client, player.guildId, "<:Spotify1:345678901234567890>"), "<:Spotify1:345678901234567890>");
    assert.equal(await clearPlaybackVoiceStatus(client, player), true);
});

test("custom emoji rejected as invalid retries once with Unicode", async () => {
    const { client, player, requests } = setup("guild-invalid", "voice-invalid");
    const emoji = { id: "123456789012345678", name: "Spotify1", available: true };
    client.emojis = { cache: new Map([[emoji.id, emoji]]) };
    const send = client.rest.put;
    let count = 0;
    client.rest.put = async (route, body) => {
        if (++count === 1) throw Object.assign(new Error("invalid emoji"), { status: 400, code: 50035 });
        return send(route, body);
    };
    assert.equal(await setPlaybackVoiceStatus(client, player, { title: "Song" }), true);
    assert.equal(count, 2);
    assert.match(requests[0].body.status, /^🎵 Now Playing/);
    assert.equal(await clearPlaybackVoiceStatus(client, player), true);
});
