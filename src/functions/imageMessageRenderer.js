const { AttachmentBuilder } = require("discord.js");
const { renderSvgToPngBuffer } = require("./cardRenderer666.js");
const Logger = require("../utils/logger");
const {
    backgroundArtwork666,
    brandMark666,
    ambientDetails666,
    waveform666,
    musicDecoration666,
    voiceDetailIcon666,
    artworkBadge666,
} = require("./visualTheme666.js");

const NAME_PREFIX = "666-music-response-";
const isResponseAttachment = (name) => [NAME_PREFIX, "lagukan-response-"].some((prefix) => String(name || "").startsWith(prefix));
const MAX_LINES_PER_IMAGE = 38;
const WRAP_WIDTH = 62;
const MAX_AVATAR_CACHE_ENTRIES = 128;
const avatarCache = new Map();

function plainText(value) {
    return String(value ?? "")
        .replace(/<@!?(\d+)>/g, "User $1")
        .replace(/<#(\d+)>/g, "Channel $1")
        .replace(/<@&(\d+)>/g, "Role $1")
        .replace(/<a?:\w+:\d+>/g, "")
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)")
        .replace(/```(?:\w+)?\n?/g, "")
        .replace(/\*\*|__|~~|`/g, "")
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

function xml(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function wrapText(value) {
    const result = [];
    // Wide glyphs need more space than Latin letters at the same font size.
    const weight = (char) => (/[MW@%]/.test(char) ? 1.6 : /[^\u0000-\u024f]/u.test(char) ? 2 : 1);
    for (const raw of plainText(value).split(/\r?\n/)) {
        let chars = Array.from(raw.trim());
        if (!chars.length) {
            result.push("");
            continue;
        }
        while (chars.length) {
            let width = 0;
            let end = 0;
            let lastSpace = -1;
            while (end < chars.length && width + weight(chars[end]) <= WRAP_WIDTH) {
                width += weight(chars[end]);
                if (chars[end] === " ") lastSpace = end;
                end++;
            }
            if (end === chars.length) {
                result.push(chars.join(""));
                break;
            }
            const split = lastSpace >= 18 ? lastSpace : Math.max(1, end);
            result.push(chars.slice(0, split).join(""));
            chars = chars.slice(split);
            while (chars[0] === " ") chars.shift();
        }
    }
    return result;
}

function extractRows(payload) {
    const rows = [];
    const add = (value, kind = "body") => {
        if (value !== null && value !== undefined && String(value).trim()) {
            rows.push(...wrapText(value).map((text) => ({ text, kind })), { text: "", kind: "space" });
        }
    };
    add(payload.content);
    for (const entry of payload.embeds || []) {
        const embed = typeof entry?.toJSON === "function" ? entry.toJSON() : entry;
        if (!embed || typeof embed !== "object") continue;
        add(embed.author?.name, "heading");
        add(embed.title, "heading");
        add(embed.description);
        for (const field of embed.fields || []) {
            add(field.name, "label");
            // Keep labels and their values together instead of inserting a blank row.
            if (rows.at(-1)?.kind === "space") rows.pop();
            add(field.value, /^queue position$/i.test(field.name || "") ? "badge" : "body");
        }
        add(embed.footer?.text, "muted");
        if (embed.timestamp) add(embed.timestamp, "muted");
    }
    while (rows.at(-1)?.kind === "space") rows.pop();
    return rows;
}

function extractLines(payload) {
    return extractRows(payload).map((row) => row.text);
}

// Fetch only validated image URLs, without following redirects or buffering unbounded responses.
async function fetchImageData(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1800);
    try {
        const response = await fetch(url, { signal: controller.signal, redirect: "error" });
        const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
        if (
            !response.ok ||
            !["image/png", "image/jpeg"].includes(type) ||
            Number(response.headers.get("content-length")) > 512 * 1024 ||
            !response.body
        )
            return null;
        const chunks = [];
        let length = 0;
        for await (const chunk of response.body) {
            length += chunk.length;
            if (length > 512 * 1024) {
                controller.abort();
                return null;
            }
            chunks.push(chunk);
        }
        return length ? `data:${type};base64,${Buffer.concat(chunks).toString("base64")}` : null;
    } catch {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

// Only known artwork CDNs are fetched here. Never fetch arbitrary embed URLs or redirects.
async function queueArtwork(payload) {
    if ((payload.embeds || []).length !== 1) return null;
    const entry = payload.embeds[0];
    const embed = typeof entry?.toJSON === "function" ? entry.toJSON() : entry;
    if (embed?.author?.name !== "Added to Queue" || !embed.thumbnail?.url) return null;
    let url;
    try {
        url = new URL(embed.thumbnail.url);
    } catch {
        return null;
    }
    const allowed = /^(?:i\.ytimg\.com|img\.youtube\.com|yt3\.ggpht\.com|i\.scdn\.co|i[0-9]+\.sndcdn\.com)$/i;
    if (url.protocol !== "https:" || url.username || url.password || url.port || !allowed.test(url.hostname)) return null;
    return fetchImageData(url);
}

// Voice thumbnails come from Discord's avatar CDN, not arbitrary URLs or the bot's avatar.
async function voiceAvatar(payload) {
    if ((payload.embeds || []).length !== 1) return null;
    const entry = payload.embeds[0];
    const embed = typeof entry?.toJSON === "function" ? entry.toJSON() : entry;
    if (!/^(?:🎙️\s*)?(Joined|Leaving)$/.test(embed?.title || "") || !embed.thumbnail?.url) return null;
    let url;
    try {
        url = new URL(embed.thumbnail.url);
    } catch {
        return null;
    }
    const avatarPath =
        /^\/(?:avatars\/\d+\/[a-z0-9_]+|guilds\/\d+\/users\/\d+\/avatars\/[a-z0-9_]+|embed\/avatars\/\d+)\.(?:png|jpe?g|webp|gif)$/i;
    if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        !["cdn.discordapp.com", "media.discordapp.net"].includes(url.hostname) ||
        !avatarPath.test(url.pathname)
    )
        return null;
    // Discord can return a static PNG for animated/webp avatars; resvg renders PNG reliably.
    url.pathname = url.pathname.replace(/\.(?:jpe?g|webp|gif)$/i, ".png");
    url.search = "?size=256";
    url.hash = "";
    const key = url.toString();
    const cached = avatarCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
        avatarCache.delete(key);
        avatarCache.set(key, cached);
        return cached.image;
    }
    if (cached) avatarCache.delete(key);
    const image = await fetchImageData(url);
    if (avatarCache.size >= MAX_AVATAR_CACHE_ENTRIES) avatarCache.delete(avatarCache.keys().next().value);
    avatarCache.set(key, { image, expiresAt: Date.now() + (image ? 300_000 : 30_000) });
    return image;
}

function cardKind(payload) {
    const entries = (payload.embeds || []).map((entry) => (typeof entry?.toJSON === "function" ? entry.toJSON() : entry));
    const title = entries.map((embed) => `${embed?.author?.name || ""} ${embed?.title || ""}`).join(" ");
    if (/voice connection error/i.test(title)) return { label: "CONNECTION ERROR", icon: "warning" };
    if (/added to queue/i.test(title)) return { label: "QUEUE UPDATE", icon: "music" };
    if (/\bjoined\b/i.test(title)) return { label: "VOICE • JOINED", icon: "joined" };
    if (/\bleaving\b/i.test(title)) return { label: "VOICE • LEAVING", icon: "leaving" };
    return { label: "MUSIC SYSTEM", icon: "music" };
}

function statusIcon(kind) {
    if (kind === "warning")
        return '<path d="M16 4 L29 27 H3 Z" fill="none" stroke="#F4778D" stroke-width="2" stroke-linejoin="round"/><path d="M16 11v7 M16 22v1" stroke="#F4778D" stroke-width="2.5" stroke-linecap="round"/>';
    if (kind === "joined" || kind === "leaving")
        return `<circle cx="12" cy="10" r="5" fill="none" stroke="#F4778D" stroke-width="2"/><path d="M3 27c0-6 4-9 9-9s9 3 9 9 M22 14h8 M${kind === "joined" ? "26 10v8" : "22 14h8"}" fill="none" stroke="#F4778D" stroke-width="2" stroke-linecap="round"/>`;
    return '<path d="M12 22V7l13-3v15 M12 10l13-3" fill="none" stroke="#F4778D" stroke-width="2"/><ellipse cx="8" cy="23" rx="4" ry="3" fill="#F4778D"/><ellipse cx="21" cy="20" rx="4" ry="3" fill="#F4778D"/>';
}

// Specialized cards are only used for the exact bot-generated payload shapes. Unknown or
// unusually long content stays on the generic paginated path so no information is dropped.
function referenceCardSvg(payload, artwork, avatar) {
    if (payload.content || payload.embeds?.length !== 1) return null;
    const entry = payload.embeds[0];
    const embed = typeof entry?.toJSON === "function" ? entry.toJSON() : entry;
    if (!embed) return null;
    const font = 'font-family="Inter, DejaVu Sans, sans-serif"';
    const frame = (height) =>
        `<defs><clipPath id="frameClip"><rect width="900" height="${height}" rx="22"/></clipPath><radialGradient id="ambience" cx="100%" cy="100%" r="85%"><stop stop-color="#B91F3B" stop-opacity=".22"/><stop offset="1" stop-color="#080709" stop-opacity="0"/></radialGradient></defs><rect width="900" height="${height}" rx="22" fill="#080709"/><g clip-path="url(#frameClip)">${backgroundArtwork666(900, height, 0.65)}</g><rect x="1" y="1" width="898" height="${height - 2}" rx="22" fill="url(#ambience)" stroke="#49202F" stroke-width="2"/><g clip-path="url(#frameClip)">${ambientDetails666(900, height)}</g><path d="M28 76H872" stroke="#49202F"/>${brandMark666(30, 12, 55)}<text x="101" y="48" fill="#F5EDF0" ${font} font-weight="bold" font-size="22" letter-spacing="1">666 MUSIC</text>`;
    const text = (x, y, value, color = "#F5EDF0", size = 18, extra = "") =>
        `<text x="${x}" y="${y}" fill="${color}" ${font} font-size="${size}" ${extra}>${xml(value)}</text>`;
    const svg = (height, content) =>
        `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${height}" viewBox="0 0 900 ${height}">${frame(height)}${content}</svg>`;
    const fields = embed.fields || [];
    const raw = String(embed.description || "");
    const noExtras = !embed.title && !embed.footer && !embed.timestamp;
    // Conservative character-width estimate for deciding when to use the paginated fallback.
    const textWidth = (value, size) =>
        Array.from(value).reduce(
            (width, char) => width + (/[^\u0000-\u024f]/u.test(char) ? 1 : /[MW@%]/.test(char) ? 0.95 : 0.7) * size,
            0,
        );

    const wrapCardLine = (value, size, maxWidth) => {
        const output = [];
        let remaining = Array.from(value.trim());
        while (remaining.length) {
            let end = 0;
            let lastSpace = -1;
            while (end < remaining.length && textWidth(remaining.slice(0, end + 1).join(""), size) <= maxWidth) {
                if (remaining[end] === " ") lastSpace = end;
                end++;
            }
            if (end === remaining.length) {
                output.push(remaining.join(""));
                break;
            }
            const split = lastSpace > 0 ? lastSpace : Math.max(1, end);
            output.push(remaining.slice(0, split).join(""));
            remaining = remaining.slice(split);
            while (remaining[0] === " ") remaining.shift();
        }
        return output;
    };

    // Voice logger's description is built from these three lines (not inferred from user input).
    if (
        !embed.author &&
        !fields.length &&
        /^(?:🎙️\s*)?(Joined|Leaving)$/.test(embed.title || "") &&
        embed.footer?.text &&
        embed.timestamp
    ) {
        const lines = raw.split("\n");
        const identity = plainText(lines[0]).match(/^User (\d+) · @(.+)$/);
        const joined = /Joined/.test(embed.title);
        const channel = plainText(lines[1])
            .replace(/🔊|️/gu, "")
            .match(/^(?:Joined|Leaving)\s+(.+)$/);
        const time = plainText(lines[2]).replace(/🕒|️/gu, "").trim();
        if (
            lines.length === 3 &&
            identity &&
            channel &&
            time &&
            identity[2].length <= 32 &&
            channel[1].length <= 32 &&
            time.length <= 30 &&
            textWidth(`User ID: ${identity[1]}`, 18) <= 610 &&
            textWidth(`Username: @${identity[2]}`, 18) <= 610 &&
            textWidth(`${joined ? "Joined Voice" : "Left Voice"}: ${channel[1]}`, 18) <= 610 &&
            textWidth(`Time: ${time}`, 18) <= 610 &&
            textWidth(embed.timestamp, 15) <= 610 &&
            embed.footer.text.length <= 50
        ) {
            const status = joined ? "#35B86A" : "#E53955";
            const height = 330;
            const avatarMarkup = avatar
                ? `<defs><clipPath id="voiceAvatarClip"><circle cx="102" cy="177" r="59"/></clipPath></defs><image href="${avatar}" x="43" y="118" width="118" height="118" preserveAspectRatio="xMidYMid slice" clip-path="url(#voiceAvatarClip)"/>`
                : `<circle cx="102" cy="159" r="16" fill="#B9AAB1"/><path d="M72 203c0-22 13-31 30-31s30 9 30 31z" fill="#B9AAB1"/>`;
            return svg(
                height,
                `${musicDecoration666(joined ? "joined" : "leaving")}<circle cx="102" cy="177" r="65" fill="#1D1019" stroke="#B91F3B" stroke-opacity=".22" stroke-width="3"/><circle cx="102" cy="177" r="61" fill="#100B10" stroke="#49202F" stroke-width="2"/>${avatarMarkup}<circle cx="151" cy="218" r="12" fill="${status}" stroke="#080709" stroke-width="4"/><path d="M202 100V277" stroke="#B91F3B" stroke-width="2"/><circle cx="239" cy="118" r="14" fill="${status}"/>${text(239, 124, joined ? "✓" : "−", "#F5EDF0", 19, 'text-anchor="middle" font-weight="bold"')}${text(263, 126, joined ? "Joined" : "Leaving", "#F5EDF0", 27, 'font-weight="bold"')}${voiceDetailIcon666("user", 223, 146)}${text(251, 161, `User ID: ${identity[1]}`)}${voiceDetailIcon666("user", 223, 176)}${text(251, 191, `Username: @${identity[2]}`)}${voiceDetailIcon666("voice", 223, 206)}${text(251, 221, `${joined ? "Joined Voice" : "Left Voice"}: ${channel[1]}`)}${voiceDetailIcon666("clock", 223, 236)}${text(251, 251, `Time: ${time}`)}${voiceDetailIcon666("date", 223, 278)}${text(251, 293, embed.timestamp, "#B9AAB1", 15)}${text(868, 312, embed.footer.text, "#B9AAB1", 12, 'text-anchor="end"')}`,
            );
        }
    }

    if (
        embed.author?.name === "Added to Queue" &&
        noExtras &&
        fields.length === 3 &&
        fields.map((field) => field.name).join("|") === "Duration|Source|Queue Position"
    ) {
        const match = raw.match(/^\*\*(?:\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|([^\n]+?))\*\*\nby \*\*([^\n]+?)\*\*$/);
        const values = fields.map((field) => plainText(field.value));
        if (match && values.every((value) => value.length <= 18 && !value.includes("\n"))) {
            const title = plainText(match[1] || match[3]);
            const artist = plainText(match[4]);
            const link = match[2] || "";
            const titleLines = wrapCardLine(title, 26, 580);
            const artistLines = wrapCardLine(artist, 21, 580);
            const linkLines = link ? wrapText(link) : [];
            if (
                !titleLines.length ||
                !artistLines.length ||
                titleLines.length > 3 ||
                artistLines.length > 3 ||
                linkLines.length > 4 ||
                textWidth(`Duration: ${values[0]}`, 16) > 175 ||
                textWidth(`Source: ${values[1]}`, 16) > 210 ||
                textWidth(`Queue Position: ${values[2]}`, 18) > 275
            )
                return null;
            const titleOffset = (titleLines.length - 1) * 32;
            const metadataOffset = titleOffset + (artistLines.length - 1) * 27;
            const height = 330 + metadataOffset + linkLines.length * 24;
            const titleMarkup = titleLines
                .map((line, index) => text(270, 133 + index * 32, line, "#F5EDF0", 26, 'font-weight="bold"'))
                .join("");
            const artistMarkup = artistLines
                .map((line, index) => text(270, 168 + titleOffset + index * 27, line, "#F4778D", 21, 'font-weight="bold"'))
                .join("");
            const cover = artwork
                ? `<defs><clipPath id="queueCover"><rect x="34" y="101" width="200" height="200" rx="15"/></clipPath></defs><image href="${artwork}" x="34" y="101" width="200" height="200" preserveAspectRatio="xMidYMid slice" clip-path="url(#queueCover)"/>`
                : `<rect x="34" y="101" width="200" height="200" rx="15" fill="#150D13"/><circle cx="134" cy="201" r="60" fill="#100B10" stroke="#49202F"/><g transform="translate(117 183) scale(1.1)">${statusIcon("music")}</g>`;
            const links = linkLines.map((line, i) => text(34, 326 + metadataOffset + i * 24, line, "#B9AAB1", 15)).join("");
            return svg(
                height,
                `${text(868, 47, "ADDED TO QUEUE", "#F4778D", 14, 'text-anchor="end" letter-spacing="1"')}${waveform666(765, 224, 0.18)}<rect x="31" y="98" width="206" height="206" rx="18" fill="none" stroke="#E53955" stroke-width="7" opacity=".13"/>${cover}${artworkBadge666(190, 257)}<rect x="34" y="101" width="200" height="200" rx="15" fill="none" stroke="#FF4568" stroke-width="2"/><circle cx="251" cy="201" r="7" fill="#B91F3B" opacity=".45"/>${titleMarkup}${artistMarkup}<rect x="270" y="${191 + metadataOffset}" width="200" height="42" rx="21" fill="#150D13" stroke="#49202F"/><rect x="485" y="${191 + metadataOffset}" width="235" height="42" rx="21" fill="#150D13" stroke="#49202F"/>${text(284, 218 + metadataOffset, `Duration: ${values[0]}`, "#F5EDF0", 16)}${text(499, 218 + metadataOffset, `Source: ${values[1]}`, "#F5EDF0", 16)}<rect x="270" y="${249 + metadataOffset}" width="310" height="43" rx="21" fill="#1D1019" stroke="#B91F3B"/>${text(289, 277 + metadataOffset, `Queue Position: ${values[2]}`, "#F4778D", 18, 'font-weight="bold"')}${links}`,
            );
        }
    }

    if (/voice connection error/i.test(embed.author?.name || "") && noExtras && !fields.length) {
        const title = plainText(embed.author.name);
        const description = plainText(raw.replace(/^❌\s*/u, ""))
            .split(/\r?\n/)
            .flatMap((line) => (line.trim() ? wrapCardLine(line, 19, 610) : [""]));
        if (title.length <= 55 && textWidth(title, 24) <= 630 && description.length <= 8) {
            const height = Math.max(260, 161 + description.length * 29);
            const lines = description.map((line, i) => text(234, 145 + i * 29, line, "#B9AAB1", 19)).join("");
            return svg(
                height,
                `<circle cx="112" cy="${height / 2 + 20}" r="74" fill="none" stroke="#B91F3B" stroke-opacity=".18"/><circle cx="112" cy="${height / 2 + 20}" r="64" fill="#150D13" stroke="#49202F" stroke-width="2"/><g transform="translate(80 ${height / 2 - 12}) scale(2)">${statusIcon("warning")}</g><path d="M200 98V${height - 30}" stroke="#B91F3B" stroke-width="2"/>${text(234, 111, title, "#F5EDF0", 24, 'font-weight="bold"')}${lines}`,
            );
        }
    }
    return null;
}

// Combine generated cards and their embed metadata into one Discord attachment.
// Only known card names are handled; unrelated attachments/messages remain untouched.
const CARD_ATTACHMENT_NAMES = new Set(["666-nowplaying.png", "666-profile.png", "666-leaderboard.png"]);
async function renderSingleAttachedCard(payload, rows) {
    if (payload.content || payload.embeds?.length !== 1 || !Array.isArray(payload.files)) return null;
    const entry = payload.embeds[0];
    const embed = typeof entry?.toJSON === "function" ? entry.toJSON() : entry;
    const index = payload.files.findIndex(
        (file) => CARD_ATTACHMENT_NAMES.has(file?.name) && embed?.image?.url === `attachment://${file.name}`,
    );
    if (index < 0 || (embed.fields !== undefined && !Array.isArray(embed.fields))) return null;
    const embedFields = embed.fields || [];
    const cardName = payload.files[index].name;
    const source = payload.files[index].attachment;
    if (
        !Buffer.isBuffer(source) ||
        source.length < 24 ||
        source.length > 5 * 1024 * 1024 ||
        source.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
    )
        return null;
    const sourceWidth = source.readUInt32BE(16);
    const sourceHeight = source.readUInt32BE(20);
    if (!sourceWidth || !sourceHeight || sourceWidth > 4096 || sourceHeight > 4096) return null;
    const width = 900;
    const playerWidth = 860;
    const playerHeight = Math.round((playerWidth * sourceHeight) / sourceWidth);
    if (playerHeight > 1200) return null;
    const font = 'font-family="Inter, DejaVu Sans, sans-serif"';
    const visual = (value) =>
        plainText(value)
            .replace(/👤\s*(?=Artist:)/gu, "")
            .replace(/💿\s*(?=Album:)/gu, "")
            .replace(/▶️\s*(?=Playing)/gu, "")
            .replace(/⏸️\s*(?=Paused)/gu, "")
            .replace(/^🔊\s*(?=\d)/u, "")
            .replace(/^✨\s*(?=On$)/u, "")
            .replace(/^🔂\s*(?=Track$)/u, "")
            .replace(/^🔁\s*(?=Queue$)/u, "")
            .trim();
    // Constrain text by conservative glyph width rather than character count.
    const split = (value, fontSize, maxWidth) => {
        const result = [];
        for (const paragraph of visual(value).split(/\r?\n/)) {
            let chars = Array.from(paragraph.trim());
            if (!chars.length) {
                result.push("");
                continue;
            }
            while (chars.length) {
                let used = 0,
                    end = 0,
                    space = -1;
                while (end < chars.length) {
                    const c = chars[end];
                    const w = (/[^\u0000-\u024f]/u.test(c) ? 1 : /[MW@%]/.test(c) ? 0.95 : 0.7) * fontSize;
                    if (used + w > maxWidth) break;
                    used += w;
                    if (c === " ") space = end;
                    end++;
                }
                if (end === chars.length) {
                    result.push(chars.join(""));
                    break;
                }
                const at = space > 0 ? space : Math.max(1, end);
                result.push(chars.slice(0, at).join(""));
                chars = chars.slice(at);
                while (chars[0] === " ") chars.shift();
            }
        }
        return result;
    };
    const headerY = 20 + playerHeight;
    let description = String(embed.description || "");
    const knownFields = ["Requested By", "Duration", "Elapsed / Remaining", "Bot", "Source", "Queue", "Volume", "Loop", "Autoplay"];
    const isDashboard =
        cardName === "666-nowplaying.png" &&
        /^666 • .+ • (?:Now Playing|Playback Paused)$/.test(embed.author?.name || "") &&
        embedFields.length === knownFields.length &&
        embedFields.every((field, i) => field.name === knownFields[i]);
    if (isDashboard) {
        const lines = description.split(/\r?\n/);
        const titleLine = lines[0].match(/^\*\*(?:\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|([^\n]+?))\*\*$/);
        if (titleLine) {
            const title = titleLine[1] || titleLine[3];
            const replacement = [];
            // The cover card already displays titles up to 33 characters; keep longer titles in full.
            if (title.length > 33) replacement.push(`Title: ${title}`);
            if (titleLine[2]) replacement.push(`Link: ${titleLine[2]}`);
            lines.splice(0, 1, ...replacement);
        }
        // The existing card already contains the same elapsed/total progress bar.
        const progressIndex = lines.findIndex((line) => /^`[^`]+` [▰●▱]+ `[^`]+`$/u.test(line));
        if (progressIndex !== -1) {
            lines.splice(progressIndex, 1);
            if (progressIndex > 0 && !lines[progressIndex - 1].trim()) lines.splice(progressIndex - 1, 1);
        }
        description = lines.join("\n");
    }
    const desc = split(description, 17, 802);
    const author = split(embed.author?.name || "", 15, 802);
    const title = embed.title ? split(embed.title, 21, 802) : [];
    const foot = split(embed.footer?.text || "", 14, 802);
    if (embed.timestamp) foot.push(...split(embed.timestamp, 14, 802));
    const fields = embedFields.map((field) => ({ name: split(field.name, 15, 234), value: split(field.value, 17, 234) }));
    let y = headerY + 72;
    const textRows = (items, size, color, lineHeight, weight = "normal") => {
        const output = items
            .map((line) => {
                const result = line
                    ? `<text x="48" y="${y}" ${font} font-size="${size}" font-weight="${weight}" fill="${color}">${xml(line)}</text>`
                    : "";
                y += lineHeight;
                return result;
            })
            .join("");
        return output;
    };
    const authorMarkup = textRows(author, 15, "#F4778D", 23, "bold");
    const titleMarkup = textRows(title, 21, "#F5EDF0", 28, "bold");
    const descriptionMarkup = textRows(desc, 17, "#F5EDF0", 25);
    y += 12;
    let fieldsMarkup = "";
    for (let i = 0; i < fields.length; i += 3) {
        const group = fields.slice(i, i + 3);
        const rowHeight = Math.max(...group.map((field) => 34 + field.name.length * 19 + field.value.length * 23), 78);
        group.forEach((field, column) => {
            const x = 38 + column * 278;
            fieldsMarkup += `<rect x="${x}" y="${y}" width="268" height="${rowHeight - 10}" rx="12" fill="#150D13" fill-opacity=".95" stroke="#49202F"/><rect x="${x + 1}" y="${y + 1}" width="3" height="${rowHeight - 12}" rx="1.5" fill="#B91F3B" fill-opacity=".75"/>`;
            field.name.forEach((line, j) => {
                fieldsMarkup += `<text x="${x + 14}" y="${y + 23 + j * 19}" ${font} font-size="15" font-weight="bold" fill="#F4778D">${xml(line)}</text>`;
            });
            field.value.forEach((line, j) => {
                fieldsMarkup += `<text x="${x + 14}" y="${y + 26 + field.name.length * 19 + j * 23}" ${font} font-size="17" fill="#F5EDF0">${xml(line)}</text>`;
            });
        });
        y += rowHeight;
    }
    y += 16;
    const footerMarkup = textRows(foot, 14, "#B9AAB1", 21);
    const height = y + 24;
    // Never drop information: unusually large/complex payloads use the existing paginated path.
    if (height > 3200) return null;
    const imageData = source.toString("base64");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><clipPath id="single-frame"><rect width="${width}" height="${height}" rx="22"/></clipPath></defs><rect width="${width}" height="${height}" rx="22" fill="#080709"/><g clip-path="url(#single-frame)">${backgroundArtwork666(width, height, 0.38)}</g><rect x="1" y="1" width="898" height="${height - 2}" rx="22" fill="none" stroke="#49202F"/><image href="data:image/png;base64,${imageData}" x="20" y="20" width="${playerWidth}" height="${playerHeight}"/><path d="M38 ${headerY + 22}H862" stroke="#49202F"/><circle cx="47" cy="${headerY + 47}" r="4" fill="#E53955"/><text x="60" y="${headerY + 52}" ${font} font-size="16" font-weight="bold" letter-spacing="1" fill="#F4778D">${cardName === "666-nowplaying.png" ? "PLAYBACK DETAILS" : "CARD DETAILS"}</text>${authorMarkup}${titleMarkup}${descriptionMarkup}${fieldsMarkup}${footerMarkup}</svg>`;
    const image = await renderSvgToPngBuffer(svg);
    if (!image?.length) return null;
    return {
        index,
        image,
        description: rows
            .map((row) => row.text)
            .join("\n")
            .slice(0, 1024),
    };
}

function retainedAttachments(message) {
    const attachments = message?.attachments;
    if (!attachments?.values) return [];
    return [...attachments.values()].filter((file) => !isResponseAttachment(file.name)).map((file) => ({ id: String(file.id) }));
}

// Mark only explicitly selected messages for native Discord rendering without adding API fields.
const nativeMessagePayloads = new WeakSet();
function nativeMessagePayload(payload) {
    nativeMessagePayloads.add(payload);
    return payload;
}

// Preserve existing files and interactive components; only textual content/embeds are rasterized.
async function toImagePayload(input, { edit = false, message = null } = {}) {
    const payload = typeof input === "string" ? { content: input } : input;
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || nativeMessagePayloads.has(payload)) return input;
    const rows = extractRows(payload);
    if (!rows.length) return input;
    const oldFiles = Array.isArray(payload.files) ? payload.files : [];
    const combined = await renderSingleAttachedCard(payload, rows);
    if (combined) {
        const files = oldFiles.filter((_, index) => index !== combined.index);
        files.push(new AttachmentBuilder(combined.image, { name: `${NAME_PREFIX}1.png`, description: combined.description }));
        const retained = edit ? (Array.isArray(payload.attachments) ? payload.attachments : retainedAttachments(message)) : [];
        // Replace both the old separate player image and generated response cards on edits.
        const obsoleteIds = new Set(
            message?.attachments?.values
                ? [...message.attachments.values()]
                      .filter((file) => CARD_ATTACHMENT_NAMES.has(file.name) || isResponseAttachment(file.name))
                      .map((file) => String(file.id))
                : [],
        );
        const kept = retained.filter((file) => !obsoleteIds.has(String(file.id)));
        if (files.length + kept.length <= 10) {
            const result = { ...payload, content: "", embeds: [], files };
            if (edit) result.attachments = kept;
            return result;
        }
        return input;
    }
    const pages = Math.ceil(rows.length / MAX_LINES_PER_IMAGE);
    let retained = edit
        ? Array.isArray(payload.attachments)
            ? payload.attachments
            : !oldFiles.length
              ? retainedAttachments(message)
              : []
        : [];
    const referencedCards = new Set(
        (payload.embeds || [])
            .map((entry) => {
                const embed = typeof entry?.toJSON === "function" ? entry.toJSON() : entry;
                return String(embed?.image?.url || "").replace(/^attachment:\/\//, "");
            })
            .filter((name) => CARD_ATTACHMENT_NAMES.has(name)),
    );
    if (edit && referencedCards.size && !oldFiles.length && message?.attachments?.values) {
        const obsolete = new Set(
            [...message.attachments.values()].filter((file) => referencedCards.has(file.name)).map((file) => String(file.id)),
        );
        retained = retained.filter((file) => !obsolete.has(String(file.id)));
    }
    if (pages + oldFiles.length + retained.length > 10) {
        Logger.warn("[ImageMessage] Discord attachment limit exceeded; keeping original message.");
        return input;
    }
    const files = [...oldFiles];
    const [artwork, avatar] = await Promise.all([queueArtwork(payload), voiceAvatar(payload)]);
    const kind = cardKind(payload);
    for (let page = 0; page < pages; page++) {
        const pageRows = rows.slice(page * MAX_LINES_PER_IMAGE, (page + 1) * MAX_LINES_PER_IMAGE);
        const pageLines = pageRows.map((row) => row.text);
        const pageImage = page === 0 ? artwork || avatar : null;
        const artworkHeight = pageImage ? 154 : 0;
        const height = Math.max(190, 158 + artworkHeight + pageRows.length * 31);
        const rowMarkup = pageRows
            .map((row, i) => {
                if (!row.text) return "";
                // Voice/error status icons are represented by the vector icon in the header.
                // Keep other emoji intact: they can carry meaning in arbitrary responses.
                const visible = ["joined", "leaving", "warning"].includes(kind.icon)
                    ? row.text.replace(/(?:🎙️|🔊|🕒|❌)/gu, "").trim()
                    : row.text;
                const heading = row.kind === "heading";
                const color = heading ? "#F5EDF0" : row.kind === "label" ? "#F4778D" : row.kind === "muted" ? "#B9AAB1" : "#F5EDF0";
                const size = heading ? 24 : row.kind === "label" ? 16 : 19;
                const estimatedWidth = Array.from(visible).reduce(
                    (width, char) => width + (/[^\u0000-\u024f]/u.test(char) ? 1 : /[MW@%]/.test(char) ? 0.95 : 0.7) * size,
                    0,
                );
                const fit = estimatedWidth > 790 ? ' textLength="790" lengthAdjust="spacingAndGlyphs"' : "";
                const badge =
                    row.kind === "badge"
                        ? `<rect x="45" y="${111 + artworkHeight + i * 31}" width="${Math.min(800, Math.max(65, Array.from(visible).length * 16 + 18))}" height="28" rx="9" fill="#1D1019" stroke="#49202F"/>`
                        : "";
                return `${badge}<text x="52" y="${132 + artworkHeight + i * 31}" fill="${color}" font-family="Inter, DejaVu Sans, sans-serif" font-size="${size}"${heading || row.kind === "label" ? ' font-weight="bold"' : ""}${fit}>${xml(visible)}</text>`;
            })
            .join("");
        const artworkMarkup = artworkHeight
            ? avatar && !artwork
                ? `<defs><clipPath id="cover"><circle cx="115" cy="164" r="63"/></clipPath></defs><circle cx="115" cy="164" r="67" fill="#1D1019" stroke="#B91F3B"/><image href="${pageImage}" x="52" y="101" width="126" height="126" preserveAspectRatio="xMidYMid slice" clip-path="url(#cover)"/><text x="204" y="156" fill="#F4778D" font-family="Inter, DejaVu Sans, sans-serif" font-size="15" font-weight="bold" letter-spacing="1">USER PROFILE</text><text x="204" y="182" fill="#B9AAB1" font-family="Inter, DejaVu Sans, sans-serif" font-size="17">VOICE ACTIVITY</text><path d="M204 205H846" stroke="#49202F"/>`
                : `<defs><clipPath id="cover"><rect x="52" y="101" width="126" height="126" rx="13"/></clipPath></defs><rect x="48" y="97" width="134" height="134" rx="16" fill="#1D1019" stroke="#49202F"/><image href="${pageImage}" x="52" y="101" width="126" height="126" preserveAspectRatio="xMidYMid slice" clip-path="url(#cover)"/><text x="204" y="156" fill="#F4778D" font-family="Inter, DejaVu Sans, sans-serif" font-size="15" font-weight="bold" letter-spacing="1">TRACK ARTWORK</text><text x="204" y="182" fill="#B9AAB1" font-family="Inter, DejaVu Sans, sans-serif" font-size="17">Added to your queue</text><path d="M204 205H846" stroke="#49202F"/>`
            : "";
        const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${height}" viewBox="0 0 900 ${height}"><defs><clipPath id="frame"><rect width="900" height="${height}" rx="22"/></clipPath><radialGradient id="glow" cx="95%" cy="5%" r="85%"><stop stop-color="#B91F3B" stop-opacity=".14"/><stop offset="1" stop-color="#080709" stop-opacity="0"/></radialGradient></defs><rect width="900" height="${height}" rx="22" fill="#080709"/><g clip-path="url(#frame)">${backgroundArtwork666(900, height, 0.55)}</g><rect x="1" y="1" width="898" height="${height - 2}" rx="22" fill="url(#glow)" stroke="#49202F" stroke-width="1.5"/><g clip-path="url(#frame)">${ambientDetails666(900, height)}</g><path d="M30 78H870" stroke="#49202F"/>${brandMark666(30, 14, 50)}<text x="96" y="46" fill="#F5EDF0" font-family="Inter, DejaVu Sans, sans-serif" font-size="20" font-weight="bold" letter-spacing="1">666 MUSIC</text><rect x="258" y="22" width="34" height="34" rx="10" fill="#1D1019"/><g transform="translate(259 23)">${statusIcon(kind.icon)}</g><text x="305" y="44" fill="#F4778D" font-family="Inter, DejaVu Sans, sans-serif" font-size="14" font-weight="bold" letter-spacing="1">${kind.label}</text><text x="848" y="44" text-anchor="end" fill="#B9AAB1" font-family="Inter, DejaVu Sans, sans-serif" font-size="14">${page + 1} / ${pages}</text>${artworkMarkup}${rowMarkup}</svg>`;
        const svg = pages === 1 ? referenceCardSvg(payload, artwork, avatar) || fallbackSvg : fallbackSvg;
        const image = await renderSvgToPngBuffer(svg);
        if (!image?.length) {
            Logger.warn("[ImageMessage] PNG renderer unavailable; keeping original message.");
            return input;
        }
        files.push(
            new AttachmentBuilder(image, {
                name: `${NAME_PREFIX}${page + 1}.png`,
                description: pageLines.join("\n").slice(0, 1024),
            }),
        );
    }
    const output = { ...payload, content: "", embeds: [], files };
    if (edit) output.attachments = retained;
    return output;
}

// Covers messages sent or edited directly by bot code as well as helper-based responses.
// Installation is process-wide but only affects clients explicitly opted in below.
function installImageMessageHandlers(client) {
    client._lagukanImageMessages = true;
    const discord = require("discord.js");
    const owners = new Set();
    for (const name of ["TextChannel", "VoiceChannel", "StageChannel", "ThreadChannel", "NewsChannel", "DMChannel"]) {
        let proto = discord[name]?.prototype;
        while (proto && !Object.prototype.hasOwnProperty.call(proto, "send")) proto = Object.getPrototypeOf(proto);
        if (proto) owners.add(proto);
    }
    for (const proto of owners) {
        if (Object.prototype.hasOwnProperty.call(proto, "_lagukanImageSend")) continue;
        const original = proto.send;
        Object.defineProperty(proto, "_lagukanImageSend", { value: true });
        proto.send = async function (payload) {
            return original.call(this, this.client?._lagukanImageMessages ? await toImagePayload(payload) : payload);
        };
    }
    const proto = discord.Message?.prototype;
    if (proto && !Object.prototype.hasOwnProperty.call(proto, "_lagukanImageEdit")) {
        const original = proto.edit;
        Object.defineProperty(proto, "_lagukanImageEdit", { value: true });
        proto.edit = async function (payload) {
            return original.call(
                this,
                this.client?._lagukanImageMessages ? await toImagePayload(payload, { edit: true, message: this }) : payload,
            );
        };
    }
}

module.exports = { extractLines, toImagePayload, installImageMessageHandlers, nativeMessagePayload };
