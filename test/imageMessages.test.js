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
    assert.equal(result.files[0].name, "666-music-response-1.png");
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
            ["3", { id: "3", name: "666-music-response-1.png" }],
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
    assert.equal(converted.files.length, 1);
    assert.equal(converted.files[0].name, "666-music-response-1.png");
    assert.match(converted.files[0].description, /Song/);
    assert.match(converted.files[0].description, /Elapsed \/ Remaining/);
    assert.ok(converted.components.length > 0);
});

test("joined and leaving use the member avatar and preserve voice details", async () => {
    const { buildVoiceActivityEmbed } = require("../src/functions/voiceLogger.js");
    const { renderSvgToPngBuffer } = require("../src/functions/cardRenderer666.js");
    const red = await renderSvgToPngBuffer(
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="red"/></svg>',
    );
    const blue = await renderSvgToPngBuffer(
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="blue"/></svg>',
    );
    const previous = global.fetch;
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url: String(url), options });
        const image = String(url).includes("hashred") ? red : blue;
        return {
            ok: true,
            headers: new Headers({ "content-type": "image/png" }),
            body: (async function* () {
                yield image;
            })(),
        };
    };
    try {
        const makeEmbed = (type, hash) =>
            buildVoiceActivityEmbed(
                { user: { displayAvatarURL: () => "https://cdn.discordapp.com/avatars/1/bot.png" } },
                {
                    type,
                    user: { id: "123456789012345678", username: "listener" },
                    member: {
                        displayAvatarURL: (options) => {
                            assert.equal(options.forceStatic, false);
                            return `https://cdn.discordapp.com/guilds/42/users/123456789012345678/avatars/${hash}.webp?size=1024`;
                        },
                    },
                    channelName: "Music Lounge",
                    timeString: "17:24 WIB",
                },
            ).setTimestamp(new Date("2026-01-01T00:00:00Z"));
        for (const type of ["JOINED", "LEAVING"]) {
            const first = await toImagePayload({ embeds: [makeEmbed(type, "hashred")] });
            const second = await toImagePayload({ embeds: [makeEmbed(type, "hashblue")] });
            assert.notDeepEqual(first.files[0].attachment, second.files[0].attachment);
            assert.match(first.files[0].description, /123456789012345678/);
            assert.match(first.files[0].description, /@listener/);
            assert.match(first.files[0].description, /Music Lounge/);
            assert.match(first.files[0].description, /2026-01-01T00:00:00.000Z/);
        }
        assert.equal(calls.length, 2, "avatar cache is reused for join and leave");
        assert.equal(calls[0].url, "https://cdn.discordapp.com/guilds/42/users/123456789012345678/avatars/hashred.png?size=256");
        assert.equal(calls[0].options.redirect, "error");
    } finally {
        global.fetch = previous;
    }
});

test("untrusted or missing avatars use the generic user icon, never the bot avatar", async () => {
    const { buildVoiceActivityEmbed } = require("../src/functions/voiceLogger.js");
    const previous = global.fetch;
    let calls = 0;
    global.fetch = async () => {
        calls++;
        throw new Error("unexpected fetch");
    };
    try {
        const args = {
            type: "JOINED",
            user: { id: "123456789012345678", username: "listener" },
            channelName: "Music Lounge",
            timeString: "17:24 WIB",
        };
        const client = { user: { displayAvatarURL: () => "https://cdn.discordapp.com/avatars/1/bot.png" } };
        const noAvatar = buildVoiceActivityEmbed(client, args).setTimestamp(new Date("2026-01-01T00:00:00Z"));
        assert.equal(noAvatar.toJSON().thumbnail, undefined);
        const baseline = await toImagePayload({ embeds: [noAvatar] });
        const untrusted = buildVoiceActivityEmbed(client, args)
            .setThumbnail("https://example.com/avatar.png")
            .setTimestamp(new Date("2026-01-01T00:00:00Z"));
        const rejected = await toImagePayload({ embeds: [untrusted] });
        assert.deepEqual(rejected.files[0].attachment, baseline.files[0].attachment);
        assert.equal(calls, 0);
    } finally {
        global.fetch = previous;
    }
});

test("default Discord avatars and long voice text render without dropping information", async () => {
    const { buildVoiceActivityEmbed } = require("../src/functions/voiceLogger.js");
    const { renderSvgToPngBuffer } = require("../src/functions/cardRenderer666.js");
    const image = await renderSvgToPngBuffer(
        '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>',
    );
    const previous = global.fetch;
    let fetched;
    global.fetch = async (url) => {
        fetched = String(url);
        return {
            ok: true,
            headers: new Headers({ "content-type": "image/png" }),
            body: (async function* () {
                yield image;
            })(),
        };
    };
    try {
        const embed = buildVoiceActivityEmbed(
            { user: {} },
            {
                type: "LEAVING",
                user: {
                    id: "123456789012345678",
                    username: "listener",
                    displayAvatarURL: () => "https://cdn.discordapp.com/embed/avatars/3.png",
                },
                channelName: "A".repeat(100),
                timeString: "17:24 WIB",
            },
        );
        const result = await toImagePayload({ embeds: [embed] });
        assert.equal(fetched, "https://cdn.discordapp.com/embed/avatars/3.png?size=256");
        assert.match(result.files[0].description, /A{30}/);
        assert.ok(result.files[0].attachment.readUInt32BE(20) > 330, "long content uses paginated fallback with the avatar");
    } finally {
        global.fetch = previous;
    }
});

test("failed or oversized Discord avatar responses fall back safely", async () => {
    const { buildVoiceActivityEmbed } = require("../src/functions/voiceLogger.js");
    const previous = global.fetch;
    let calls = 0;
    global.fetch = async () => {
        calls++;
        return {
            ok: true,
            headers: new Headers({ "content-type": "image/png", "content-length": "524289" }),
            body: (async function* () {
                throw new Error("must not read oversized image");
            })(),
        };
    };
    try {
        const args = {
            type: "LEAVING",
            user: { id: "123456789012345678", username: "listener" },
            channelName: "Music Lounge",
            timeString: "17:24 WIB",
        };
        const client = { user: {} };
        const empty = buildVoiceActivityEmbed(client, args).setTimestamp(new Date("2026-01-01T00:00:00Z"));
        const baseline = await toImagePayload({ embeds: [empty] });
        const large = buildVoiceActivityEmbed(client, args)
            .setThumbnail("https://cdn.discordapp.com/avatars/123456789012345678/oversized.png")
            .setTimestamp(new Date("2026-01-01T00:00:00Z"));
        const result = await toImagePayload({ embeds: [large] });
        assert.deepEqual(result.files[0].attachment, baseline.files[0].attachment);
        assert.equal(calls, 1);
        const wrongPath = buildVoiceActivityEmbed(client, args)
            .setThumbnail("https://cdn.discordapp.com/icons/1/icon.png")
            .setTimestamp(new Date("2026-01-01T00:00:00Z"));
        const rejected = await toImagePayload({ embeds: [wrongPath] });
        assert.deepEqual(rejected.files[0].attachment, baseline.files[0].attachment);
        assert.equal(calls, 1);
    } finally {
        global.fetch = previous;
    }
});

test("long queue titles and artists retain the structured card without losing metadata", async () => {
    const embed = new EmbedBuilder()
        .setAuthor({ name: "Added to Queue" })
        .setDescription(
            "**[A beautiful song with a very long title for a beautiful afternoon](https://example.com/song)**\nby **A wonderful artist featuring a very special guest**",
        )
        .addFields({ name: "Duration", value: "03:42" }, { name: "Source", value: "Spotify" }, { name: "Queue Position", value: "#3" });
    const result = await toImagePayload({ embeds: [embed] });
    assert.equal(result.files.length, 1);
    assert.ok(result.files[0].attachment.readUInt32BE(20) > 354);
    assert.match(result.files[0].description, /beautiful\s+afternoon/);
    assert.match(result.files[0].description, /special guest/);
    assert.match(result.files[0].description, /Spotify/);
    assert.match(result.files[0].description, /Queue Position\n#3/);
});

test("profile and leaderboard cards reflect current names even when stats are unchanged", async () => {
    const { renderLeaderboardCard666, renderUserProfileCard666 } = require("../src/functions/cardRenderer666.js");
    const entry = { rank: 1, userId: "123", username: "Before", hoursText: "1.00", totalPlays: 2 };
    const firstLeaderboard = await renderLeaderboardCard666({ guildId: "cache-test", guildName: "Guild", entries: [entry] });
    const secondLeaderboard = await renderLeaderboardCard666({
        guildId: "cache-test",
        guildName: "Guild",
        entries: [{ ...entry, username: "After" }],
    });
    assert.notDeepEqual(firstLeaderboard, secondLeaderboard);
    const firstProfile = await renderUserProfileCard666({ guildId: "cache-test", userId: "123", guildName: "Before" });
    const secondProfile = await renderUserProfileCard666({ guildId: "cache-test", userId: "123", guildName: "After" });
    assert.notDeepEqual(firstProfile, secondProfile);
    for (const card of [firstLeaderboard, secondLeaderboard, firstProfile, secondProfile])
        assert.equal(card.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
});

test("oversized responses keep the original message instead of exceeding Discord's attachment limit", async () => {
    const input = { content: Array.from({ length: 381 }, (_, i) => `line ${i}`).join("\n"), components: [] };
    assert.equal(await toImagePayload(input), input);
});

test("now playing image and metadata become one attachment on send and edit", async () => {
    const { AttachmentBuilder } = require("discord.js");
    const { renderNowPlayingCard666 } = require("../src/functions/cardRenderer666.js");
    const image = await renderNowPlayingCard666({
        botId: "single-card-test",
        title: "Song title",
        author: "Artist",
        elapsedText: "01:00",
        durationText: "03:00",
        progressRatio: 1 / 3,
    });
    const embed = new EmbedBuilder()
        .setAuthor({ name: "666 • Music Bot • Now Playing" })
        .setDescription(
            "**[Song title](https://example.com/song)**\n👤 **Artist:** Artist • 💿 **Album:** Album • `▶️ Playing`\n\n`01:00` ▰▰●▱▱ `03:00`",
        )
        .addFields(
            { name: "Requested By", value: "<@123456789012345678>" },
            { name: "Duration", value: "03:00" },
            { name: "Elapsed / Remaining", value: "01:00 / -02:00" },
            { name: "Bot", value: "Music Bot" },
            { name: "Source", value: "YouTube" },
            { name: "Queue", value: "2 tracks" },
            { name: "Volume", value: "50%" },
            { name: "Loop", value: "Off" },
            { name: "Autoplay", value: "On" },
        )
        .setFooter({ text: "Music engine" })
        .setImage("attachment://666-nowplaying.png");
    const components = [{ type: 1, components: [{ type: 2, style: 1, label: "Pause", custom_id: "pause" }] }];
    const input = { embeds: [embed], files: [new AttachmentBuilder(image, { name: "666-nowplaying.png" })], components };
    const sent = await toImagePayload(input);
    assert.equal(sent.files.length, 1);
    assert.equal(sent.files[0].name, "666-music-response-1.png");
    assert.equal(sent.embeds.length, 0);
    assert.equal(sent.components, components);
    assert.match(sent.files[0].description, /Song title/);
    assert.match(sent.files[0].description, /https:\/\/example.com\/song/);
    assert.match(sent.files[0].description, /Elapsed \/ Remaining/);
    assert.match(sent.files[0].description, /YouTube/);
    assert.ok(sent.files[0].attachment.readUInt32BE(20) > image.readUInt32BE(20));
    const message = {
        attachments: new Map([
            ["1", { id: "1", name: "666-nowplaying.png" }],
            ["2", { id: "2", name: "lagukan-response-1.png" }],
            ["3", { id: "3", name: "other.pdf" }],
        ]),
    };
    const edited = await toImagePayload(input, { edit: true, message });
    assert.equal(edited.files.length, 1);
    assert.deepEqual(edited.attachments, [{ id: "3" }]);
});

test("profile and leaderboard cards with details also stay in one image", async () => {
    const { AttachmentBuilder } = require("discord.js");
    const { renderSvgToPngBuffer } = require("../src/functions/cardRenderer666.js");
    const image = await renderSvgToPngBuffer(
        '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#150D13"/></svg>',
    );
    for (const name of ["666-profile.png", "666-leaderboard.png"]) {
        const embed = new EmbedBuilder()
            .setTitle("User profile")
            .setDescription("Original details")
            .addFields({ name: "Plays", value: "42" })
            .setImage(`attachment://${name}`);
        const output = await toImagePayload({ embeds: [embed], files: [new AttachmentBuilder(image, { name })] });
        assert.equal(output.files.length, 1);
        assert.match(output.files[0].description, /User profile/);
        assert.match(output.files[0].description, /42/);
    }
});

test("missing player card removes stale dashboard image but keeps unrelated attachments", async () => {
    const embed = new EmbedBuilder().setDescription("Playback details still available").setImage("attachment://666-nowplaying.png");
    const message = {
        attachments: new Map([
            ["1", { id: "1", name: "666-nowplaying.png" }],
            ["2", { id: "2", name: "other.pdf" }],
        ]),
    };
    const result = await toImagePayload({ embeds: [embed] }, { edit: true, message });
    assert.deepEqual(result.attachments, [{ id: "2" }]);
    assert.equal(result.files.length, 1);
    assert.match(result.files[0].description, /Playback details still available/);
});
