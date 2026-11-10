const mongoose = require("mongoose");

const serverTagConfigSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    guildName: { type: String, default: null },
    logChannelId: { type: String, default: null },
    enabled: { type: Boolean, default: false },
    detectedServerTag: {
        tag: { type: String, default: null },
        badge: { type: String, default: null },
        updatedAt: { type: Date, default: null },
    },
    statistics: {
        installed: { type: Number, default: 0 },
        changed: { type: Number, default: 0 },
        removed: { type: Number, default: 0 },
    },
    recentHistory: { type: Array, default: [] },
    updatedBy: { type: String, default: null },
    updatedAt: { type: Date, default: null },
});

module.exports = mongoose.models.serverTagConfig || mongoose.model("serverTagConfig", serverTagConfigSchema);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
