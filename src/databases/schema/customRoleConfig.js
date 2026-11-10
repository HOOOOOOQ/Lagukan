const mongoose = require("mongoose");

const customRoleConfigSchema = new mongoose.Schema(
    {
        guildId: { type: String, required: true, unique: true },
        channelId: { type: String, default: null },
        panelMessageId: { type: String, default: null },
        boosterAccessEnabled: { type: Boolean, default: true },
        boosterAccess: { type: Boolean, default: true },
        roleAccessEnabled: { type: Boolean, default: true },
        allowedRoles: { type: [String], default: [] },
        allowedRoleIds: { type: [String], default: [] },
        maxRolesPerMember: { type: Number, default: 1, min: 1, max: 25 },
        roleLimit: { type: Number, default: 1, min: 1, max: 25 },
        customRoleEnabled: { type: Boolean, default: true },
        updatedBy: { type: String, default: null },
    },
    {
        timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" },
    },
);

module.exports = mongoose.models.customRoleConfig || mongoose.model("customRoleConfig", customRoleConfigSchema);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
