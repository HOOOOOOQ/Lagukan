const crypto = require("crypto");
const { EmbedBuilder } = require("discord.js");
const { getOrCreateGuildPlayer } = require("./musicPermissions.js");
const { getGuildPlayer } = require("./voiceSessionManager.js");
const { truncateText } = require("./nowPlayingManager.js");
const { convertTime } = require("./timeFormat.js");

const partyCache = new Map();

async function getActiveParty(client, guildId) {
    if (!guildId) return null;
    const gid = String(guildId);
    if (partyCache.has(gid)) {
        const cached = partyCache.get(gid);
        return cached?.active ? cached : null;
    }

    if (!client?.musicPartyData) return null;
    const doc = await client.musicPartyData.findOne({ guildId: gid, active: true }).catch(() => null);
    const plain = doc ? (typeof doc.toObject === "function" ? doc.toObject() : doc) : null;
    partyCache.set(gid, plain);
    return plain;
}

async function savePartyState(client, guildId, data) {
    const gid = String(guildId);
    partyCache.set(gid, data);
    if (client?.musicPartyData) {
        await client.musicPartyData
            .findOneAndUpdate({ guildId: gid }, { $set: data }, { upsert: true, returnDocument: "after" })
            .catch(() => {});
    }
    return data;
}

async function createPartySession(client, { guild, hostUser, hostMember, name = "", textChannelId }) {
    const voiceChannel = hostMember?.voice?.channel;
    if (!voiceChannel) {
        return { ok: false, error: "Kamu harus berada di **Voice Channel** terlebih dahulu untuk membuat Music Party." };
    }

    const existing = await getActiveParty(client, guild.id);
    if (existing) {
        return {
            ok: false,
            error: `Sudah ada Music Party aktif (**${existing.name}**) yang dipandu oleh <@${existing.hostId}> di <#${existing.voiceChannelId}>.`,
        };
    }

    let player;
    try {
        player = await getOrCreateGuildPlayer(client, {
            guild,
            voiceChannelId: voiceChannel.id,
            textChannelId,
        });
    } catch (err) {
        return { ok: false, error: err?.message || "Gagal menghubungkan player ke voice channel." };
    }

    const cleanName =
        String(name || "")
            .trim()
            .slice(0, 45) || `${hostUser.username}'s Music Party`;

    const party = await savePartyState(client, guild.id, {
        guildId: String(guild.id),
        partyId: `party_${crypto.randomBytes(4).toString("hex")}`,
        active: true,
        name: cleanName,
        hostId: String(hostUser.id),
        voiceChannelId: String(voiceChannel.id),
        textChannelId: String(textChannelId || player.textId || ""),
        members: [String(hostUser.id)],
        voteSkipIds: [],
    });

    return { ok: true, party, player };
}

async function joinPartySession(client, { guild, user, member }) {
    const party = await getActiveParty(client, guild.id);
    if (!party) {
        return { ok: false, error: "Belum ada sesi Music Party aktif di server ini. Buat dengan `/musicparty create`!" };
    }

    const userVcId = member?.voice?.channelId;
    if (!userVcId || String(userVcId) !== String(party.voiceChannelId)) {
        return {
            ok: false,
            error: `Masuk ke voice channel party (<#${party.voiceChannelId}>) terlebih dahulu untuk bergabung!`,
        };
    }

    const uid = String(user.id);
    if (party.members.includes(uid)) {
        return { ok: false, error: "Kamu sudah bergabung di dalam Music Party ini." };
    }

    const updated = await savePartyState(client, guild.id, {
        ...party,
        members: [...party.members, uid],
    });
    return { ok: true, party: updated };
}

async function leavePartySession(client, { guild, userId }) {
    const party = await getActiveParty(client, guild.id);
    if (!party) {
        return { ok: false, error: "Tidak ada sesi Music Party aktif di server ini." };
    }

    const uid = String(userId);
    if (!party.members.includes(uid)) {
        return { ok: false, error: "Kamu tidak sedang tergabung dalam Music Party ini." };
    }

    const remaining = party.members.filter((m) => m !== uid);
    const voteSkipIds = (party.voteSkipIds || []).filter((m) => m !== uid);

    if (remaining.length === 0) {
        await savePartyState(client, guild.id, {
            ...party,
            active: false,
            members: [],
            voteSkipIds: [],
        });
        return { ok: true, closed: true, party };
    }

    let nextHostId = party.hostId;
    let hostTransferred = false;
    if (String(party.hostId) === uid) {
        nextHostId = remaining[0];
        hostTransferred = true;
    }

    const updated = await savePartyState(client, guild.id, {
        ...party,
        hostId: nextHostId,
        members: remaining,
        voteSkipIds,
    });
    return { ok: true, closed: false, hostTransferred, nextHostId, party: updated };
}

async function transferPartyHost(client, { guild, requesterId, targetUser, hasManageGuild = false }) {
    const party = await getActiveParty(client, guild.id);
    if (!party) {
        return { ok: false, error: "Tidak ada sesi Music Party aktif di server ini." };
    }

    if (String(party.hostId) !== String(requesterId) && !hasManageGuild) {
        return { ok: false, error: `Hanya Party Host (<@${party.hostId}>) atau Admin Server yang dapat memindahkan host.` };
    }

    if (!targetUser || targetUser.bot) {
        return { ok: false, error: "Pilih anggota manusia yang valid sebagai Party Host baru." };
    }

    const targetId = String(targetUser.id);
    const nextMembers = party.members.includes(targetId) ? party.members : [...party.members, targetId];
    const updated = await savePartyState(client, guild.id, {
        ...party,
        hostId: targetId,
        members: nextMembers,
    });
    return { ok: true, party: updated };
}

async function voteSkipPartyTrack(client, { guild, userId }) {
    const party = await getActiveParty(client, guild.id);
    if (!party) {
        return { ok: false, error: "Tidak ada sesi Music Party aktif. Gunakan `/skip` biasa atau buat party dulu." };
    }

    const uid = String(userId);
    if (!party.members.includes(uid)) {
        return { ok: false, error: "Kamu harus tergabung di Music Party (`/musicparty join`) untuk melakukan Vote Skip." };
    }

    const player = getGuildPlayer(client, guild.id);
    if (!player?.queue?.current) {
        return { ok: false, error: "Tidak ada lagu yang sedang diputar untuk di-skip." };
    }

    const votes = Array.isArray(party.voteSkipIds) ? [...party.voteSkipIds] : [];
    if (votes.includes(uid)) {
        return {
            ok: false,
            error: `Kamu sudah memberikan suara Vote Skip untuk lagu ini (\`${votes.length}\` suara tercatat).`,
        };
    }

    votes.push(uid);
    const required = Math.max(1, Math.ceil(party.members.length / 2));

    if (votes.length >= required) {
        const skippedTitle = player.queue.current.title;
        await savePartyState(client, guild.id, { ...party, voteSkipIds: [] });
        await Promise.resolve(player.skip()).catch(() => {});
        return {
            ok: true,
            skipped: true,
            skippedTitle,
            votesCount: votes.length,
            required,
        };
    }

    await savePartyState(client, guild.id, { ...party, voteSkipIds: votes });
    return {
        ok: true,
        skipped: false,
        votesCount: votes.length,
        required,
    };
}

async function resetPartyVoteSkip(client, guildId) {
    const party = await getActiveParty(client, guildId);
    if (!party || !party.voteSkipIds?.length) return;
    await savePartyState(client, guildId, { ...party, voteSkipIds: [] });
}

async function closePartySession(client, { guild, requesterId, hasManageGuild = false }) {
    const party = await getActiveParty(client, guild.id);
    if (!party) {
        return { ok: false, error: "Tidak ada sesi Music Party aktif di server ini." };
    }

    if (String(party.hostId) !== String(requesterId) && !hasManageGuild) {
        return { ok: false, error: `Hanya Party Host (<@${party.hostId}>) atau Admin yang dapat menutup Music Party.` };
    }

    await savePartyState(client, guild.id, {
        ...party,
        active: false,
        members: [],
        voteSkipIds: [],
    });
    return { ok: true, party };
}

function buildPartyEmbed(client, party) {
    const botName = client.config?.botName || "Lagukan";
    const color = client.config?.embedColor || "#5865F2";
    const player = getGuildPlayer(client, party.guildId);
    const current = player?.queue?.current || null;
    const upcoming = Array.isArray(player?.queue) ? player.queue.slice(0, 8) : [];

    const queueLines = upcoming.map(
        (t, idx) =>
            `\`${idx + 1}.\` **${truncateText(t.title, 42)}** — ${truncateText(t.author, 26)} (\`${t.isStream ? "LIVE" : convertTime(t.duration || 0)}\`)`,
    );

    const requiredVotes = Math.max(1, Math.ceil((party.members?.length || 1) / 2));

    return new EmbedBuilder()
        .setColor(color)
        .setAuthor({ name: `${botName} • Music Party Session` })
        .setTitle(`🎉 ${party.name}`)
        .setDescription(
            `👑 **Party Host:** <@${party.hostId}>\n` +
                `🔊 **Voice Channel:** <#${party.voiceChannelId}> *(Sesi terikat pada voice channel server ini)*\n` +
                `👥 **Anggota Party (${party.members.length}):** ${party.members.map((id) => `<@${id}>`).join(", ") || "-"}\n` +
                `🗳️ **Vote Skip Lagu Ini:** \`${(party.voteSkipIds || []).length} / ${requiredVotes}\`\n\n` +
                (current
                    ? `▶️ **Sedang Diputar:** **${truncateText(current.title, 48)}** — ${truncateText(current.author, 30)}\n\n`
                    : `⏹️ *Belum ada lagu diputar — tambahkan lagu dengan \`/play\`!*\n\n`) +
                `**Antrean Party (${player?.queue?.size || 0} lagu):**\n` +
                (queueLines.length ? queueLines.join("\n") : "*Antrean masih kosong.*"),
        )
        .setFooter({ text: `Party ID: ${party.partyId} • Gunakan /musicparty voteskip untuk voting lewati lagu` })
        .setTimestamp();
}

module.exports = {
    getActiveParty,
    createPartySession,
    joinPartySession,
    leavePartySession,
    transferPartyHost,
    voteSkipPartyTrack,
    resetPartyVoteSkip,
    closePartySession,
    buildPartyEmbed,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
