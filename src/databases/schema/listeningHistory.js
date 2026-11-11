const mongoose = require("mongoose");

const listeningHistorySchema = new mongoose.Schema(
    {
        eventKey: { type: String, required: true, unique: true, index: true },
        userId: { type: String, required: true, index: true },
        guildId: { type: String, required: true, index: true },
        requesterId: { type: String, default: null, index: true },
        trackKey: { type: String, required: true, index: true },
        title: { type: String, required: true },
        author: { type: String, default: "Unknown" },
        album: { type: String, default: null },
        genre: { type: String, default: null },
        uri: { type: String, default: "" },
        identifier: { type: String, default: "" },
        artworkUrl: { type: String, default: null },
        source: { type: String, default: "music" },
        duration: { type: Number, default: 0 },
        listenedMs: { type: Number, default: 0 },
        xpAwarded: { type: Number, default: 0 },
        status: {
            type: String,
            enum: ["requested", "started", "completed", "stopped", "failed"],
            default: "started",
            index: true,
        },
        dayOfWeek: { type: Number, default: 0 },
        hourOfDay: { type: Number, default: 0 },
        startedAt: { type: Date, default: Date.now, index: true },
        endedAt: { type: Date, default: null },
    },
    { timestamps: true, collection: "ListeningHistory" },
);

listeningHistorySchema.index({ userId: 1, status: 1, startedAt: -1 });
listeningHistorySchema.index({ guildId: 1, status: 1, startedAt: -1 });

module.exports = mongoose.models.ListeningHistory || mongoose.model("ListeningHistory", listeningHistorySchema);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
