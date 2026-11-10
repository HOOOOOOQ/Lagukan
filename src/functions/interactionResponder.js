const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const Logger = require("../utils/logger");

function isUnknownInteractionError(error) {
    if (!error) return false;
    return error.code === 10062 || error.rawError?.code === 10062 || String(error.message || "").includes("Unknown interaction");
}

function isUnknownMessageError(error) {
    if (!error) return false;
    return error.code === 10008 || error.rawError?.code === 10008 || String(error.message || "").includes("Unknown Message");
}

function isInvalidWebhookTokenError(error) {
    if (!error) return false;
    return error.code === 50027 || error.rawError?.code === 50027 || String(error.message || "").includes("Invalid Webhook Token");
}

function isAlreadyAcknowledgedError(error) {
    if (!error) return false;
    const text = String(error.code || error.name || error.message || "");
    return (
        error.code === 40060 ||
        error.rawError?.code === 40060 ||
        error.code === "InteractionAlreadyReplied" ||
        text.includes("InteractionAlreadyReplied") ||
        text.toLowerCase().includes("already been acknowledged")
    );
}

function isInteractionLike(target) {
    if (!target || typeof target !== "object") return false;
    return (
        typeof target.isRepliable === "function" ||
        typeof target.deferReply === "function" ||
        typeof target.deferUpdate === "function" ||
        "deferred" in target
    );
}

function stripReplyOnlyFields(payload) {
    if (!payload || typeof payload !== "object") return payload;
    const { flags, ephemeral, withResponse, fetchReply, ...rest } = payload;
    return rest;
}

function getCommandLabel(interaction) {
    if (!interaction) return "unknown";
    if (interaction.commandName) return `/${interaction.commandName}`;
    if (interaction.customId) return `component:${interaction.customId}`;
    return "interaction";
}

function buildSupportComponents(client, label = "Support Server") {
    const rawUrl = String(client?.config?.supportServerUrl || "").trim();
    if (!/^https?:\/\/\S+/i.test(rawUrl)) {
        return [];
    }

    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel(label).setURL(rawUrl).setStyle(ButtonStyle.Link));

    return [row];
}

/**
 * Safely acknowledges a slash command within Discord's 3-second window using `interaction.deferReply()`.
 * - Never calls `deferReply()` more than once.
 * - Never retries on `10062` (expired interaction token).
 * - Returns `true` if the interaction is deferred and ready for `safeEditReply()`, otherwise `false`.
 */
async function safeDeferReply(interaction, options = {}) {
    if (!interaction || typeof interaction.deferReply !== "function") {
        return false;
    }

    if (interaction.replied) {
        Logger.debug(`[Interaction] Lewati deferReply ganda pada ${getCommandLabel(interaction)} (sudah replied).`);
        return false;
    }

    if (interaction.deferred) {
        return true;
    }

    try {
        await interaction.deferReply(options);
        return true;
    } catch (error) {
        if (isUnknownInteractionError(error)) {
            Logger.warn(
                `[Interaction] Token kedaluwarsa (DiscordAPIError 10062) saat deferReply pada ${getCommandLabel(interaction)}. Pengiriman respons dihentikan tanpa retry.`,
            );
            return false;
        }

        if (isAlreadyAcknowledgedError(error)) {
            Logger.debug(`[Interaction] Interaksi ${getCommandLabel(interaction)} sudah pernah di-acknowledge sebelum deferReply selesai.`);
            return Boolean(interaction.deferred && !interaction.replied);
        }

        Logger.error(`[Interaction] Gagal menjalankan deferReply pada ${getCommandLabel(interaction)}:`, error);
        return false;
    }
}

/**
 * Safely edits a deferred interaction response (`interaction.editReply()`).
 * - Never calls `reply()` after `deferReply()`.
 * - Handles `10062` and `10008` gracefully without throwing unhandled rejections.
 */
async function safeEditReply(interaction, payload) {
    if (!interaction) return null;

    if (!interaction.deferred && !interaction.replied) {
        return safeReply(interaction, payload);
    }

    const editPayload = stripReplyOnlyFields(payload);

    try {
        return await interaction.editReply(editPayload);
    } catch (error) {
        if (isUnknownInteractionError(error) || isUnknownMessageError(error) || isInvalidWebhookTokenError(error)) {
            Logger.warn(
                `[Interaction] Token atau pesan tidak ditemukan (${error.code || 10062}) saat editReply pada ${getCommandLabel(interaction)}.`,
            );
            return null;
        }

        Logger.error(`[Interaction] Gagal menjalankan editReply pada ${getCommandLabel(interaction)}:`, error);
        return null;
    }
}

/**
 * Safely replies to an interaction (or prefix Message in shared permission guards).
 * - Automatically routes to `editReply()` if `interaction.deferred` is already true.
 * - Blocks duplicate replies when `interaction.replied` is already true.
 * - Catches `10062` (`Unknown interaction`) and `InteractionAlreadyReplied` cleanly without retry loops.
 */
async function safeReply(target, payload) {
    if (!target) return null;

    // Support prefix command `Message` objects passed through shared `getPermission.js`
    if (!isInteractionLike(target)) {
        if (typeof target.reply !== "function") return null;
        const msgPayload = stripReplyOnlyFields(payload);
        return target.reply(msgPayload).catch((err) => {
            Logger.error("[Message] Gagal mengirim balasan pesan prefix:", err);
            return null;
        });
    }

    if (typeof target.isRepliable === "function" && !target.isRepliable()) {
        return null;
    }

    if (target.replied) {
        Logger.debug(`[Interaction] Cegah respons ganda pada ${getCommandLabel(target)} (sudah replied).`);
        return null;
    }

    if (target.deferred) {
        return safeEditReply(target, payload);
    }

    try {
        return await target.reply(payload);
    } catch (error) {
        if (isUnknownInteractionError(error)) {
            Logger.warn(
                `[Interaction] Token kedaluwarsa (DiscordAPIError 10062) saat reply pada ${getCommandLabel(target)}. Tidak dilakukan retry.`,
            );
            return null;
        }

        if (isAlreadyAcknowledgedError(error)) {
            if (target.deferred && !target.replied) {
                return safeEditReply(target, payload);
            }
            Logger.debug(`[Interaction] Cegah respons ganda (InteractionAlreadyReplied) pada ${getCommandLabel(target)}.`);
            return null;
        }

        Logger.error(`[Interaction] Gagal menjalankan reply pada ${getCommandLabel(target)}:`, error);
        return null;
    }
}

/**
 * Safely sends a follow-up message only when an interaction has already been deferred or replied to.
 */
async function safeFollowUp(interaction, payload) {
    if (!interaction) return null;

    if (!interaction.deferred && !interaction.replied) {
        return safeReply(interaction, payload);
    }

    try {
        return await interaction.followUp(payload);
    } catch (error) {
        if (isUnknownInteractionError(error) || isInvalidWebhookTokenError(error)) {
            Logger.warn(
                `[Interaction] Token kedaluwarsa (DiscordAPIError ${error.code || 10062}) saat followUp pada ${getCommandLabel(interaction)}.`,
            );
            return null;
        }

        Logger.error(`[Interaction] Gagal menjalankan followUp pada ${getCommandLabel(interaction)}:`, error);
        return null;
    }
}

/**
 * Safely acknowledges a button / select-menu interaction via `deferUpdate()`.
 */
async function safeDeferUpdate(componentInteraction) {
    if (!componentInteraction || typeof componentInteraction.deferUpdate !== "function") {
        return false;
    }

    if (componentInteraction.deferred || componentInteraction.replied) {
        return false;
    }

    try {
        await componentInteraction.deferUpdate();
        return true;
    } catch (error) {
        if (isUnknownInteractionError(error) || isAlreadyAcknowledgedError(error)) {
            return false;
        }

        Logger.error(`[Interaction] Gagal menjalankan deferUpdate pada ${getCommandLabel(componentInteraction)}:`, error);
        return false;
    }
}

module.exports = {
    isUnknownInteractionError,
    isUnknownMessageError,
    isInvalidWebhookTokenError,
    isAlreadyAcknowledgedError,
    buildSupportComponents,
    safeDeferReply,
    safeEditReply,
    safeReply,
    safeFollowUp,
    safeDeferUpdate,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
