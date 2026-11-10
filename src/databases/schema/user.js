const mongoose = require("mongoose");

const createUser = mongoose.Schema({
    id: { type: String, required: true },
    ban: {
        status: { type: Boolean, default: false },
        reason: { type: String, default: null },
    },
});

module.exports = mongoose.model("user", createUser);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
