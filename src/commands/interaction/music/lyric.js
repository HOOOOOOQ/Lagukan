const { handleLyricsCommand } = require("../../../functions/lyricsProvider.js");

module.exports = {
    name: "lyric",
    description: "Get the lyrics of the current song or search by title",
    category: "music",
    options: [
        {
            name: "song",
            description: "Optional song title & artist (defaults to currently playing track)",
            type: 3,
            required: false,
        },
    ],
    permissions: {
        bot: [],
        user: [],
    },
    settings: {
        voice: false,
        player: false,
        current: false,
    },
    devOnly: false,
    run: async (client, interaction) => {
        return handleLyricsCommand(client, interaction);
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
