const mongoose = require("mongoose");

const customRolePolicySchema = new mongoose.Schema(
    {
        guildId: { type: String, required: true, unique: true },
        accessMode: { type: String, default: "admin_only" }, // "admin_only" | "boosters" | "role_required" | "all_members"
        requiredRoleId: { type: String, default: null },
        updatedBy: { type: String, default: null },
    },
    {
        timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" },
    },
);

module.exports = mongoose.models.customRolePolicy || mongoose.model("customRolePolicy", customRolePolicySchema);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
