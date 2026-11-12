const { EmbedBuilder } = require("discord.js");
const { createDataGuild, createDataUser } = require("../../../functions/createData.js");
const { permissions } = require("../../../functions/getPermission.js");
const { handleRequestChannelMessage } = require("../../../functions/voiceRequestSystem.js");
const { handleGuessTheSongMessage } = require("../../../functions/musicGamesSystem.js");
const Logger = require("../../../utils/logger");

const MAX_PROCESSED_MESSAGE_IDS = 2000;

function markMessageProcessed(client, messageId) {
    if (!messageId) return false;
    if (!(client._processedMessageIds instanceof Set)) {
        client._processedMessageIds = new Set();
    }
    const key = String(messageId);
    if (client._processedMessageIds.has(key)) {
        return true;
    }
    if (client._processedMessageIds.size >= MAX_PROCESSED_MESSAGE_IDS) {
        const oldest = client._processedMessageIds.values().next().value;
        if (oldest) client._processedMessageIds.delete(oldest);
    }
    client._processedMessageIds.add(key);
    return false;
}

function escapeRegex(str) {
    return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = async (client, message) => {
    if (!message?.guild || message.author?.bot || message.system || message.webhookId) return;
    if (!client.user?.id) return;

    // Deduplicate message ID per bot instance so a message is never processed twice
    if (markMessageProcessed(client, message.id)) return;

    // 1. Active Guess The Song Round Plain-Text Answer Detection (scoped to this bot's active game session)
    const handledGuess = await handleGuessTheSongMessage(client, message).catch(() => false);
    if (handledGuess) return;

    // 2. Dedicated Voice Channel Music Request Panel Input (scoped to the specific bot owning the panel)
    const handledReq = await handleRequestChannelMessage(client, message).catch(() => false);
    if (handledReq) return;

    // 3. Direct Bot Mention ONLY (`<@BOT_ID>` or `<@BOT_ID> <dev_command>`)
    // Shared text prefixes (`666`, `666!`, `!`) are intentionally NOT processed so 8 bots never respond simultaneously.
    const rawContent = String(message.content || "").trim();
    const botIdEscaped = escapeRegex(client.user.id);
    const mentionMatch = rawContent.match(new RegExp(`^<@!?${botIdEscaped}>(?:\\s+([\\s\\S]*))?$`));
    if (!mentionMatch) return;

    if (message.channel?.permissionsFor && message.guild.members?.me) {
        const perms = message.channel.permissionsFor(message.guild.members.me);
        if (perms && (!perms.has("ViewChannel") || !perms.has("SendMessages") || !perms.has("EmbedLinks"))) {
            return;
        }
    }

    await createDataGuild(client, message.guild).catch(() => {});
    await createDataUser(client, message.author).catch(() => {});

    const botName = client.user.username || client.config.botName || "Lagukan";
    const embed = new EmbedBuilder().setColor(client.config.embedColor);
    const remainder = String(mentionMatch[1] || "").trim();

    if (!remainder) {
        embed.setDescription(`Hello! I'm **${botName}**. Use \`/help\` to view available music slash commands.`);
        await message.reply({ embeds: [embed] }).catch(() => {});
        return;
    }

    // Developer-only commands addressed explicitly to this bot (`@Bot lavalink`, `@Bot maintenance`, etc.)
    const isDeveloper = message.author.id === client.config.owner || Boolean(client.config.dev?.includes?.(message.author.id));
    if (!isDeveloper) return;

    const args = remainder.split(/\s+/g);
    const cmd = (args.shift() || "").toLowerCase();
    if (!cmd) return;

    let command = client.prefix.get(cmd);
    if (!command) command = client.prefix.get(client.aliases.get(cmd));
    if (!command) return;

    Logger.info(
        `[DEV-MENTION] [${command.name}] | (${message.author.username})[${message.author.id}] | (${message.guild.name})[${message.guildId}]`,
    );

    return permissions(client, message, command, args);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
