const { AttachmentBuilder } = require("discord.js");
const { renderSvgToPngBuffer } = require("./cardRenderer666.js");
const Logger = require("../utils/logger");
const {
    brandMark666,
    ambientDetails666,
    waveform666,
    musicDecoration666,
    voiceDetailIcon666,
    artworkBadge666,
} = require("./visualTheme666.js");

const NAME_PREFIX = "lagukan-response-";
const MAX_LINES_PER_IMAGE = 38;
const WRAP_WIDTH = 62;

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
function referenceCardSvg(payload, artwork) {
    if (payload.content || payload.embeds?.length !== 1) return null;
    const entry = payload.embeds[0];
    const embed = typeof entry?.toJSON === "function" ? entry.toJSON() : entry;
    if (!embed) return null;
    const font = 'font-family="Inter, DejaVu Sans, sans-serif"';
    const frame = (height) =>
        `<defs><clipPath id="frameClip"><rect width="900" height="${height}" rx="22"/></clipPath><radialGradient id="ambience" cx="100%" cy="100%" r="85%"><stop stop-color="#B91F3B" stop-opacity=".22"/><stop offset="1" stop-color="#080709" stop-opacity="0"/></radialGradient></defs><rect width="900" height="${height}" rx="22" fill="#080709"/><rect x="1" y="1" width="898" height="${height - 2}" rx="22" fill="url(#ambience)" stroke="#49202F" stroke-width="2"/><g clip-path="url(#frameClip)">${ambientDetails666(900, height)}</g><path d="M28 76H872" stroke="#49202F"/>${brandMark666(30, 12, 55)}<text x="101" y="48" fill="#F5EDF0" ${font} font-weight="bold" font-size="22" letter-spacing="1">666 MUSIC</text>`;
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
            return svg(
                height,
                `${musicDecoration666(joined ? "joined" : "leaving")}<circle cx="102" cy="177" r="61" fill="#100B10" stroke="#49202F" stroke-width="2"/><circle cx="102" cy="159" r="16" fill="#B9AAB1"/><path d="M72 203c0-22 13-31 30-31s30 9 30 31z" fill="#B9AAB1"/><circle cx="151" cy="218" r="12" fill="${status}" stroke="#080709" stroke-width="4"/><path d="M202 100V277" stroke="#B91F3B" stroke-width="2"/><circle cx="239" cy="118" r="14" fill="${status}"/>${text(239, 124, joined ? "✓" : "−", "#F5EDF0", 19, 'text-anchor="middle" font-weight="bold"')}${text(263, 126, joined ? "Joined" : "Leaving", "#F5EDF0", 27, 'font-weight="bold"')}${voiceDetailIcon666("user", 223, 146)}${text(251, 161, `User ID: ${identity[1]}`)}${voiceDetailIcon666("user", 223, 176)}${text(251, 191, `Username: @${identity[2]}`)}${voiceDetailIcon666("voice", 223, 206)}${text(251, 221, `${joined ? "Joined Voice" : "Left Voice"}: ${channel[1]}`)}${voiceDetailIcon666("clock", 223, 236)}${text(251, 251, `Time: ${time}`)}${voiceDetailIcon666("date", 223, 278)}${text(251, 293, embed.timestamp, "#B9AAB1", 15)}${text(868, 312, embed.footer.text, "#786B73", 12, 'text-anchor="end"')}`,
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
            // Longer values use the generic paginated layout instead of truncation.
            if (
                title.length > 32 ||
                artist.length > 38 ||
                wrapText(link).length > 4 ||
                textWidth(title, 26) > 590 ||
                textWidth(artist, 21) > 590 ||
                textWidth(`Duration: ${values[0]}`, 16) > 175 ||
                textWidth(`Source: ${values[1]}`, 16) > 210 ||
                textWidth(`Queue Position: ${values[2]}`, 18) > 275
            )
                return null;
            const linkLines = link ? wrapText(link) : [];
            const height = 330 + linkLines.length * 24;
            const cover = artwork
                ? `<defs><clipPath id="queueCover"><rect x="34" y="101" width="200" height="200" rx="15"/></clipPath></defs><image href="${artwork}" x="34" y="101" width="200" height="200" preserveAspectRatio="xMidYMid slice" clip-path="url(#queueCover)"/>`
                : `<rect x="34" y="101" width="200" height="200" rx="15" fill="#150D13"/><circle cx="134" cy="201" r="60" fill="#100B10" stroke="#49202F"/><g transform="translate(117 183) scale(1.1)">${statusIcon("music")}</g>`;
            const links = linkLines.map((line, i) => text(34, 326 + i * 24, line, "#B9AAB1", 15)).join("");
            return svg(
                height,
                `${text(868, 47, "ADDED TO QUEUE", "#F4778D", 14, 'text-anchor="end" letter-spacing="1"')}${waveform666(765, 224, 0.18)}<rect x="31" y="98" width="206" height="206" rx="18" fill="none" stroke="#E53955" stroke-width="7" opacity=".13"/>${cover}${artworkBadge666(190, 257)}<rect x="34" y="101" width="200" height="200" rx="15" fill="none" stroke="#FF4568" stroke-width="2"/><circle cx="251" cy="201" r="7" fill="#B91F3B" opacity=".45"/>${text(270, 133, title, "#F5EDF0", 26, 'font-weight="bold"')}${text(270, 168, artist, "#F4778D", 21, 'font-weight="bold"')}<rect x="270" y="191" width="200" height="42" rx="21" fill="#150D13" stroke="#49202F"/><rect x="485" y="191" width="235" height="42" rx="21" fill="#150D13" stroke="#49202F"/>${text(284, 218, `Duration: ${values[0]}`, "#F5EDF0", 16)}${text(499, 218, `Source: ${values[1]}`, "#F5EDF0", 16)}<rect x="270" y="249" width="310" height="43" rx="21" fill="#1D1019" stroke="#B91F3B"/>${text(289, 277, `Queue Position: ${values[2]}`, "#F4778D", 18, 'font-weight="bold"')}${links}`,
            );
        }
    }

    if (/voice connection error/i.test(embed.author?.name || "") && noExtras && !fields.length) {
        const title = plainText(embed.author.name);
        const description = wrapText(raw.replace(/^❌\s*/u, ""));
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

function retainedAttachments(message) {
    const attachments = message?.attachments;
    if (!attachments?.values) return [];
    return [...attachments.values()]
        .filter((file) => !String(file.name || "").startsWith(NAME_PREFIX))
        .map((file) => ({ id: String(file.id) }));
}

// Preserve existing files and interactive components; only textual content/embeds are rasterized.
async function toImagePayload(input, { edit = false, message = null } = {}) {
    const payload = typeof input === "string" ? { content: input } : input;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return input;
    const rows = extractRows(payload);
    if (!rows.length) return input;
    const oldFiles = Array.isArray(payload.files) ? payload.files : [];
    const pages = Math.ceil(rows.length / MAX_LINES_PER_IMAGE);
    const retained = edit
        ? Array.isArray(payload.attachments)
            ? payload.attachments
            : !oldFiles.length
              ? retainedAttachments(message)
              : []
        : [];
    if (pages + oldFiles.length + retained.length > 10) {
        Logger.warn("[ImageMessage] Discord attachment limit exceeded; keeping original message.");
        return input;
    }
    const files = [...oldFiles];
    const artwork = await queueArtwork(payload);
    const kind = cardKind(payload);
    for (let page = 0; page < pages; page++) {
        const pageRows = rows.slice(page * MAX_LINES_PER_IMAGE, (page + 1) * MAX_LINES_PER_IMAGE);
        const pageLines = pageRows.map((row) => row.text);
        const artworkHeight = page === 0 && artwork ? 154 : 0;
        const height = 144 + artworkHeight + pageRows.length * 31;
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
                        ? `<rect x="45" y="${105 + artworkHeight + i * 31}" width="${Math.min(800, Math.max(65, Array.from(visible).length * 16 + 18))}" height="28" rx="9" fill="#1D1019" stroke="#49202F"/>`
                        : "";
                return `${badge}<text x="52" y="${126 + artworkHeight + i * 31}" fill="${color}" font-family="Inter, DejaVu Sans, sans-serif" font-size="${size}"${heading || row.kind === "label" ? ' font-weight="bold"' : ""}${fit}>${xml(visible)}</text>`;
            })
            .join("");
        const artworkMarkup = artworkHeight
            ? `<defs><clipPath id="cover"><rect x="52" y="101" width="126" height="126" rx="13"/></clipPath></defs><rect x="48" y="97" width="134" height="134" rx="16" fill="#1D1019" stroke="#49202F"/><image href="${artwork}" x="52" y="101" width="126" height="126" preserveAspectRatio="xMidYMid slice" clip-path="url(#cover)"/><text x="204" y="156" fill="#F4778D" font-family="Inter, DejaVu Sans, sans-serif" font-size="15" font-weight="bold" letter-spacing="1">TRACK ARTWORK</text><text x="204" y="182" fill="#B9AAB1" font-family="Inter, DejaVu Sans, sans-serif" font-size="17">Added to your queue</text><path d="M204 205H846" stroke="#49202F"/>`
            : "";
        const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${height}" viewBox="0 0 900 ${height}"><defs><radialGradient id="glow" cx="90%" cy="0%" r="70%"><stop stop-color="#B91F3B" stop-opacity=".13"/><stop offset="1" stop-color="#080709" stop-opacity="0"/></radialGradient></defs><rect width="900" height="${height}" rx="20" fill="#080709"/><rect x="1" y="1" width="898" height="${height - 2}" rx="20" fill="url(#glow)" stroke="#49202F"/><rect x="1" y="1" width="898" height="76" rx="20" fill="#150D13"/><path d="M1 76H899" stroke="#49202F"/><rect x="30" y="20" width="36" height="36" rx="10" fill="#1D1019"/><g transform="translate(32 22)">${statusIcon(kind.icon)}</g><text x="82" y="45" fill="#F5EDF0" font-family="Inter, DejaVu Sans, sans-serif" font-size="20" font-weight="bold" letter-spacing="1">666 MUSIC</text><text x="252" y="44" fill="#F4778D" font-family="Inter, DejaVu Sans, sans-serif" font-size="14" font-weight="bold" letter-spacing="1">${kind.label}</text><text x="848" y="44" text-anchor="end" fill="#B9AAB1" font-family="Inter, DejaVu Sans, sans-serif" font-size="14">${page + 1} / ${pages}</text>${artworkMarkup}${rowMarkup}</svg>`;
        const svg = pages === 1 ? referenceCardSvg(payload, artwork) || fallbackSvg : fallbackSvg;
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

module.exports = { extractLines, toImagePayload, installImageMessageHandlers };
