const Logger = require("../utils/logger");

// Status is shared by everyone in a voice channel, including other bots. Serialize
// writes within this process and never clear a status observed to have changed.
const channels = new Map();
const pending = new Map();
const listeners = new WeakSet();
const playerChannels = new WeakMap();

function channelKey(guildId, channelId) {
    return `${guildId}:${channelId}`;
}

function installVoiceStatusListener(client) {
    if (!client?.on || listeners.has(client)) return;
    listeners.add(client);
    client.on("raw", (packet) => {
        const data = packet?.d;
        if (packet?.t === "VOICE_CHANNEL_STATUS_UPDATE" && data?.guild_id && data?.id) {
            const state = channels.get(channelKey(data.guild_id, data.id));
            if (state) state.observed = data.status ?? null;
        } else if (packet?.t === "CHANNEL_INFO" && data?.guild_id && Array.isArray(data.channels)) {
            for (const item of data.channels) {
                const state = channels.get(channelKey(data.guild_id, item.id));
                if (state && Object.hasOwn(item, "status")) state.observed = item.status ?? null;
            }
        }
    });
}

function serialize(key, operation) {
    const previous = pending.get(key) || Promise.resolve();
    const result = previous.catch(() => {}).then(operation);
    pending.set(key, result);
    result
        .finally(() => {
            if (pending.get(key) === result) pending.delete(key);
        })
        .catch(() => {});
    return result;
}

// A name alone contains no emoji ID. Prefer the active guild, and only use an
// external match when it is unambiguous among the bot's cached emojis.
function resolveStatusEmoji(client, guildId, value = process.env.VOICE_STATUS_EMOJI || ":Spotify1:") {
    const raw = String(value || "").trim();
    if (/^<a?:[a-zA-Z0-9_]{2,32}:\d{15,22}>$/.test(raw)) return raw;
    const match = /^:([a-zA-Z0-9_]{2,32}):$/.exec(raw);
    if (!match) return null;
    const valid = (emoji) => emoji?.name === match[1] && emoji.available !== false && /^\d{15,22}$/.test(String(emoji.id || ""));
    const toMarkup = (emoji) => `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
    const local = client?.guilds?.cache?.get?.(guildId)?.emojis?.cache;
    const guildMatches = local?.values ? [...local.values()].filter(valid) : [];
    if (guildMatches.length === 1) return toMarkup(guildMatches[0]);
    if (guildMatches.length > 1) return null;
    const all = client?.emojis?.cache;
    const matches = all?.values ? [...all.values()].filter(valid) : [];
    return matches.length === 1 ? toMarkup(matches[0]) : null;
}

function musicStatus(track, paused = false, emoji = process.env.VOICE_STATUS_EMOJI) {
    const rawEmoji = String(emoji || "").trim();
    // Only accept Discord custom emoji markup; otherwise use a safe Unicode fallback.
    const icon = /^<a?:[a-zA-Z0-9_]{2,32}:\d{15,22}>$/.test(rawEmoji) ? rawEmoji : "🎵";
    const title =
        String(track?.title || "Unknown track")
            .replace(/[\r\n\t]+/g, " ")
            .trim() || "Unknown track";
    const author = String(track?.author || "")
        .replace(/[\r\n\t]+/g, " ")
        .trim();
    const status = `${icon} ${paused ? "Paused" : "Now Playing"} • ${title}${author ? ` — ${author}` : ""}`;
    // Discord limits statuses to 500 characters. Don't split surrogate pairs.
    let result = "";
    for (const character of status) {
        if (result.length + character.length > 500) break;
        result += character;
    }
    return result;
}

async function setPlaybackVoiceStatus(client, player, track, options = {}) {
    const guildId = String(player?.guildId || "");
    const channelId = String(options.channelId || player?.voiceId || "");
    if (!guildId || !channelId || !track || !client?.rest?.put || player?.data?.get?.("guessTheSongActive")) return false;
    if (String(process.env.VOICE_STATUS_ENABLED || "true").toLowerCase() === "false") return false;
    installVoiceStatusListener(client);
    const key = channelKey(guildId, channelId);
    const emoji = resolveStatusEmoji(client, guildId);
    let status = musicStatus(track, options.paused ?? Boolean(player.paused), emoji);
    return serialize(key, async () => {
        if (player.sudoDestroy || player.state === 2 || String(player.voiceId || "") !== channelId) return false;
        const state = channels.get(key) || { observed: undefined };
        channels.set(key, state);
        try {
            try {
                await client.rest.put(`/channels/${channelId}/voice-status`, { body: { status } });
            } catch (error) {
                // A custom emoji may be rejected by Discord; retry only validation failures.
                if (!emoji || (error?.status !== 400 && error?.code !== 50035)) throw error;
                status = musicStatus(track, options.paused ?? Boolean(player.paused), null);
                await client.rest.put(`/channels/${channelId}/voice-status`, { body: { status } });
            }
            state.owner = player;
            state.status = status;
            playerChannels.set(player, channelId);
            return true;
        } catch (error) {
            if (!state.owner && state.observed === undefined) channels.delete(key);
            Logger.warn(
                `[VoiceStatus] Could not update voice channel status (guild=${guildId}, channel=${channelId}, code=${error?.code || error?.status || "unknown"}). Check channel permissions and Discord API status.`,
            );
            return false;
        }
    });
}

async function clearPlaybackVoiceStatus(client, player, channelId = null) {
    const guildId = String(player?.guildId || "");
    channelId = String(channelId || player?.voiceId || (player && playerChannels.get(player)) || "");
    if (!guildId || !channelId || !client?.rest?.put) return false;
    const key = channelKey(guildId, channelId);
    return serialize(key, async () => {
        const state = channels.get(key);
        if (!state || state.owner !== player) return false;
        if (playerChannels.get(player) === channelId) playerChannels.delete(player);
        // Without an observed gateway status we cannot safely distinguish a manual edit.
        if (state.observed !== state.status) {
            channels.delete(key);
            return false;
        }
        try {
            await client.rest.put(`/channels/${channelId}/voice-status`, { body: { status: null } });
            channels.delete(key);
            return true;
        } catch (error) {
            channels.delete(key);
            Logger.debug(
                `[VoiceStatus] Could not clear voice channel status (guild=${guildId}, channel=${channelId}, code=${error?.code || error?.status || "unknown"}).`,
            );
            return false;
        }
    });
}

module.exports = { installVoiceStatusListener, resolveStatusEmoji, musicStatus, setPlaybackVoiceStatus, clearPlaybackVoiceStatus };
