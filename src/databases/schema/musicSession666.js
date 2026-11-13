const mongoose = require("mongoose");

const musicSession666Schema = new mongoose.Schema(
    {
        botApplicationId: { type: String, required: true, index: true },
        guildId: { type: String, required: true, index: true },
        voiceChannelId: { type: String, required: true },
        playerId: { type: String, required: true },
        sessionId: { type: String, required: true, unique: true, index: true },
        notificationChannelId: { type: String, default: null },
        nowPlayingMessageId: { type: String, default: null },
        active: { type: Boolean, default: true, index: true },
        startedAt: { type: Date, default: Date.now },
        endedAt: { type: Date, default: null },
    },
    { timestamps: true, collection: "MusicSession666" },
);

musicSession666Schema.index({ botApplicationId: 1, guildId: 1, active: 1 });

module.exports = mongoose.models.MusicSession666 || mongoose.model("MusicSession666", musicSession666Schema);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
