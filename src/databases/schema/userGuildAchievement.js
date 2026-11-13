const mongoose = require("mongoose");

const userGuildAchievementSchema = new mongoose.Schema(
    {
        guildId: { type: String, required: true, index: true },
        userId: { type: String, required: true, index: true },
        achievementId: { type: String, required: true },
        botApplicationId: { type: String, required: true },
        sessionId: { type: String, default: null },
        unlockedAt: { type: Date, default: Date.now },
    },
    { timestamps: true, collection: "UserGuildAchievements" },
);

userGuildAchievementSchema.index({ guildId: 1, userId: 1, achievementId: 1 }, { unique: true });

module.exports = mongoose.models.UserGuildAchievements || mongoose.model("UserGuildAchievements", userGuildAchievementSchema);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
