const { EmbedBuilder, MessageFlags } = require("discord.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "filter",
    description: "Set the audio filter for Lagukan player",
    category: "music",
    options: [
        {
            name: "mode",
            description: "Choose a filter",
            type: 3,
            required: true,
            choices: [
                { name: "8d", value: "eightD" },
                { name: "bass", value: "bass" },
                { name: "chipmunk", value: "chimpunk" },
                { name: "clear", value: "clear" },
                { name: "earrape", value: "earrape" },
                { name: "electronic", value: "electronic" },
                { name: "karaoke", value: "karaoke" },
                { name: "nightcore", value: "nightcore" },
                { name: "pitch", value: "pitch" },
                { name: "slow", value: "slow" },
                { name: "soft", value: "soft" },
                { name: "tremolo", value: "tremolo" },
                { name: "treblebass", value: "treblebass" },
                { name: "vaporwave", value: "vaporwave" },
                { name: "vibrato", value: "vibrato" },
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
    },
    devOnly: false,
    run: async (client, interaction, player) => {
        const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const embed = new EmbedBuilder().setColor(client.config.embedColor);
        const mode = interaction.options.getString("mode");
        const currentVolume = player.volume;

        await Promise.resolve(player.filter.set(mode));

        if (mode === "clear") {
            embed.setDescription(`Filter has been cleared.`);
        } else {
            embed.setDescription(`Filter has been set to: \`${mode}\``);
        }

        await Promise.resolve(player.setVolume(currentVolume));

        return safeEditReply(interaction, { embeds: [embed] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
