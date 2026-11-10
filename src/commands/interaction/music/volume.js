const { EmbedBuilder, MessageFlags } = require("discord.js");
const { minVolume, maxVolume } = require("../../../settings/config.js");
const { safeDeferReply, safeEditReply, safeReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "volume",
    description: "Set the Lagukan player volume",
    category: "music",
    options: [
        {
            name: "value",
            description: "Provide volume value",
            type: 4,
            min_value: minVolume,
            max_value: maxVolume,
            required: false,
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
        const embed = new EmbedBuilder().setColor(client.config.embedColor);
        const value = interaction.options.getInteger("value");

        if (!value) {
            embed.setDescription(`Current volume: \`${player.volume}%\``);

            return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        await Promise.resolve(player.setVolume(value));

        embed.setDescription(`Volume has been set to: \`${value}%\``);

        return safeEditReply(interaction, { embeds: [embed] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
