const mongoose = require("mongoose");

const customRoleSchema = new mongoose.Schema(
    {
        guildId: { type: String, required: true },
        userId: { type: String, required: true },
        roleId: { type: String, required: true },
        roleName: { type: String, required: true },
        color: { type: String, default: "#00E5FF" },
        gradient: {
            enabled: { type: Boolean, default: false },
            mode: { type: String, default: "two_color" },
            colors: { type: [String], default: [] },
            direction: { type: String, default: "horizontal" },
            appliedMode: { type: String, default: "none" },
        },
        imageUrl: { type: String, default: null },
        imageMeta: {
            fileName: { type: String, default: null },
            contentType: { type: String, default: null },
            size: { type: Number, default: 0 },
            width: { type: Number, default: null },
            height: { type: Number, default: null },
            appliedToDiscord: { type: Boolean, default: false },
        },
    },
    {
        timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" },
    },
);

customRoleSchema.index({ guildId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.models.customRole || mongoose.model("customRole", customRoleSchema);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
