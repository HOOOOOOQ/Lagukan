const mongoose = require("mongoose");

const createGuild = mongoose.Schema({
    id: { type: String, required: true },
    manualDisconnect: { type: Boolean, default: false },
    reconnect: {
        status: { type: Boolean, default: false },
        text: { type: String, default: null },
        voice: { type: String, default: null },
    },
    voiceLog: {
        enabled: { type: Boolean, default: true },
        timezone: { type: String, default: "Asia/Jakarta" },
        source: { type: String, default: "env" },
    },
});

module.exports = mongoose.models.guild || mongoose.model("guild", createGuild);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
