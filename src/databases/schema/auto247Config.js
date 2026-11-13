const mongoose = require("mongoose");

const auto247ConfigSchema = new mongoose.Schema(
    {
        botApplicationId: { type: String, required: true, index: true },
        guildId: { type: String, required: true, index: true },
        voiceChannelId: { type: String, required: true },
        enabled: { type: Boolean, default: true, index: true },
        autoReconnect: { type: Boolean, default: true },
        updatedBy: { type: String, default: null },
    },
    { timestamps: true, collection: "Auto247Config" },
);

auto247ConfigSchema.index({ botApplicationId: 1, guildId: 1 }, { unique: true });

module.exports = mongoose.models.Auto247Config || mongoose.model("Auto247Config", auto247ConfigSchema);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
