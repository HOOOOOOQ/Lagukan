const mongoose = require("mongoose");

const recentAntiFarmSchema = new mongoose.Schema(
    {
        trackKey: { type: String, required: true },
        awardedAt: { type: Date, default: Date.now },
    },
    { _id: false },
);

const userMusicProfileSchema = new mongoose.Schema(
    {
        userId: { type: String, required: true, unique: true, index: true },
        totalTracksRequested: { type: Number, default: 0 },
        totalTracksStarted: { type: Number, default: 0 },
        totalTracksCompleted: { type: Number, default: 0 },
        totalListeningMs: { type: Number, default: 0, index: true },
        xp: { type: Number, default: 0, index: true },
        level: { type: Number, default: 1 },
        levelTitle: { type: String, default: "New Listener" },
        lastTrack: {
            title: { type: String, default: null },
            author: { type: String, default: null },
            album: { type: String, default: null },
            genre: { type: String, default: null },
            uri: { type: String, default: null },
            artworkUrl: { type: String, default: null },
            source: { type: String, default: null },
            guildId: { type: String, default: null },
            playedAt: { type: Date, default: null },
        },
        lastActiveAt: { type: Date, default: null },
        recentXpAwards: {
            type: [recentAntiFarmSchema],
            default: [],
        },
    },
    { timestamps: true, collection: "UserMusicProfiles" },
);

module.exports = mongoose.models.UserMusicProfiles || mongoose.model("UserMusicProfiles", userMusicProfileSchema);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
