const mongoose = require("mongoose");

const profileNotificationConfigSchema = new mongoose.Schema(
    {
        botApplicationId: { type: String, required: true, index: true },
        guildId: { type: String, required: true, index: true },
        voiceChannelId: { type: String, required: true, index: true },
        notificationChannelId: { type: String, default: null },
        useVoiceChannelChat: { type: Boolean, default: true },
        enabled: { type: Boolean, default: true },
        updatedBy: { type: String, default: null },
    },
    { timestamps: true, collection: "ProfileNotificationConfig" },
);

profileNotificationConfigSchema.index({ botApplicationId: 1, guildId: 1, voiceChannelId: 1 }, { unique: true });

module.exports = mongoose.models.ProfileNotificationConfig || mongoose.model("ProfileNotificationConfig", profileNotificationConfigSchema);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
