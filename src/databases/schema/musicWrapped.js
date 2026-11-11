const mongoose = require("mongoose");

const musicWrappedSchema = new mongoose.Schema(
    {
        userId: { type: String, required: true, index: true },
        guildId: { type: String, default: "global", index: true },
        periodType: { type: String, enum: ["weekly", "monthly"], required: true },
        periodKey: { type: String, required: true },
        totalTracks: { type: Number, default: 0 },
        totalListeningMs: { type: Number, default: 0 },
        topTracks: { type: Array, default: [] },
        topArtists: { type: Array, default: [] },
        favoriteGenre: { type: String, default: null },
        mostActiveDay: { type: String, default: null },
        mostActiveHour: { type: Number, default: null },
        generatedAt: { type: Date, default: Date.now },
    },
    { timestamps: true, collection: "MusicWrapped" },
);

musicWrappedSchema.index({ userId: 1, guildId: 1, periodType: 1, periodKey: 1 }, { unique: true });

module.exports = mongoose.models.MusicWrapped || mongoose.model("MusicWrapped", musicWrappedSchema);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
