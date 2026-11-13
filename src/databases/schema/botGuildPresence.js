const mongoose = require("mongoose");

const botGuildPresenceSchema = new mongoose.Schema(
    {
        guildId: { type: String, required: true, index: true },
        botApplicationId: { type: String, required: true, index: true },
        botTag: { type: String, default: null },
        lastSeenAt: { type: Date, default: Date.now },
        expiresAt: { type: Date, required: true },
    },
    { timestamps: true, collection: "BotGuildPresence" },
);

botGuildPresenceSchema.index({ guildId: 1, botApplicationId: 1 }, { unique: true });
botGuildPresenceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.BotGuildPresence || mongoose.model("BotGuildPresence", botGuildPresenceSchema);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
