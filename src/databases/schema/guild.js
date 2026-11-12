const mongoose = require("mongoose");

const historyTrackSchema = new mongoose.Schema(
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
        requesterId: { type: String, default: null },
        requesterTag: { type: String, default: null },
        playedAt: { type: Date, default: Date.now },
    },
    { _id: false },
);

const createGuild = new mongoose.Schema({
    id: { type: String, required: true, index: true },
    manualDisconnect: { type: Boolean, default: false },
    reconnect: {
        status: { type: Boolean, default: false },
        text: { type: String, default: null },
        voice: { type: String, default: null },
        botId: { type: String, default: null },
    },
    voiceLog: {
        enabled: { type: Boolean, default: true },
        timezone: { type: String, default: "Asia/Jakarta" },
        source: { type: String, default: "env" },
    },
    music: {
        defaultVolume: { type: Number, default: 100 },
        autoplay: { type: Boolean, default: false },
        djMode: { type: Boolean, default: false },
        djRoleId: { type: String, default: null },
        autoLeave: {
            enabled: { type: Boolean, default: true },
            timeout: { type: Number, default: 60000 },
        },
    },
    history: {
        type: [historyTrackSchema],
        default: [],
    },
});

module.exports = mongoose.models.guild || mongoose.model("guild", createGuild);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
