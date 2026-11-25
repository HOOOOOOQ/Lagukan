const test = require("node:test");
const assert = require("node:assert/strict");
const discord = require("discord.js");
const { installImageMessageHandlers } = require("../src/functions/imageMessageRenderer.js");
const { handleVoiceStateLog } = require("../src/functions/voiceLogger.js");

test("joined and leaving logs go through the installed send wrapper as native embeds", async () => {
    let proto = discord.VoiceChannel.prototype;
    while (proto && !Object.prototype.hasOwnProperty.call(proto, "send")) proto = Object.getPrototypeOf(proto);
    const original = proto.send;
    const sent = [];
    proto.send = async function (payload) {
        sent.push(payload);
        return payload;
    };
    try {
        const client = {
            user: { id: "bot", displayAvatarURL: () => "https://cdn.discordapp.com/avatars/1/bot.png" },
            config: {},
            data: new Map(),
        };
        installImageMessageHandlers(client);
        const flags = [];
        const channel = {
            id: "voice",
            guildId: "guild-embed-test",
            type: discord.ChannelType.GuildVoice,
            name: "Music Lounge",
            client,
            send: proto.send,
            permissionsFor: () => ({
                has: (flag) => {
                    flags.push(flag);
                    return flag !== discord.PermissionsBitField.Flags.AttachFiles;
                },
            }),
        };
        const guild = { id: channel.guildId, name: "Test", members: { me: { voice: { channelId: channel.id } } } };
        const user = {
            id: "123456789012345678",
            username: "listener",
            displayAvatarURL: () => "https://cdn.discordapp.com/avatars/123456789012345678/a_hash.gif",
        };
        const member = { user };
        const outside = { guild, id: user.id, member, channelId: null };
        const inside = { guild, id: user.id, member, channelId: channel.id, channel };
        await handleVoiceStateLog(client, outside, inside);
        await handleVoiceStateLog(client, inside, outside);
        assert.equal(sent.length, 2);
        for (const [index, payload] of sent.entries()) {
            const embed = payload.embeds[0].toJSON();
            assert.equal(payload.files, undefined);
            assert.equal(embed.title, index === 0 ? "🎙️ Joined" : "🎙️ Leaving");
            assert.equal(embed.color, index === 0 ? 0x22c55e : 0xef4444);
            assert.match(embed.description, /<@123456789012345678>/);
            assert.match(embed.description, /@listener/);
            assert.match(embed.description, /Music Lounge/);
            assert.match(embed.description, /WIB/);
            assert.equal(embed.thumbnail.url, user.displayAvatarURL());
            assert.equal(embed.footer.text, "666 MUSIC VOICE SYSTEM");
            assert.ok(embed.timestamp);
            assert.deepEqual(payload.allowedMentions, { parse: [] });
        }
        assert.ok(flags.includes(discord.PermissionsBitField.Flags.EmbedLinks));
        assert.ok(!flags.includes(discord.PermissionsBitField.Flags.AttachFiles));
        const other = await proto.send.call(channel, { content: "Other bot response" });
        assert.equal(other.content, "");
        assert.equal(other.files.length, 1);
    } finally {
        proto.send = original;
    }
});
