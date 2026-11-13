const mongoose = require("mongoose");

const favoriteSongEntrySchema = new mongoose.Schema(
    {
        trackKey: { type: String, required: true },
        title: { type: String, required: true },
        author: { type: String, default: "Unknown" },
        uri: { type: String, default: null },
        artworkUrl: { type: String, default: null },
        plays: { type: Number, default: 0 },
        listenedSeconds: { type: Number, default: 0 },
        lastPlayedAt: { type: Date, default: null },
    },
    { _id: false },
);

const achievementRecordSchema = new mongoose.Schema(
    {
        id: { type: String, required: true },
        unlockedAt: { type: Date, default: Date.now },
    },
    { _id: false },
);

const profile666StatsSchema = new mongoose.Schema(
    {
        botApplicationId: { type: String, required: true, index: true },
        guildId: { type: String, required: true, index: true },
        userId: { type: String, required: true, index: true },
        totalPlays: { type: Number, default: 0 },
        completedPlays: { type: Number, default: 0 },
        totalListeningSeconds: { type: Number, default: 0 },
        favoriteSongs: { type: [favoriteSongEntrySchema], default: [] },
        achievements: { type: [achievementRecordSchema], default: [] },
        lastPlayedAt: { type: Date, default: null },
    },
    { timestamps: true, collection: "Profile666Stats" },
);

profile666StatsSchema.index({ botApplicationId: 1, guildId: 1, userId: 1 }, { unique: true });
profile666StatsSchema.index({ guildId: 1, totalListeningSeconds: -1, totalPlays: -1 });
profile666StatsSchema.index({ botApplicationId: 1, guildId: 1, totalListeningSeconds: -1 });

module.exports = mongoose.models.Profile666Stats || mongoose.model("Profile666Stats", profile666StatsSchema);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
