const mongoose = require("mongoose");

const favoriteTrackItemSchema = new mongoose.Schema(
    {
        userId: { type: String, required: true, index: true },
        trackKey: { type: String, required: true },
        title: { type: String, required: true },
        author: { type: String, default: "Unknown" },
        album: { type: String, default: null },
        genre: { type: String, default: null },
        uri: { type: String, default: "" },
        identifier: { type: String, default: "" },
        duration: { type: Number, default: 0 },
        isStream: { type: Boolean, default: false },
        artworkUrl: { type: String, default: null },
        source: { type: String, default: "music" },
        originalSource: { type: String, default: null },
        addedAt: { type: Date, default: Date.now },
    },
    { timestamps: true, collection: "FavoriteTracks" },
);

favoriteTrackItemSchema.index({ userId: 1, trackKey: 1 }, { unique: true });

module.exports = mongoose.models.FavoriteTracks || mongoose.model("FavoriteTracks", favoriteTrackItemSchema);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
