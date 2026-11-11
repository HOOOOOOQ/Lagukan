const mongoose = require("mongoose");

const musicBattleSchema = new mongoose.Schema(
    {
        guildId: { type: String, required: true, index: true },
        userId: { type: String, required: true, index: true },
        wins: { type: Number, default: 0, index: true },
        losses: { type: Number, default: 0 },
        ties: { type: Number, default: 0 },
        totalVotesReceived: { type: Number, default: 0 },
        battlesPlayed: { type: Number, default: 0 },
        lastBattleAt: { type: Date, default: null },
    },
    { timestamps: true, collection: "MusicBattle" },
);

musicBattleSchema.index({ guildId: 1, userId: 1 }, { unique: true });
musicBattleSchema.index({ guildId: 1, wins: -1, totalVotesReceived: -1 });

module.exports = mongoose.models.MusicBattle || mongoose.model("MusicBattle", musicBattleSchema);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
