/**
 * Local Rule-Based Command & Natural Phrase Parser for 666 Text Assistant.
 * Pure JavaScript — zero external AI APIs, zero API keys.
 */

function extractAssistantInput(rawContent) {
    if (typeof rawContent !== "string") {
        return { triggered: false, rawBody: "" };
    }

    const trimmed = rawContent.trim();
    if (!trimmed) {
        return { triggered: false, rawBody: "" };
    }

    // Explicitly do NOT intercept `666!<cmd>` (such as `666!cek` or `666!ban`)
    if (/^666!/i.test(trimmed)) {
        return { triggered: false, rawBody: "" };
    }

    // Match bare `666` (optional ?, .) or `666` followed by whitespace / comma / colon
    const match = trimmed.match(/^666(?:[?.,:]?(?:\s+(.*))?)$/is);
    if (!match) {
        return { triggered: false, rawBody: "" };
    }

    const rawBody = (match[1] || "").trim();
    return {
        triggered: true,
        rawBody,
    };
}

function normalizeSpacing(text) {
    return String(text || "")
        .replace(/\s+/g, " ")
        .trim();
}

function cleanSongQuery(rawQuery, preserveLeadingLagu = false) {
    let q = String(rawQuery || "").trim();
    // Strip surrounding quotes if user typed `666 play "Teh Hijau"`
    q = q.replace(/^["'`]+|["'`]+$/g, "").trim();
    if (!preserveLeadingLagu) {
        q = q.replace(/^(?:lagu|musik)\s+/i, "").trim();
    }
    return q;
}

function parseLoopModeArg(rawArg) {
    const token = String(rawArg || "")
        .trim()
        .toLowerCase();
    if (!token) return null;
    if (["off", "none", "mati", "stop", "disable"].includes(token)) return "none";
    if (["track", "song", "lagu", "satu"].includes(token)) return "song";
    if (["queue", "all", "antrean", "antrian", "semua"].includes(token)) return "queue";
    return null;
}

function parseAssistantCommand(rawContent) {
    const extracted = extractAssistantInput(rawContent);
    if (!extracted.triggered) {
        return { triggered: false };
    }

    const rawBody = extracted.rawBody;
    const normalized = normalizeSpacing(rawBody);

    // Bare `666` -> friendly greeting
    if (!normalized) {
        return {
            triggered: true,
            type: "chat",
            action: "greeting",
            label: "666 halo",
            rawBody,
        };
    }

    // -------------------------------------------------------------------------
    // 1. Help & Guide Commands
    // -------------------------------------------------------------------------
    if (
        /^(?:help|bantuan|panduan|menu|perintah|daftar\s+perintah|list\s+perintah|command|commands|cara\s+pakai|bisa\s+apa(?:\s+aja|\s+saja)?)[?!.]*$/i.test(
            normalized,
        )
    ) {
        return {
            triggered: true,
            type: "help",
            action: "help",
            label: "666 help",
            rawBody,
        };
    }

    // -------------------------------------------------------------------------
    // 2. Music Player Commands (Check Now Playing BEFORE Play so "putar apa" matches cleanly)
    // -------------------------------------------------------------------------
    if (
        /^(?:now\s*playing|np|sekarang\s+(?:lagi\s+)?(?:putar|memutar|nyetel|main|lagu)\s+apa|lagi\s+(?:putar|memutar|nyetel|dengerin)\s+(?:lagu\s+)?apa|sedang\s+(?:putar|memutar)\s+(?:lagu\s+)?apa|(?:judul\s+)?lagu\s+(?:apa\s+(?:ini|sekarang)|sekarang\s+apa)|putar\s+apa\s+sekarang)[?!.]*$/i.test(
            normalized,
        )
    ) {
        return {
            triggered: true,
            type: "music",
            action: "nowplaying",
            label: "666 sekarang putar apa",
            rawBody,
        };
    }

    // Empty play keyword (`666 play` / `666 putar lagu`)
    if (
        /^(?:tolong\s+|coba\s+)?(?:play|putar(?:kan|in)?|setel(?:kan|in)?|stel|mainkan|nyalakan)(?:\s+(?:lagu|musik))?[?!.]*$/i.test(
            normalized,
        )
    ) {
        return {
            triggered: true,
            type: "music",
            action: "play",
            query: "",
            label: "666 play",
            rawBody,
        };
    }

    // `666 play <query>`
    const directPlayMatch = rawBody.match(/^(?:tolong\s+|coba\s+)?play\s+(.+)$/is);
    if (directPlayMatch) {
        return {
            triggered: true,
            type: "music",
            action: "play",
            query: cleanSongQuery(directPlayMatch[1], true),
            label: "666 play",
            rawBody,
        };
    }

    // `666 putar lagu <query>`, `666 setel <query>`, `666 mainkan lagu <query>`, etc.
    const naturalPlayMatch = rawBody.match(
        /^(?:tolong\s+|coba\s+)?(?:putar(?:kan|in)?|setel(?:kan|in)?|stel(?:kan|in)?|mainkan|nyalakan|request)\s+(?:lagu\s+|musik\s+)?(.+)$/is,
    );
    if (naturalPlayMatch) {
        return {
            triggered: true,
            type: "music",
            action: "play",
            query: cleanSongQuery(naturalPlayMatch[1], false),
            label: "666 putar lagu",
            rawBody,
        };
    }

    // `666 pause`
    if (
        /^(?:tolong\s+)?(?:pause(?:\s+(?:lagu|musik|dulu))?|jeda(?:\s+(?:lagu|musik|dulu))?|tahan\s+(?:lagu|musik))[?!.]*$/i.test(
            normalized,
        )
    ) {
        return {
            triggered: true,
            type: "music",
            action: "pause",
            label: "666 pause",
            rawBody,
        };
    }

    // `666 resume`
    if (/^(?:tolong\s+)?(?:resume|unpause|lanjut(?:kan)?(?:\s+(?:lagu|musik|putar|pemutaran))?|play\s+lagi)[?!.]*$/i.test(normalized)) {
        return {
            triggered: true,
            type: "music",
            action: "resume",
            label: "666 resume",
            rawBody,
        };
    }

    // `666 skip`
    if (/^(?:tolong\s+)?(?:skip|next|lewati(?:\s+lagu)?|ganti\s+lagu|lagu\s+(?:selanjutnya|berikutnya))[?!.]*$/i.test(normalized)) {
        return {
            triggered: true,
            type: "music",
            action: "skip",
            label: "666 skip",
            rawBody,
        };
    }

    // `666 previous`
    if (/^(?:tolong\s+)?(?:previous|prev|back|lagu\s+sebelumnya|putar\s+sebelumnya)[?!.]*$/i.test(normalized)) {
        return {
            triggered: true,
            type: "music",
            action: "previous",
            label: "666 previous",
            rawBody,
        };
    }

    // `666 stop`
    if (
        /^(?:tolong\s+)?(?:stop(?:\s+(?:lagu|musik|player))?|berhenti(?:\s+putar)?|hentikan\s+(?:lagu|musik|pemutaran)|matikan\s+(?:lagu|musik))[?!.]*$/i.test(
            normalized,
        )
    ) {
        return {
            triggered: true,
            type: "music",
            action: "stop",
            label: "666 stop",
            rawBody,
        };
    }

    // `666 leave`
    if (/^(?:tolong\s+)?(?:leave|disconnect|dc|keluar(?:\s+(?:dari\s+)?(?:voice|vc|channel))?)[?!.]*$/i.test(normalized)) {
        return {
            triggered: true,
            type: "music",
            action: "leave",
            label: "666 leave",
            rawBody,
        };
    }

    // `666 volume 50` / `666 volume`
    const volSetMatch = normalized.match(
        /^(?:tolong\s+)?(?:(?:atur|ubah|set|ganti|naikkan|turunkan)\s+)?(?:volume|vol|suara)(?:\s+(?:ke|jadi|menjadi))?\s+(-?\d+)\s*%?[?!.]*$/i,
    );
    if (volSetMatch) {
        return {
            triggered: true,
            type: "music",
            action: "volume",
            value: Number(volSetMatch[1]),
            label: `666 volume ${volSetMatch[1]}`,
            rawBody,
        };
    }

    if (/^(?:cek\s+|lihat\s+)?(?:volume|vol|berapa\s+volume(?:\s+sekarang)?)[?!.]*$/i.test(normalized)) {
        return {
            triggered: true,
            type: "music",
            action: "volume",
            value: null,
            label: "666 volume",
            rawBody,
        };
    }

    // `666 queue`
    if (
        /^(?:lihat\s+|cek\s+|tampilkan\s+)?(?:queue|q|antrean|antrian|daftar\s+(?:lagu|antrean|antrian)|list\s+(?:lagu|antrean|antrian))[?!.]*$/i.test(
            normalized,
        )
    ) {
        return {
            triggered: true,
            type: "music",
            action: "queue",
            label: "666 queue",
            rawBody,
        };
    }

    // `666 shuffle`
    if (/^(?:tolong\s+)?(?:shuffle|acak(?:\s+(?:lagu|antrean|antrian|queue))?)[?!.]*$/i.test(normalized)) {
        return {
            triggered: true,
            type: "music",
            action: "shuffle",
            label: "666 shuffle",
            rawBody,
        };
    }

    // `666 loop [mode]`
    const loopMatch = normalized.match(/^(?:tolong\s+)?(?:loop|repeat|ulang(?:i)?)(?:\s+(\w+))?[?!.]*$/i);
    if (loopMatch) {
        return {
            triggered: true,
            type: "music",
            action: "loop",
            mode: parseLoopModeArg(loopMatch[1]),
            label: "666 loop",
            rawBody,
        };
    }

    // -------------------------------------------------------------------------
    // 3. Stories & Dongeng Commands (6 Categories)
    // -------------------------------------------------------------------------
    if (/\b(?:cerita|kisah|dongeng)\s+(?:horor|horror|seram|mistis|hantu|misteri)\b|^horor[?!.]*$/i.test(normalized)) {
        return {
            triggered: true,
            type: "story",
            category: "horor",
            label: "666 cerita horor",
            rawBody,
        };
    }

    if (/\b(?:cerita|kisah)\s+(?:romantis|cinta|baper|asmara|kasih)\b|^romantis[?!.]*$/i.test(normalized)) {
        return {
            triggered: true,
            type: "story",
            category: "romantis",
            label: "666 cerita romantis",
            rawBody,
        };
    }

    if (/\b(?:cerita|kisah)\s+(?:lucu|kocak|komedi|jenaka|humor)\b|^(?:hibur\s+aku|ngelawak(?:\s+dong)?|humor)[?!.]*$/i.test(normalized)) {
        return {
            triggered: true,
            type: "story",
            category: "lucu",
            label: "666 cerita lucu",
            rawBody,
        };
    }

    if (/\b(?:cerita|kisah|dongeng)\s+(?:fantasi|petualangan|sihir|naga|kerajaan)\b|^fantasi[?!.]*$/i.test(normalized)) {
        return {
            triggered: true,
            type: "story",
            category: "fantasi",
            label: "666 cerita fantasi",
            rawBody,
        };
    }

    if (/\b(?:buat(?:kan|in)?\s+)?(?:cerita\s+pendek|cerpen)\b|^(?:ceritain|ceritakan)\s+sesuatu[?!.]*$/i.test(normalized)) {
        return {
            triggered: true,
            type: "story",
            category: "pendek",
            label: "666 buat cerita pendek",
            rawBody,
        };
    }

    if (
        /\b(?:dongengin(?:\s+aku|\s+dong)?|dongeng(?:kan)?|bacakan\s+dongeng|cerita\s+pengantar\s+tidur)\b|^(?:dongeng|cerita|bercerita)[?!.]*$/i.test(
            normalized,
        )
    ) {
        return {
            triggered: true,
            type: "story",
            category: "dongeng",
            label: "666 dongengin aku",
            rawBody,
        };
    }

    // -------------------------------------------------------------------------
    // 4. Local Conversation & Smart Keyword Matching
    // -------------------------------------------------------------------------
    if (/\b(?:selamat\s+pagi|met\s+pagi|pagi\s+666|good\s*morning)\b|^pagi[?!.]*$/i.test(normalized)) {
        return { triggered: true, type: "chat", action: "morning", label: "666 selamat pagi", rawBody };
    }

    if (/\b(?:selamat\s+(?:siang|sore)|met\s+(?:siang|sore)|good\s*afternoon)\b|^(?:siang|sore)[?!.]*$/i.test(normalized)) {
        return { triggered: true, type: "chat", action: "afternoon", label: "666 selamat siang/sore", rawBody };
    }

    if (/\b(?:selamat\s+malam|met\s+malam|good\s*night|mau\s+tidur|selamat\s+tidur)\b|^malam[?!.]*$/i.test(normalized)) {
        return { triggered: true, type: "chat", action: "night", label: "666 selamat malam", rawBody };
    }

    if (
        /\b(?:apa\s+kabar(?:mu|nya)?|gimana\s+kabar(?:mu|nya)?|bagaimana\s+kabar(?:mu|nya)?|kabar\s+gimana|kamu\s+sehat)\b/i.test(
            normalized,
        )
    ) {
        return { triggered: true, type: "chat", action: "how_are_you", label: "666 apa kabar", rawBody };
    }

    if (/\b(?:terima\s*kasih|makasih|thank\s*you|thanks|thx|hatur\s+nuhun|nuhun|tengkyu)\b/i.test(normalized)) {
        return { triggered: true, type: "chat", action: "thanks", label: "666 terima kasih", rawBody };
    }

    if (
        /\b(?:siapa\s+(?:kamu|dirimu|namamu|nama\s+kamu|666)|kamu\s+(?:itu\s+)?siapa|kenalan\s+dong|apa\s+itu\s+666|apakah\s+kamu\s+ai|kamu\s+pakai\s+ai)\b/i.test(
            normalized,
        )
    ) {
        return { triggered: true, type: "chat", action: "identity", label: "666 siapa kamu", rawBody };
    }

    if (
        /\b(?:kamu\s+(?:sangat\s+|banget\s+)?(?:lucu|keren|pintar|hebat|baik|asik|gemas|ramah)|666\s+(?:keren|hebat|lucu)|mantap(?:\s+jiwa|\s+banget)?|good\s+job|keren\s+banget)\b/i.test(
            normalized,
        )
    ) {
        return { triggered: true, type: "chat", action: "compliment", label: "666 kamu lucu", rawBody };
    }

    if (/\b(?:aku\s+(?:lagi\s+)?(?:sedih|galau|capek|lelah|kesepian)|lagi\s+(?:sedih|galau|bad\s*mood|capek))\b/i.test(normalized)) {
        return { triggered: true, type: "chat", action: "mood_sad", label: "666 teman curhat", rawBody };
    }

    if (/\b(?:aku\s+(?:lagi\s+)?(?:bosan|bosen|gabut)|lagi\s+(?:bosan|bosen|gabut)|enaknya\s+ngapain)\b/i.test(normalized)) {
        return { triggered: true, type: "chat", action: "mood_bored", label: "666 hiburan", rawBody };
    }

    if (/\b(?:rekomendasi\s+lagu|saran\s+lagu|lagu\s+(?:yang\s+)?enak(?:\s+apa)?|kasih\s+lagu\s+enak)\b/i.test(normalized)) {
        return { triggered: true, type: "chat", action: "music_recommend", label: "666 rekomendasi lagu", rawBody };
    }

    if (/\b(?:jam\s+berapa|tanggal\s+berapa|hari\s+apa(?:\s+sekarang|\s+ini)?)\b/i.test(normalized)) {
        return { triggered: true, type: "chat", action: "time_today", label: "666 info waktu", rawBody };
    }

    if (/^(?:halo+|hai+|hi+|hey+|hei+|oi+|oy+|assalamu'?alaikum|permisi|punten|pagi|malam|p)(?:\s+666)?[?!.,\s]*$/i.test(normalized)) {
        return { triggered: true, type: "chat", action: "greeting", label: "666 halo", rawBody };
    }

    // -------------------------------------------------------------------------
    // 5. Fallback for Unrecognized Input
    // -------------------------------------------------------------------------
    return {
        triggered: true,
        type: "unknown",
        action: "unknown",
        label: "Perintah Tidak Dikenali",
        rawBody,
    };
}

module.exports = {
    extractAssistantInput,
    parseAssistantCommand,
    cleanSongQuery,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
