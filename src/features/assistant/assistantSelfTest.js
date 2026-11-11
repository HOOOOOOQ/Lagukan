const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Collection, PermissionsBitField } = require("discord.js");

const { extractAssistantInput, parseAssistantCommand } = require("./commandParser.js");
const { FALLBACK_UNKNOWN_MESSAGE, pickVariedResponse } = require("./responses.js");
const { getStoryCategoryCounts, pickStoryForUser } = require("./stories.js");
const { handleAssistantMessage, resetAssistantRateStateForTest } = require("./assistantHandler.js");

function createMockRainlinkEnvironment() {
    let createdPlayerCount = 0;
    const playersMap = new Map();

    function createPlayerObject({ guildId, voiceId, textId }) {
        createdPlayerCount += 1;
        const queueItems = [];
        const dataStore = new Map();

        const queue = new Proxy(queueItems, {
            get(target, prop) {
                if (prop === "current") return target._current || null;
                if (prop === "previous") {
                    if (!target._previous) target._previous = [];
                    return target._previous;
                }
                if (prop === "size") return target.length;
                if (prop === "isEmpty") return target.length === 0;
                if (prop === "add") {
                    return (item) => {
                        if (Array.isArray(item)) target.push(...item);
                        else target.push(item);
                    };
                }
                if (prop === "clear") {
                    return () => {
                        target.length = 0;
                    };
                }
                if (prop === "shuffle") {
                    return () => {
                        target.reverse();
                    };
                }
                const val = target[prop];
                return typeof val === "function" ? val.bind(target) : val;
            },
            set(target, prop, value) {
                if (prop === "current") {
                    target._current = value;
                    return true;
                }
                target[prop] = value;
                return true;
            },
        });

        const player = {
            guildId,
            voiceId,
            textId,
            playing: false,
            paused: false,
            volume: 100,
            loop: "none",
            position: 15000,
            state: 0, // RainlinkPlayerState.CONNECTED
            queue,
            data: dataStore,
            async play(trackArg) {
                const next = trackArg || queueItems.shift() || null;
                if (next) {
                    queue._current = next;
                    this.playing = true;
                    this.paused = false;
                }
                return this;
            },
            async pause() {
                this.paused = true;
                this.playing = false;
                return this;
            },
            async resume() {
                this.paused = false;
                this.playing = true;
                return this;
            },
            async skip() {
                if (queue._current) {
                    if (!queue._previous) queue._previous = [];
                    queue._previous.push(queue._current);
                }
                const next = queueItems.shift() || null;
                queue._current = next;
                this.playing = Boolean(next);
                this.paused = false;
                return this;
            },
            async stop() {
                queue._current = null;
                this.playing = false;
                this.paused = false;
                return this;
            },
            async setVolume(vol) {
                this.volume = vol;
                return this;
            },
            setLoop(mode) {
                this.loop = mode;
                return this;
            },
            destroy() {
                playersMap.delete(guildId);
            },
        };

        playersMap.set(guildId, player);
        return player;
    }

    const client = {
        user: {
            id: "111111111111111111",
            username: "Lagukan",
            displayAvatarURL: () => "https://cdn.discordapp.com/embed/avatars/0.png",
        },
        config: {
            botName: "Lagukan",
            embedColor: "#5865F2",
            defaultVolume: 100,
            minVolume: 1,
            maxVolume: 100,
            searchEngine: "youtube",
            dev: ["999999999999999999"],
        },
        data: new Map(),
        premium: new Map(),
        guildSettings: new Map(),
        ws: { ping: 42 },
        channels: {
            cache: new Collection(),
            fetch: async () => null,
        },
        guilds: {
            cache: new Collection(),
        },
        rainlink: {
            nodes: {
                all: () => [{ online: true, state: 0, options: { name: "MockNode", host: "127.0.0.1", port: 2333 } }],
                values: () => [{ online: true, state: 0, options: { name: "MockNode", host: "127.0.0.1", port: 2333 } }],
            },
            players: {
                get: (guildId) => playersMap.get(guildId) || null,
                has: (guildId) => playersMap.has(guildId),
            },
            create: async (opts) => {
                if (playersMap.has(opts.guildId)) {
                    return playersMap.get(opts.guildId);
                }
                return createPlayerObject(opts);
            },
            search: async (query, opts = {}) => {
                const clean = String(query)
                    .replace(/^[a-z]+search:/i, "")
                    .trim();
                return {
                    type: "SEARCH",
                    tracks: [
                        {
                            title: clean.includes("Sheila On 7") ? "Dan - Sheila On 7" : clean,
                            author: clean.includes("Sheila On 7") ? "Sheila On 7" : "Lagukan Studio",
                            duration: 215000,
                            isStream: false,
                            uri: `https://youtube.com/watch?v=${encodeURIComponent(clean.slice(0, 11))}`,
                            artworkUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
                            source: "youtube",
                            requester: opts.requester || null,
                        },
                    ],
                };
            },
        },
    };

    return {
        client,
        getCreatedPlayerCount: () => createdPlayerCount,
        getActivePlayer: (guildId) => playersMap.get(guildId) || null,
    };
}

function createMockMessage({ id, content, userId = "222222222222222222", voiceChannelId = "333333333333333333", isBot = false }) {
    const replies = [];
    const guildId = "444444444444444444";

    const voiceChannel = voiceChannelId
        ? {
              id: voiceChannelId,
              name: "Musik Lounge",
              permissionsFor: () => new PermissionsBitField([PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak]),
          }
        : null;

    const guild = {
        id: guildId,
        name: "Lagukan Community",
        shardId: 0,
        members: {
            me: {
                id: "111111111111111111",
                voice: { channelId: voiceChannelId },
            },
        },
    };

    const message = {
        id: id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        content,
        system: false,
        webhookId: null,
        channelId: "555555555555555555",
        channel: {
            id: "555555555555555555",
            send: async (payload) => {
                replies.push(payload);
                return { id: "sent_msg" };
            },
        },
        guild,
        author: {
            id: userId,
            username: "TesterUser",
            bot: isBot,
        },
        member: {
            id: userId,
            permissions: new PermissionsBitField([PermissionsBitField.Flags.SendMessages]),
            roles: { cache: new Collection() },
            voice: {
                channelId: voiceChannelId,
                channel: voiceChannel,
            },
        },
        reply: async (payload) => {
            replies.push(payload);
            return { id: `reply_${replies.length}` };
        },
    };

    return { message, replies };
}

async function runTests() {
    console.log("🔍 [1/5] Memeriksa kepatuhan Zero-External-AI & keamanan kode lokal...");
    const assistantDir = __dirname;
    const files = fs.readdirSync(assistantDir).filter((f) => f.endsWith(".js") && f !== "assistantSelfTest.js");
    for (const file of files) {
        const src = fs.readFileSync(path.join(assistantDir, file), "utf8");
        assert(!/\b(openai|anthropic|gemini|groq|cohere)\b/i.test(src), `Ditemukan referensi AI eksternal pada ${file}`);
        assert(!/\baxios\b/.test(src), `Tidak boleh ada panggilan HTTP eksternal (axios) pada ${file}`);
        assert(!/\bfetch\s*\(/.test(src), `Tidak boleh ada panggilan fetch eksternal pada ${file}`);
    }

    console.log("📚 [2/5] Memvalidasi koleksi cerita lokal (minimal 10 cerita per kategori)...");
    const counts = getStoryCategoryCounts();
    const expectedCategories = ["dongeng", "horor", "romantis", "lucu", "fantasi", "pendek"];
    for (const cat of expectedCategories) {
        assert(counts[cat] >= 10, `Kategori cerita '${cat}' harus memiliki >= 10 cerita (ditemukan: ${counts[cat]})`);
        const seenIds = new Set();
        for (let i = 0; i < 10; i += 1) {
            const picked = pickStoryForUser("story_tester_1", cat);
            assert(picked.story.title && picked.story.content.length > 80, `Cerita pada ${cat} harus berjudul & lengkap`);
            seenIds.add(picked.story.id);
        }
        assert.equal(seenIds.size, 10, `10 pemanggilan berurutan pada '${cat}' tidak boleh mengulang cerita yang sama`);
    }

    console.log("🧠 [3/5] Menguji fleksibilitas parser bahasa alami & pemisahan prefix 666!cek...");
    assert.equal(extractAssistantInput("666!cek").triggered, false, "666!cek tidak boleh ditangkap oleh 666 Text Assistant");
    assert.equal(extractAssistantInput("666!reload").triggered, false, "666! prefix dev tidak boleh ditangkap");
    assert.equal(parseAssistantCommand("666 play Teh Hijau").query, "Teh Hijau");
    assert.equal(parseAssistantCommand("666 putar lagu Sheila On 7").query, "Sheila On 7");
    assert.equal(parseAssistantCommand("666 sekarang putar apa").action, "nowplaying");
    assert.equal(parseAssistantCommand("666 volume 50").value, 50);

    console.log("🎵 [4/5] Menguji seluruh 13+ perintah wajib secara End-to-End dengan Rainlink Player...");
    resetAssistantRateStateForTest();
    const { client, getCreatedPlayerCount, getActivePlayer } = createMockRainlinkEnvironment();

    async function send666(content, opts = {}) {
        const { message, replies } = createMockMessage({ content, ...opts });
        const handled = await handleAssistantMessage(client, message, { bypassRateLimit: true });
        return { handled, replies, embed: replies[0]?.embeds?.[0]?.data || null };
    }

    // Uji error bersih saat user belum di voice channel
    const noVcPlay = await send666("666 play Teh Hijau", { voiceChannelId: null });
    assert.equal(noVcPlay.handled, true);
    assert.match(noVcPlay.embed.title, /Voice Channel/i);

    // 1. 666 play Teh Hijau
    const play1 = await send666("666 play Teh Hijau");
    assert.equal(play1.handled, true);
    assert.match(play1.embed.title, /Mulai Memutar Musik/);
    assert.match(play1.embed.description, /Teh Hijau/);
    assert.equal(getCreatedPlayerCount(), 1, "Hanya boleh membuat 1 instance player untuk guild");

    // 2. 666 putar lagu Sheila On 7 (enqueue ke player aktif tanpa membuat player kedua!)
    const play2 = await send666("666 putar lagu Sheila On 7");
    assert.match(play2.embed.title, /Ditambahkan ke Antrean/);
    assert.match(play2.embed.description, /Sheila On 7/);
    assert.equal(getCreatedPlayerCount(), 1, "Tidak boleh membuat player musik kedua saat enqueue");

    // 3. 666 sekarang putar apa
    const npRes = await send666("666 sekarang putar apa");
    assert.match(npRes.embed.title, /Sedang Diputar Sekarang/);
    assert.match(npRes.embed.description, /Teh Hijau/);

    // 4. 666 queue
    const qRes = await send666("666 queue");
    assert.match(qRes.embed.title, /Daftar Antrean Musik/);
    assert.match(qRes.embed.description, /Teh Hijau/);
    assert.match(qRes.embed.description, /Sheila On 7/);

    // 5. 666 pause
    const pauseRes = await send666("666 pause");
    assert.match(pauseRes.embed.title, /Musik Berhasil Dijeda/);
    assert.equal(getActivePlayer("444444444444444444").paused, true);

    // 6. 666 resume
    const resumeRes = await send666("666 resume");
    assert.match(resumeRes.embed.title, /Pemutaran Musik Dilanjutkan/);
    assert.equal(getActivePlayer("444444444444444444").paused, false);

    // 7. 666 volume 50
    const volRes = await send666("666 volume 50");
    assert.match(volRes.embed.title, /Volume Berhasil Diatur/);
    assert.equal(getActivePlayer("444444444444444444").volume, 50);

    // 8. 666 skip (berpindah dari Teh Hijau ke Sheila On 7)
    const skipRes = await send666("666 skip");
    assert.match(skipRes.embed.title, /Lagu Berhasil Dilewati/);
    assert.match(getActivePlayer("444444444444444444").queue.current.title, /Sheila On 7/);

    // 9. 666 stop
    const stopRes = await send666("666 stop");
    assert.match(stopRes.embed.title, /Pemutaran Musik Dihentikan/);
    assert.equal(getActivePlayer("444444444444444444").playing, false);
    assert.equal(getActivePlayer("444444444444444444").queue.current, null);

    // 10. 666 halo (percakapan bervariasi)
    const halo1 = await send666("666 halo");
    const halo2 = await send666("666 halo");
    assert.equal(halo1.handled, true);
    assert.notEqual(halo1.embed.description, halo2.embed.description, "Respons percakapan berurutan harus bervariasi");

    // 11. 666 siapa kamu (identitas jujur tanpa klaim AI generatif)
    const whoRes = await send666("666 siapa kamu");
    assert.match(whoRes.embed.description, /666/);
    assert.match(whoRes.embed.description, /tanpa|lokal/i);

    // 12. 666 dongengin aku & 666 cerita horor (+ kategori cerita lainnya)
    const dongengRes = await send666("666 dongengin aku");
    assert.match(dongengRes.embed.title, /Dongeng/);
    const hororRes = await send666("666 cerita horor");
    assert.match(hororRes.embed.title, /Cerita Horor/);
    const romantisRes = await send666("666 cerita romantis");
    assert.match(romantisRes.embed.title, /Cerita Romantis/);
    const lucuRes = await send666("666 cerita lucu");
    assert.match(lucuRes.embed.title, /Cerita Lucu/);
    const fantasiRes = await send666("666 cerita fantasi");
    assert.match(fantasiRes.embed.title, /Cerita Fantasi/);
    const pendekRes = await send666("666 buat cerita pendek");
    assert.match(pendekRes.embed.title, /Cerita Pendek/);

    // 13. 666 help
    const helpRes = await send666("666 help");
    assert.match(helpRes.embed.title, /Panduan Lengkap 666 Text Assistant/);
    assert.match(helpRes.embed.description, /666 play/);
    assert.match(helpRes.embed.description, /666 dongengin aku/);

    // Fallback untuk perintah yang tidak dikenali
    const unknownRes = await send666("666 hitung orbit planet neptunus");
    assert.equal(unknownRes.embed.description, FALLBACK_UNKNOWN_MESSAGE);

    console.log("🛡️ [5/5] Menguji keamanan anti-bot, anti-duplikat pesan, dan rate-limiter...");
    resetAssistantRateStateForTest();
    // Bot message diabaikan
    const botMsg = createMockMessage({ content: "666 halo", isBot: true });
    assert.equal(await handleAssistantMessage(client, botMsg.message), false);
    assert.equal(botMsg.replies.length, 0);

    // Pesan dengan ID yang sama tidak pernah dibalas dua kali
    const dupMsg = createMockMessage({ id: "fixed_msg_id_001", content: "666 apa kabar" });
    await handleAssistantMessage(client, dupMsg.message);
    await handleAssistantMessage(client, dupMsg.message);
    assert.equal(dupMsg.replies.length, 1, "Pesan yang sama tidak boleh direspons dua kali");

    // Variasi respons percakapan tambahan
    assert(pickVariedResponse("u1", "thanks").length > 5);
    assert(pickVariedResponse("u1", "compliment").length > 5);
    assert(pickVariedResponse("u1", "night").length > 5);

    console.log("✅ Semua pengujian 666 Text Assistant LULUS 100% tanpa error!");
}

runTests().catch((err) => {
    console.error("❌ Pengujian 666 Text Assistant GAGAL:", err);
    process.exit(1);
});

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
