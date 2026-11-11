const mongoose = require("mongoose");

const musicPartySchema = new mongoose.Schema(
    {
        guildId: { type: String, required: true, unique: true, index: true },
        partyId: { type: String, required: true },
        active: { type: Boolean, default: true, index: true },
        name: { type: String, default: "Lagukan Music Party" },
        hostId: { type: String, required: true },
        voiceChannelId: { type: String, required: true },
        textChannelId: { type: String, default: null },
        members: { type: [String], default: [] },
        voteSkipIds: { type: [String], default: [] },
    },
    { timestamps: true, collection: "MusicParty" },
);

module.exports = mongoose.models.MusicParty || mongoose.model("MusicParty", musicPartySchema);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
