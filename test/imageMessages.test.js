const test = require("node:test");
const assert = require("node:assert/strict");
const { EmbedBuilder, MessageFlags } = require("discord.js");
const { toImagePayload, extractLines } = require("../src/functions/imageMessageRenderer.js");
const { safeReply, safeEditReply } = require("../src/functions/interactionResponder.js");

test("renders content and embed as PNG while preserving components", async () => {
    const components = [{ type: 1, components: [{ type: 2, style: 1, label: "Pause", custom_id: "pause" }] }];
    const embed = new EmbedBuilder()
        .setTitle("Joined")
        .setDescription("@listener joined Music Voice")
        .addFields({ name: "Jam", value: "17:24 WIB" });
    const result = await toImagePayload({ content: "Log aktivitas", embeds: [embed], components });
    assert.equal(result.content, "");
    assert.deepEqual(result.embeds, []);
    assert.equal(result.components, components);
    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].name, "lagukan-response-1.png");
    assert.equal(result.files[0].attachment.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.ok(extractLines({ embeds: [embed] }).includes("@listener joined Music Voice"));
});

test("ephemeral responses are deferred privately before image rendering", async () => {
    const calls = [];
    const interaction = {
        client: { _lagukanImageMessages: true },
        deferred: false,
        replied: false,
        deferReply: async function (options) {
            calls.push(["defer", options]);
            this.deferred = true;
        },
        editReply: async function (payload) {
            calls.push(["edit", payload]);
            this.replied = true;
            return { attachments: new Map() };
        },
    };
    await safeReply(interaction, { content: "Private error", flags: MessageFlags.Ephemeral });
    assert.equal(calls[0][0], "defer");
    assert.equal(calls[0][1].flags, MessageFlags.Ephemeral);
    assert.equal(calls[1][0], "edit");
    assert.equal(calls[1][1].content, "");
    assert.equal(calls[1][1].files.length, 1);
});

test("edits replace generated card without deleting other image attachments", async () => {
    const existing = {
        attachments: new Map([
            ["1", { id: "1", name: "lagukan-response-1.png" }],
            ["2", { id: "2", name: "cover.png" }],
        ]),
    };
    const result = await toImagePayload(
        { embeds: [new EmbedBuilder().setDescription("Changed")], components: [] },
        { edit: true, message: existing },
    );
    assert.deepEqual(result.attachments, [{ id: "2" }]);
    assert.deepEqual(result.components, []);
    assert.equal(result.files.length, 1);
});

test("component-only edits keep existing message attachments untouched", async () => {
    const input = { components: [] };
    assert.equal(await toImagePayload(input, { edit: true }), input);
});

test("safe edit renders a PNG and keeps existing files", async () => {
    let sent;
    const interaction = {
        client: { _lagukanImageMessages: true },
        deferred: true,
        replied: false,
        editReply: async (payload) => {
            sent = payload;
            return { attachments: new Map() };
        },
    };
    const existing = new (require("discord.js").AttachmentBuilder)(Buffer.from("x"), { name: "existing.png" });
    await safeEditReply(interaction, { content: "Ready", files: [existing] });
    assert.equal(sent.files[0], existing);
    assert.equal(sent.files.length, 2);
    assert.deepEqual(sent.embeds, []);
});

test("direct channel sends and message edits are converted only for opted-in clients", async () => {
    const discord = require("discord.js");
    const { installImageMessageHandlers } = require("../src/functions/imageMessageRenderer.js");
    let channelProto = discord.TextChannel.prototype;
    while (channelProto && !Object.prototype.hasOwnProperty.call(channelProto, "send")) channelProto = Object.getPrototypeOf(channelProto);
    const originalSend = channelProto.send;
    const originalEdit = discord.Message.prototype.edit;
    channelProto.send = async function (payload) {
        return payload;
    };
    discord.Message.prototype.edit = async function (payload) {
        return payload;
    };
    try {
        const client = {};
        installImageMessageHandlers(client);
        const sent = await channelProto.send.call({ client }, { content: "Voice joined" });
        assert.equal(sent.content, "");
        assert.equal(sent.files[0].attachment.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
        const ordinary = { content: "untouched" };
        assert.equal(await channelProto.send.call({ client: {} }, ordinary), ordinary);
        const edited = await discord.Message.prototype.edit.call({ client, attachments: new Map() }, { content: "Updated" });
        assert.equal(edited.content, "");
        assert.equal(edited.files.length, 1);
    } finally {
        channelProto.send = originalSend;
        discord.Message.prototype.edit = originalEdit;
    }
});

test("long responses produce multiple image pages without dropping lines", async () => {
    const content = Array.from({ length: 70 }, (_, i) => `line ${i + 1}`).join("\n");
    const lines = extractLines({ content });
    assert.equal(lines.length, 70);
    const result = await toImagePayload({ content });
    assert.equal(result.files.length, 2);
    assert.match(result.files[0].description, /line 1/);
    assert.match(result.files[1].description, /line 70/);
});

test("voice cards preserve identity, channel and timestamp in accessible text", async () => {
    const { buildVoiceActivityEmbed } = require("../src/functions/voiceLogger.js");
    for (const type of ["JOINED", "LEAVING"]) {
        const embed = buildVoiceActivityEmbed(
            { user: {} },
            { type, user: { id: "123456789012345678", username: "listener" }, channelName: "Music Lounge", timeString: "17:24 WIB" },
        );
        const result = await toImagePayload({ embeds: [embed] });
        const description = result.files[0].description;
        assert.match(description, /123456789012345678/);
        assert.match(description, /@listener/);
        assert.match(description, /Music Lounge/);
        assert.match(description, /17:24 WIB/);
        assert.match(description, /\d{4}-\d\d-\d\dT/);
        assert.match(description, type === "JOINED" ? /Joined/ : /Leaving/);
    }
});

test("queue artwork uses allowed CDN only, without redirects and retains metadata", async () => {
    const previous = global.fetch;
    const { renderSvgToPngBuffer } = require("../src/functions/cardRenderer666.js");
    const image = await renderSvgToPngBuffer(
        '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>',
    );
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url: String(url), options });
        return {
            ok: true,
            headers: new Headers({ "content-type": "image/png" }),
            body: (async function* () {
                yield image;
            })(),
        };
    };
    try {
        const embed = new EmbedBuilder()
            .setAuthor({ name: "Added to Queue" })
            .setDescription("Song by Artist")
            .addFields({ name: "Duration", value: "3:24" }, { name: "Source", value: "YouTube" }, { name: "Queue Position", value: "#3" })
            .setThumbnail("https://i.ytimg.com/vi/example/default.jpg");
        const withImage = await toImagePayload({ embeds: [embed] });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].options.redirect, "error");
        assert.match(withImage.files[0].description, /Song by Artist/);
        assert.match(withImage.files[0].description, /Queue Position\n#3/);
        const height = withImage.files[0].attachment.readUInt32BE(20);
        embed.setThumbnail("https://example.com/image.png");
        const withoutImage = await toImagePayload({ embeds: [embed] });
        assert.equal(calls.length, 1);
        assert.equal(height - withoutImage.files[0].attachment.readUInt32BE(20), 154);
    } finally {
        global.fetch = previous;
    }
});

test("now playing card cache differentiates paused and playing states", async () => {
    const { renderNowPlayingCard666 } = require("../src/functions/cardRenderer666.js");
    const data = { botId: "test-pause-cache", trackKey: "one", title: "Song", author: "Artist", requester: "Listener" };
    const playing = await renderNowPlayingCard666({ ...data, isPaused: false });
    const paused = await renderNowPlayingCard666({ ...data, isPaused: true });
    assert.equal(playing.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.notDeepEqual(playing, paused);
});

test("reference queue layout displays actual metadata with artwork and retains links", async () => {
    const previous = global.fetch;
    const { renderSvgToPngBuffer } = require("../src/functions/cardRenderer666.js");
    const image = await renderSvgToPngBuffer(
        '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>',
    );
    global.fetch = async () => ({
        ok: true,
        headers: new Headers({ "content-type": "image/png" }),
        body: (async function* () {
            yield image;
        })(),
    });
    try {
        const embed = new EmbedBuilder()
            .setAuthor({ name: "Added to Queue" })
            .setDescription("**[Track title](https://example.com/song)**\nby **Artist**")
            .addFields({ name: "Duration", value: "3:24" }, { name: "Source", value: "YouTube" }, { name: "Queue Position", value: "#3" })
            .setThumbnail("https://i.ytimg.com/vi/example/default.jpg");
        const result = await toImagePayload({ embeds: [embed] });
        assert.equal(result.files[0].attachment.readUInt32BE(20), 354);
        assert.match(result.files[0].description, /Track title \(https:\/\/example.com\/song\)/);
        assert.match(result.files[0].description, /Artist/);
        assert.match(result.files[0].description, /Queue Position\n#3/);
    } finally {
        global.fetch = previous;
    }
});

test("dashboard refresh updates playback snapshot while retaining unrelated files", async () => {
    const { refreshNowPlayingDashboard } = require("../src/functions/nowPlayingManager.js");
    const calls = [];
    const client = { user: { id: "test", username: "bot" }, config: {}, data: new Map() };
    const track = { title: "Song", author: "Artist", duration: 100000, uri: "https://example.com/song" };
    const message = {
        attachments: new Map([
            ["1", { id: "1", name: "666-nowplaying.png" }],
            ["2", { id: "2", name: "other.png" }],
            ["3", { id: "3", name: "lagukan-response-1.png" }],
        ]),
        edit: async (payload) => calls.push(payload),
    };
    const player = {
        guildId: "123",
        queue: { current: track, size: 0 },
        data: new Map(),
        paused: false,
        playing: true,
        position: 10000,
        _has666CardAttachment: true,
        message,
    };
    assert.equal(await refreshNowPlayingDashboard(client, player), true);
    player.position = 30000;
    assert.equal(await refreshNowPlayingDashboard(client, player), true);
    assert.deepEqual(calls[0].attachments, [{ id: "2" }]);
    assert.notDeepEqual(calls[0].files[0].attachment, calls[1].files[0].attachment);
    const converted = await toImagePayload(calls[0], { edit: true, message });
    assert.deepEqual(converted.attachments, [{ id: "2" }]);
    assert.equal(converted.files[0].name, "666-nowplaying.png");
    assert.ok(converted.components.length > 0);
});
