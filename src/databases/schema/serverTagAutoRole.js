const mongoose = require("mongoose");

const serverTagAutoRoleSchema = new mongoose.Schema(
    {
        guildId: { type: String, required: true, unique: true },
        enabled: { type: Boolean, default: false },
        roleId: { type: String, default: null },
        configuredBy: { type: String, default: null },
        assignedUsers: { type: [String], default: [] },
    },
    {
        timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" },
    },
);

module.exports = mongoose.models.serverTagAutoRole || mongoose.model("serverTagAutoRole", serverTagAutoRoleSchema);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
