const { EmbedBuilder, MessageFlags, PermissionsBitField } = require("discord.js");
const { minVolume, maxVolume } = require("../../../settings/config.js");
const { updateGuildMusicSettings } = require("../../../functions/musicPermissions.js");
const { refreshNowPlayingDashboard } = require("../../../functions/nowPlayingManager.js");
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
        {
            name: "save_default",
            description: "Also save this volume as the server default (Manage Server required)",
            type: 5,
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
        dj: true,
    },
    devOnly: false,
    run: async (client, interaction, player) => {
        const embed = new EmbedBuilder().setColor(client.config.embedColor);
        const value = interaction.options.getInteger("value");
        const saveDefault = Boolean(interaction.options.getBoolean("save_default"));

        if (value === null) {
            embed.setDescription(`Current volume: \`${player.volume}%\``);
            return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        await Promise.resolve(player.setVolume(value));
        await refreshNowPlayingDashboard(client, player);

        let savedNote = "";
        if (saveDefault) {
            const canSave = interaction.memberPermissions?.has?.(PermissionsBitField.Flags.ManageGuild);
            if (canSave) {
                await updateGuildMusicSettings(client, interaction.guild, { defaultVolume: value });
                savedNote = " *(saved as server default)*";
            } else {
                savedNote = " *(Manage Server permission required to save default)*";
            }
        }

        embed.setDescription(`Volume has been set to: \`${value}%\`${savedNote}`);

        return safeEditReply(interaction, { embeds: [embed] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
