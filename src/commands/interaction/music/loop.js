const { EmbedBuilder, MessageFlags } = require("discord.js");
const { refreshNowPlayingDashboard } = require("../../../functions/nowPlayingManager.js");
const { safeReply, safeDeferReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "loop",
    description: "Toggle Lagukan loop mode (off, song, or queue)",
    category: "music",
    options: [
        {
            name: "mode",
            description: "Set loop mode",
            type: 3,
            required: true,
            choices: [
                { name: "off", value: "none" },
                { name: "song", value: "song" },
                { name: "queue", value: "queue" },
            ],
        },
    ],
    permissions: {
        bot: [],
        user: [],
    },
    settings: {
        voice: true,
        player: true,
        current: true,
        dj: true,
    },
    devOnly: false,
    run: async (client, interaction, player) => {
        if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }))) return;
        const embed = new EmbedBuilder().setColor(client.config.embedColor);
        const mode = interaction.options.getString("mode");

        player.setLoop(mode);
        await refreshNowPlayingDashboard(client, player);

        const label = mode === "none" ? "off" : mode;
        embed.setDescription(`Loop mode has been set to \`${label}\`.`);

        return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
