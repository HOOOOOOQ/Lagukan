const mongoose = require("mongoose");

const counterEntrySchema = new mongoose.Schema(
    {
        key: { type: String, required: true },
        label: { type: String, required: true },
        subLabel: { type: String, default: null },
        uri: { type: String, default: null },
        plays: { type: Number, default: 0 },
        listenedMs: { type: Number, default: 0 },
    },
    { _id: false },
);

const musicStatisticsSchema = new mongoose.Schema(
    {
        guildId: { type: String, required: true, index: true },
        userId: { type: String, required: true, index: true },
        tracksRequested: { type: Number, default: 0 },
        tracksStarted: { type: Number, default: 0 },
        tracksCompleted: { type: Number, default: 0 },
        totalListeningMs: { type: Number, default: 0 },
        xp: { type: Number, default: 0 },
        topTracks: { type: [counterEntrySchema], default: [] },
        topArtists: { type: [counterEntrySchema], default: [] },
        topGenres: { type: [counterEntrySchema], default: [] },
        lastPlayedAt: { type: Date, default: null },
    },
    { timestamps: true, collection: "MusicStatistics" },
);

musicStatisticsSchema.index({ guildId: 1, userId: 1 }, { unique: true });
musicStatisticsSchema.index({ guildId: 1, totalListeningMs: -1 });
musicStatisticsSchema.index({ guildId: 1, tracksCompleted: -1 });
musicStatisticsSchema.index({ guildId: 1, xp: -1 });

module.exports = mongoose.models.MusicStatistics || mongoose.model("MusicStatistics", musicStatisticsSchema);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
