const mongoose = require("mongoose");

const musicLeaderboardSchema = new mongoose.Schema(
    {
        guildId: { type: String, required: true, index: true },
        userId: { type: String, required: true, index: true },
        periodType: { type: String, enum: ["weekly", "monthly"], required: true },
        periodKey: { type: String, required: true },
        tracksCompleted: { type: Number, default: 0 },
        totalListeningMs: { type: Number, default: 0 },
        xp: { type: Number, default: 0 },
    },
    { timestamps: true, collection: "MusicLeaderboard" },
);

musicLeaderboardSchema.index({ guildId: 1, periodType: 1, periodKey: 1, userId: 1 }, { unique: true });
musicLeaderboardSchema.index({ guildId: 1, periodType: 1, periodKey: 1, totalListeningMs: -1 });

module.exports = mongoose.models.MusicLeaderboard || mongoose.model("MusicLeaderboard", musicLeaderboardSchema);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
