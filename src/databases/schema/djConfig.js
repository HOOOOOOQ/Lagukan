const mongoose = require("mongoose");

const djConfigSchema = new mongoose.Schema(
    {
        guildId: { type: String, required: true, unique: true, index: true },
        enabled: { type: Boolean, default: false },
        roleId: { type: String, default: null },
        allowRequesterControl: { type: Boolean, default: true },
        allowSoloListenerControl: { type: Boolean, default: true },
        updatedBy: { type: String, default: null },
    },
    { timestamps: true, collection: "DJConfig" },
);

module.exports = mongoose.models.DJConfig || mongoose.model("DJConfig", djConfigSchema);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
