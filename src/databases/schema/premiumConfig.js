const mongoose = require("mongoose");

const premiumConfigSchema = new mongoose.Schema(
    {
        targetType: { type: String, enum: ["user", "guild"], required: true, index: true },
        targetId: { type: String, required: true, index: true },
        active: { type: Boolean, default: true, index: true },
        tier: { type: String, enum: ["plus", "vip", "ultimate"], default: "plus" },
        grantedBy: { type: String, default: null },
        grantedAt: { type: Date, default: Date.now },
        expiresAt: { type: Date, default: null },
        note: { type: String, default: "" },
        customAccentColor: { type: String, default: null },
        customDashboardTitle: { type: String, default: null },
    },
    { timestamps: true, collection: "PremiumConfig" },
);

premiumConfigSchema.index({ targetType: 1, targetId: 1 }, { unique: true });

module.exports = mongoose.models.PremiumConfig || mongoose.model("PremiumConfig", premiumConfigSchema);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
