const { handleRequestChannelMessage } = require("../../../functions/voiceRequestSystem.js");
const { handleGuessTheSongMessage } = require("../../../functions/musicGamesSystem.js");

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

module.exports = async (client, message) => {
    if (!message?.guild || message.author?.bot || message.system || message.webhookId) return;
    if (!client.user?.id) return;

    // Deduplicate message ID per bot instance so a message is never processed twice
    if (markMessageProcessed(client, message.id)) return;

    // 2. Active Guess The Song Round Plain-Text Answer Detection (scoped to this bot's active game session)
    const handledGuess = await handleGuessTheSongMessage(client, message).catch(() => false);
    if (handledGuess) return;

    // 3. Dedicated Voice Channel Music Request Panel Input (scoped to the specific bot owning the panel)
    const handledReq = await handleRequestChannelMessage(client, message).catch(() => false);
    if (handledReq) return;
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
