const mongoose = require("mongoose");

const userPlaylistTrackSchema = new mongoose.Schema(
    {
        title: { type: String, required: true },
        author: { type: String, default: "Unknown" },
        album: { type: String, default: null },
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

const userPlaylistSchema = new mongoose.Schema(
    {
        playlistId: { type: String, required: true, unique: true, index: true },
        userId: { type: String, required: true, index: true },
        guildId: { type: String, default: null, index: true },
        scope: { type: String, enum: ["personal", "server"], default: "personal", index: true },
        name: { type: String, required: true },
        normalizedName: { type: String, required: true },
        description: { type: String, default: "" },
        tracks: {
            type: [userPlaylistTrackSchema],
            default: [],
        },
    },
    { timestamps: true, collection: "UserPlaylists" },
);

userPlaylistSchema.index({ userId: 1, scope: 1, normalizedName: 1 });

module.exports = mongoose.models.UserPlaylists || mongoose.model("UserPlaylists", userPlaylistSchema);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
