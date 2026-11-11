const DISCORD_EPOCH_MS = 1420070400000n;

function decodeBotSnowflakeFromSegment(segment) {
    try {
        const normalized = String(segment).replace(/-/g, "+").replace(/_/g, "/");
        const padLen = (4 - (normalized.length % 4)) % 4;
        const decoded = Buffer.from(normalized + "=".repeat(padLen), "base64")
            .toString("utf8")
            .trim();
        if (!/^\d{17,21}$/.test(decoded)) return null;

        const snowflake = BigInt(decoded);
        const createdMs = Number((snowflake >> 22n) + DISCORD_EPOCH_MS);
        if (!Number.isFinite(createdMs) || createdMs < 1420070400000 || createdMs > Date.now() + 86_400_000 * 365) {
            return null;
        }
        return decoded;
    } catch {
        return null;
    }
}

async function verifyDiscordBotToken(rawInput) {
    if (typeof rawInput !== "string") {
        return {
            valid: false,
            error: "Discord Bot Token wajib berupa teks.",
        };
    }

    const cleaned = rawInput
        .trim()
        .replace(/^['"]|['"]$/g, "")
        .replace(/^Bot\s+/i, "")
        .trim();

    if (!cleaned) {
        return {
            valid: false,
            error: "Discord Bot Token tidak boleh kosong.",
        };
    }

    if (/\s/.test(cleaned)) {
        return {
            valid: false,
            error: "Discord Bot Token tidak boleh mengandung spasi atau baris baru.",
        };
    }

    const parts = cleaned.split(".");
    if (parts.length !== 3) {
        return {
            valid: false,
            error: "Format Discord Bot Token tidak valid (harus terdiri dari 3 bagian yang dipisahkan titik).",
        };
    }

    const [idSeg, tsSeg, hmacSeg] = parts;
    if (!/^[A-Za-z0-9_-]{18,38}$/.test(idSeg) || !/^[A-Za-z0-9_-]{5,12}$/.test(tsSeg) || !/^[A-Za-z0-9_-]{24,68}$/.test(hmacSeg)) {
        return {
            valid: false,
            error: "Segmen karakter Discord Bot Token tidak sesuai standar Discord Developer Portal.",
        };
    }

    const botId = decodeBotSnowflakeFromSegment(idSeg);
    if (!botId) {
        return {
            valid: false,
            error: "Bagian pertama token bukan Discord Bot Application ID (Snowflake) yang valid.",
        };
    }

    // Attempt live verification against Discord REST API v10 (never logging the token)
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    try {
        const res = await fetch("https://discord.com/api/v10/users/@me", {
            method: "GET",
            headers: {
                Authorization: `Bot ${cleaned}`,
                "User-Agent": "LagukanWebInstaller/1.0 (+https://github.com/HOOOOOOQ/Lagukan)",
            },
            signal: controller.signal,
        });

        clearTimeout(timer);

        if (res.status === 401 || res.status === 403) {
            return {
                valid: false,
                liveVerified: true,
                error: "Discord menolak token ini (401 Unauthorized). Pastikan Anda menyalin Bot Token terbaru dari menu Bot -> Reset Token di Discord Developer Portal.",
            };
        }

        if (res.ok) {
            const profile = await res.json();
            if (!profile?.bot) {
                return {
                    valid: false,
                    liveVerified: true,
                    error: "Token yang dimasukkan bukan akun Bot Discord resmi (akun pengguna tidak diizinkan).",
                };
            }

            return {
                valid: true,
                liveVerified: true,
                formatVerified: true,
                bot: {
                    id: String(profile.id || botId),
                    username: String(profile.username || "LagukanBot"),
                    discriminator: String(profile.discriminator || "0"),
                },
                message: `Token valid & terverifikasi langsung ke Discord API sebagai bot @${profile.username}.`,
            };
        }

        return {
            valid: true,
            liveVerified: false,
            formatVerified: true,
            bot: {
                id: botId,
                username: null,
                discriminator: null,
            },
            message: `Format token & Bot Application ID (${botId}) valid (Discord API sedang merespons status ${res.status}).`,
        };
    } catch {
        clearTimeout(timer);
        return {
            valid: true,
            liveVerified: false,
            formatVerified: true,
            bot: {
                id: botId,
                username: null,
                discriminator: null,
            },
            message: `Format kriptografi token & Bot Application ID (${botId}) valid. Verifikasi penuh akan dilakukan langsung dari Termux ke Discord Gateway.`,
        };
    }
}

module.exports = {
    verifyDiscordBotToken,
    decodeBotSnowflakeFromSegment,
};
