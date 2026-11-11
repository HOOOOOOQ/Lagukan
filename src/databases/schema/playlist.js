const mongoose = require("mongoose");

const playlistTrackSchema = new mongoose.Schema(
    {
        title: { type: String, required: true },
        author: { type: String, default: "Unknown" },
        uri: { type: String, required: true },
        identifier: { type: String, default: "" },
        duration: { type: Number, default: 0 },
        isStream: { type: Boolean, default: false },
        artworkUrl: { type: String, default: null },
        source: { type: String, default: "music" },
        originalSource: { type: String, default: null },
        addedBy: { type: String, default: null },
        addedAt: { type: Date, default: Date.now },
    },
    { _id: false },
);

const createPlaylist = new mongoose.Schema(
    {
        playlistId: { type: String, required: true, unique: true, index: true },
        name: { type: String, required: true },
        normalizedName: { type: String, required: true },
        scope: { type: String, enum: ["personal", "server"], default: "personal", index: true },
        ownerId: { type: String, required: true, index: true },
        guildId: { type: String, default: null, index: true },
        description: { type: String, default: "" },
        tracks: {
            type: [playlistTrackSchema],
            default: [],
        },
    },
    { timestamps: true },
);

createPlaylist.index({ scope: 1, ownerId: 1, normalizedName: 1 });
createPlaylist.index({ scope: 1, guildId: 1, normalizedName: 1 });

module.exports = mongoose.models.playlist || mongoose.model("playlist", createPlaylist);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
