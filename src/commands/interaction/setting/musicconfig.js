const { ApplicationCommandOptionType, EmbedBuilder, MessageFlags } = require("discord.js");
const { getGuildMusicSettings, updateGuildMusicSettings } = require("../../../functions/musicPermissions.js");
const { minVolume, maxVolume } = require("../../../settings/config.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "musicconfig",
    description: "Configure server DJ Mode, DJ Role, Auto-Leave timeout, and Default Volume",
    category: "setting",
    options: [
        {
            name: "dj_mode",
            description: "Enable or disable DJ Mode playback restrictions",
            type: ApplicationCommandOptionType.String,
            required: false,
            choices: [
                { name: "enable", value: "enable" },
                { name: "disable", value: "disable" },
            ],
        },
        {
            name: "dj_role",
            description: "Role allowed to control playback when DJ Mode is active",
            type: ApplicationCommandOptionType.Role,
            required: false,
        },
        {
            name: "clear_dj_role",
            description: "Remove the currently configured DJ Role",
            type: ApplicationCommandOptionType.Boolean,
            required: false,
        },
        {
            name: "auto_leave",
            description: "Enable or disable automatic disconnect when voice channel is empty/idle",
            type: ApplicationCommandOptionType.String,
            required: false,
            choices: [
                { name: "enable", value: "enable" },
                { name: "disable", value: "disable" },
            ],
        },
        {
            name: "auto_leave_timeout",
            description: "Seconds before auto-leaving an empty/idle voice channel (5 - 3600s)",
            type: ApplicationCommandOptionType.Integer,
            min_value: 5,
            max_value: 3600,
            required: false,
        },
        {
            name: "default_volume",
            description: "Default player volume when Lagukan joins a voice channel",
            type: ApplicationCommandOptionType.Integer,
            min_value: minVolume,
            max_value: maxVolume,
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
        const embedColor = client.config.embedColor;
        const embed = new EmbedBuilder().setColor(embedColor);

        const djModeOpt = interaction.options.getString("dj_mode");
        const djRoleOpt = interaction.options.getRole("dj_role");
        const clearDjRole = Boolean(interaction.options.getBoolean("clear_dj_role"));
        const autoLeaveOpt = interaction.options.getString("auto_leave");
        const autoLeaveTimeoutSec = interaction.options.getInteger("auto_leave_timeout");
        const defaultVolOpt = interaction.options.getInteger("default_volume");

        // Never allow @everyone role selection
        if (djRoleOpt && String(djRoleOpt.id) === String(interaction.guildId)) {
            embed.setDescription("❌ You cannot select `@everyone` as the DJ Role. Please choose a specific server role.");
            return safeEditReply(interaction, { embeds: [embed] });
        }

        const hasChanges =
            djModeOpt !== null ||
            djRoleOpt !== null ||
            clearDjRole ||
            autoLeaveOpt !== null ||
            autoLeaveTimeoutSec !== null ||
            defaultVolOpt !== null;

        let settings = getGuildMusicSettings(client, interaction.guild);

        if (hasChanges) {
            const patch = {};
            if (djModeOpt !== null) patch.djMode = djModeOpt === "enable";
            if (clearDjRole) patch.djRoleId = null;
            else if (djRoleOpt) patch.djRoleId = djRoleOpt.id;

            if (defaultVolOpt !== null) patch.defaultVolume = defaultVolOpt;

            if (autoLeaveOpt !== null || autoLeaveTimeoutSec !== null) {
                patch.autoLeave = {};
                if (autoLeaveOpt !== null) patch.autoLeave.enabled = autoLeaveOpt === "enable";
                if (autoLeaveTimeoutSec !== null) patch.autoLeave.timeout = autoLeaveTimeoutSec * 1000;
            }

            settings = await updateGuildMusicSettings(client, interaction.guild, patch);
        }

        const guildData = client.data.get(`guildData_${interaction.guildId}`);
        const mode247 = Boolean(guildData?.reconnect?.status);

        embed
            .setAuthor({
                name: `${botName} • Server Music Settings`,
                iconURL: client.user?.displayAvatarURL?.(),
            })
            .setDescription(
                hasChanges
                    ? "Server music configuration has been updated and saved to database."
                    : "Current music configuration for this server:",
            )
            .addFields(
                { name: "DJ Mode", value: settings.djMode ? "`Enabled`" : "`Disabled`", inline: true },
                {
                    name: "DJ Role",
                    value: settings.djRoleId ? `<@&${settings.djRoleId}>` : "`None (Manage Server only)`",
                    inline: true,
                },
                { name: "Default Volume", value: `\`${settings.defaultVolume}%\``, inline: true },
                {
                    name: "Auto-Leave",
                    value: settings.autoLeave?.enabled !== false ? "`Enabled`" : "`Disabled`",
                    inline: true,
                },
                {
                    name: "Auto-Leave Timeout",
                    value: `\`${Math.round((settings.autoLeave?.timeout || 60000) / 1000)}s\``,
                    inline: true,
                },
                {
                    name: "Autoplay / 24-7",
                    value: `Autoplay: \`${settings.autoplay ? "On" : "Off"}\` • 24/7: \`${mode247 ? "On" : "Off"}\``,
                    inline: true,
                },
            );

        return safeEditReply(interaction, { embeds: [embed] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
