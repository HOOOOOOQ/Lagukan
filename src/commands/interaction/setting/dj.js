const { ApplicationCommandOptionType, EmbedBuilder, MessageFlags } = require("discord.js");
const { getGuildMusicSettings, updateGuildMusicSettings } = require("../../../functions/musicPermissions.js");
const { getGuildPlayer } = require("../../../functions/voiceSessionManager.js");
const { refreshNowPlayingDashboard } = require("../../../functions/nowPlayingManager.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "dj",
    description: "Manage DJ Mode and DJ Role permissions for music playback controls",
    category: "setting",
    options: [
        {
            name: "mode",
            description: "Enable or disable DJ Mode restrictions in this server",
            type: ApplicationCommandOptionType.String,
            required: false,
            choices: [
                { name: "enable", value: "enable" },
                { name: "disable", value: "disable" },
            ],
        },
        {
            name: "role",
            description: "Assign the DJ Role allowed to control music playback",
            type: ApplicationCommandOptionType.Role,
            required: false,
        },
        {
            name: "clear_role",
            description: "Remove the currently assigned DJ Role",
            type: ApplicationCommandOptionType.Boolean,
            required: false,
        },
    ],
    permissions: {
        bot: [],
        user: ["ManageGuild"],
    },
    settings: {
        voice: false,
        player: false,
        current: false,
    },
    devOnly: false,
    run: async (client, interaction) => {
        const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const botName = client.config.botName || "Lagukan";
        const embed = new EmbedBuilder().setColor(client.config.embedColor);

        const modeOpt = interaction.options.getString("mode");
        const roleOpt = interaction.options.getRole("role");
        const clearRole = Boolean(interaction.options.getBoolean("clear_role"));

        if (roleOpt && String(roleOpt.id) === String(interaction.guildId)) {
            embed.setDescription("❌ You cannot assign `@everyone` as the DJ Role. Please select a dedicated role.");
            return safeEditReply(interaction, { embeds: [embed] });
        }

        const hasChanges = modeOpt !== null || roleOpt !== null || clearRole;
        let settings = getGuildMusicSettings(client, interaction.guild);

        if (hasChanges) {
            const patch = {};
            if (modeOpt !== null) {
                patch.djMode = modeOpt === "enable";
            } else if (roleOpt && !settings.djMode) {
                // Automatically enable DJ Mode when setting a DJ role unless explicitly disabled
                patch.djMode = true;
            }

            if (clearRole) {
                patch.djRoleId = null;
            } else if (roleOpt) {
                patch.djRoleId = roleOpt.id;
            }

            settings = await updateGuildMusicSettings(client, interaction.guild, patch);

            const activePlayer = getGuildPlayer(client, interaction.guildId);
            if (activePlayer) {
                await refreshNowPlayingDashboard(client, activePlayer).catch(() => {});
            }
        }

        embed
            .setAuthor({
                name: `${botName} • DJ Mode & DJ Role`,
                iconURL: client.user?.displayAvatarURL?.(),
            })
            .setDescription(
                hasChanges
                    ? "✅ DJ configuration has been updated and saved to MongoDB."
                    : "Current DJ access control settings for this server:",
            )
            .addFields(
                { name: "DJ Mode", value: settings.djMode ? "`Enabled`" : "`Disabled`", inline: true },
                {
                    name: "DJ Role",
                    value: settings.djRoleId ? `<@&${settings.djRoleId}>` : "`None (Manage Server only)`",
                    inline: true,
                },
                {
                    name: "Who Can Control Music?",
                    value: settings.djMode
                        ? "Members with `Manage Server`, the assigned DJ Role, the track requester (`Pause`/`Skip`), or a sole listener in voice."
                        : "Any member in the same voice channel as the bot.",
                    inline: false,
                },
            );

        return safeEditReply(interaction, { embeds: [embed] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
