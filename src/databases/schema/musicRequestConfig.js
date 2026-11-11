const mongoose = require("mongoose");

const musicRequestConfigSchema = new mongoose.Schema(
    {
        guildId: { type: String, required: true, unique: true, index: true },
        enabled: { type: Boolean, default: false },
        channelId: { type: String, default: null, index: true },
        messageId: { type: String, default: null },
        cooldownSec: { type: Number, default: 10 },
        maxQueuePerUser: { type: Number, default: 5 },
        linksOnly: { type: Boolean, default: false },
        allowedSources: {
            type: [String],
            default: ["youtube", "youtubeMusic", "spotify", "soundcloud", "deezer", "bandcamp", "http"],
        },
        autoDeleteUserMessage: { type: Boolean, default: true },
        updatedBy: { type: String, default: null },
    },
    { timestamps: true, collection: "MusicRequestConfig" },
);

module.exports = mongoose.models.MusicRequestConfig || mongoose.model("MusicRequestConfig", musicRequestConfigSchema);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
