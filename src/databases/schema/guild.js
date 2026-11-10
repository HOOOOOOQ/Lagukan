const mongoose = require("mongoose");

const createGuild = mongoose.Schema({
    id: { type: String, required: true },
    reconnect: {
        status: { type: Boolean, default: false },
        text: { type: String, default: null },
        voice: { type: String, default: null },
    },
});

module.exports = mongoose.model("guild", createGuild);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
