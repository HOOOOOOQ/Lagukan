const chalk = require("chalk");

const SENSITIVE_PATTERNS = [
    /(authorization\s*[:=]\s*)(["']?)[^\s"',}]+(\2)/gi,
    /(password\s*[:=]\s*)(["']?)[^\s"',}]+(\2)/gi,
    /(client_?secret\s*[:=]\s*)(["']?)[^\s"',}]+(\2)/gi,
    /(token\s*[:=]\s*)(["']?)[^\s"',}]+(\2)/gi,
    /(mongodb(?:\+srv)?:\/\/[^:\s/]+:)([^@\s]+)(@)/gi,
    /\b([MN][A-Za-z\d]{23,28}\.[\w-]{6}\.[\w-]{27,38})\b/g,
];

function sanitizeLogString(input) {
    let text = String(input ?? "");
    if (!text) return "";

    text = text
        .replace(SENSITIVE_PATTERNS[0], "$1$2[REDACTED]$3")
        .replace(SENSITIVE_PATTERNS[1], "$1$2[REDACTED]$3")
        .replace(SENSITIVE_PATTERNS[2], "$1$2[REDACTED]$3")
        .replace(SENSITIVE_PATTERNS[3], "$1$2[REDACTED]$3")
        .replace(SENSITIVE_PATTERNS[4], "$1[REDACTED]$3")
        .replace(SENSITIVE_PATTERNS[5], "[REDACTED_DISCORD_TOKEN]");

    const envSecrets = [process.env.TOKEN, process.env.LAVALINK_PASSWORD, process.env.SPOTIFY_CLIENT_SECRET, process.env.MONGO_URI].filter(
        (val) => typeof val === "string" && val.trim().length >= 6 && val !== "youshallnotpass",
    );

    for (const secret of envSecrets) {
        if (text.includes(secret)) {
            text = text.split(secret).join("[REDACTED]");
        }
    }

    return text;
}

/**
 * Logger utility for consistent, credential-safe logging across Lagukan Music Bot
 */
class Logger {
    static sanitize(value) {
        if (value instanceof Error) {
            return sanitizeLogString(value.message || String(value));
        }
        if (typeof value === "object" && value !== null) {
            try {
                return sanitizeLogString(JSON.stringify(value));
            } catch {
                return sanitizeLogString(String(value));
            }
        }
        return sanitizeLogString(value);
    }

    /**
     * Log an informational message
     * @param {string} message - The message to log
     * @param {...any} args - Additional arguments
     */
    static info(message, ...args) {
        console.log(
            chalk.blue("[INFO]"),
            sanitizeLogString(message),
            ...args.map((a) => (typeof a === "string" ? sanitizeLogString(a) : a)),
        );
    }

    /**
     * Log a success message
     * @param {string} message - The message to log
     * @param {...any} args - Additional arguments
     */
    static success(message, ...args) {
        console.log(
            chalk.green("[SUCCESS]"),
            sanitizeLogString(message),
            ...args.map((a) => (typeof a === "string" ? sanitizeLogString(a) : a)),
        );
    }

    /**
     * Log a warning message
     * @param {string} message - The message to log
     * @param {...any} args - Additional arguments
     */
    static warn(message, ...args) {
        console.warn(
            chalk.yellow("[WARN]"),
            sanitizeLogString(message),
            ...args.map((a) => (typeof a === "string" ? sanitizeLogString(a) : a)),
        );
    }

    /**
     * Log an error message
     * @param {string} message - The message to log
     * @param {...any} args - Additional arguments
     */
    static error(message, ...args) {
        console.error(
            chalk.red("[ERROR]"),
            sanitizeLogString(message),
            ...args.map((a) =>
                a instanceof Error ? sanitizeLogString(a.stack || a.message) : typeof a === "string" ? sanitizeLogString(a) : a,
            ),
        );
    }

    /**
     * Log a debug message
     * @param {string} message - The message to log
     * @param {...any} args - Additional arguments
     */
    static debug(message, ...args) {
        if (process.env.DEBUG === "true") {
            console.log(
                chalk.gray("[DEBUG]"),
                sanitizeLogString(message),
                ...args.map((a) => (typeof a === "string" ? sanitizeLogString(a) : a)),
            );
        }
    }

    /**
     * Structured operational music telemetry (guildId, userId, command, playerStatus, nodeStatus, errorMessage)
     * without ever leaking tokens or passwords.
     */
    static music(level, message, context = {}) {
        const structured = {
            guildId: context.guildId ? String(context.guildId) : "-",
            userId: context.userId ? String(context.userId) : "-",
            command: context.command ? String(context.command) : "-",
            playerStatus: context.playerStatus ? String(context.playerStatus) : "-",
            nodeStatus: context.nodeStatus ? String(context.nodeStatus) : "-",
            ...(context.errorMessage ? { errorMessage: Logger.sanitize(context.errorMessage) } : {}),
        };

        const metaStr = Object.entries(structured)
            .map(([k, v]) => `${k}=${v}`)
            .join(" | ");
        const formatted = `[MUSIC] ${sanitizeLogString(message)} [${metaStr}]`;

        if (level === "error") {
            console.error(chalk.red("[ERROR]"), formatted);
        } else if (level === "warn") {
            console.warn(chalk.yellow("[WARN]"), formatted);
        } else if (level === "info") {
            console.log(chalk.blue("[INFO]"), formatted);
        } else if (process.env.DEBUG === "true") {
            console.log(chalk.gray("[DEBUG]"), formatted);
        }
    }

    /**
     * Log an anticrash message
     * @param {string} type - The type of anticrash log
     * @param {string} message - The message to log
     * @param {...any} args - Additional arguments
     */
    static anticrash(type, message, ...args) {
        console.error(
            chalk.red(`[Anticrash] | [${type}] |`),
            sanitizeLogString(message),
            ...args.map((a) =>
                a instanceof Error ? sanitizeLogString(a.stack || a.message) : typeof a === "string" ? sanitizeLogString(a) : a,
            ),
        );
    }
}

module.exports = Logger;

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
