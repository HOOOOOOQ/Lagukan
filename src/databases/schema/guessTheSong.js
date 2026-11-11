const mongoose = require("mongoose");

const guessTheSongSchema = new mongoose.Schema(
    {
        guildId: { type: String, required: true, index: true },
        userId: { type: String, required: true, index: true },
        points: { type: Number, default: 0, index: true },
        correctGuesses: { type: Number, default: 0 },
        gamesPlayed: { type: Number, default: 0 },
        fastestGuessMs: { type: Number, default: null },
        lastPlayedAt: { type: Date, default: null },
    },
    { timestamps: true, collection: "GuessTheSong" },
);

guessTheSongSchema.index({ guildId: 1, userId: 1 }, { unique: true });
guessTheSongSchema.index({ guildId: 1, points: -1 });

module.exports = mongoose.models.GuessTheSong || mongoose.model("GuessTheSong", guessTheSongSchema);

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
