const mongoose = require("mongoose");

const favoriteTrackSchema = new mongoose.Schema(
    {
        title: { type: String, default: "Unknown" },
        author: { type: String, default: "Unknown" },
        uri: { type: String, default: "" },
        identifier: { type: String, default: "" },
        duration: { type: Number, default: 0 },
        isStream: { type: Boolean, default: false },
        artworkUrl: { type: String, default: null },
        source: { type: String, default: "music" },
        originalSource: { type: String, default: null },
        addedAt: { type: Date, default: Date.now },
    },
    { _id: false },
);

const createUser = new mongoose.Schema({
    id: { type: String, required: true, index: true },
    ban: {
        status: { type: Boolean, default: false },
        reason: { type: String, default: null },
    },
    favorites: {
        type: [favoriteTrackSchema],
        default: [],
    },
});

module.exports = mongoose.models.user || mongoose.model("user", createUser);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
