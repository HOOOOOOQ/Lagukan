const mongoose = require("mongoose");

const messageClaimLockSchema = new mongoose.Schema(
    {
        lockKey: { type: String, required: true, unique: true, index: true },
        guildId: { type: String, required: true, index: true },
        messageId: { type: String, required: true },
        ownerBotId: { type: String, required: true },
        status: {
            type: String,
            enum: ["processing", "completed", "failed"],
            default: "processing",
        },
        claimedAt: { type: Date, default: Date.now },
        expiresAt: { type: Date, required: true },
    },
    { timestamps: true, collection: "MessageClaimLocks" },
);

messageClaimLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
messageClaimLockSchema.index({ guildId: 1, messageId: 1 }, { unique: true });

module.exports = mongoose.models.MessageClaimLocks || mongoose.model("MessageClaimLocks", messageClaimLockSchema);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
