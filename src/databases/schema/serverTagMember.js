const mongoose = require("mongoose");

const serverTagMemberSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    username: { type: String, default: null },
    currentTag: {
        identityGuildId: { type: String, default: null },
        identityEnabled: { type: Boolean, default: false },
        tag: { type: String, default: null },
        badge: { type: String, default: null },
    },
    installCount: { type: Number, default: 0 },
    changeCount: { type: Number, default: 0 },
    removeCount: { type: Number, default: 0 },
    hadTagBefore: { type: Boolean, default: false },
    firstInstalledAt: { type: Date, default: null },
    lastAction: { type: String, default: "baseline" },
    lastUpdatedAt: { type: Date, default: Date.now },
    history: { type: Array, default: [] },
});

serverTagMemberSchema.index({ guildId: 1, userId: 1 }, { unique: true });
serverTagMemberSchema.index({ guildId: 1, "currentTag.identityEnabled": 1 });

module.exports = mongoose.models.serverTagMember || mongoose.model("serverTagMember", serverTagMemberSchema);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
