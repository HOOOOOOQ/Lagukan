const { EmbedBuilder, MessageFlags } = require("discord.js");
const { createDataGuild, normalizeGuildData } = require("../../../functions/createData.js");
const {
    COLORS,
    isValidTimezone,
    formatVoiceTime,
    getBotVoiceChannelId,
    resolveGuildVoiceConfig,
} = require("../../../functions/voiceLogger.js");

module.exports = {
    name: "voicelog",
    description: "Configure Lagukan Voice Channel Activity Logger for this server",
    category: "setting",
    options: [
        {
            name: "status",
            description: "Enable, disable, or reset Voice Activity Logger",
            type: 3,
            required: false,
            choices: [
                { name: "enable", value: "enable" },
                { name: "disable", value: "disable" },
                { name: "reset (use .env default)", value: "reset" },
            ],
        },
        {
            name: "timezone",
            description: "IANA timezone (e.g. Asia/Jakarta, Asia/Makassar, Asia/Jayapura)",
            type: 3,
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
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const guild = interaction.guild;
        const statusOpt = interaction.options.getString("status");
        const timezoneOpt = interaction.options.getString("timezone");

        const botIconUrl = client.user?.displayAvatarURL?.({ size: 128 }) || undefined;
        let guildData = (await createDataGuild(client, guild)) || normalizeGuildData(client, guild, { id: guild.id });

        if (timezoneOpt && !isValidTimezone(timezoneOpt)) {
            const errEmbed = new EmbedBuilder()
                .setColor(COLORS.LEAVING)
                .setTitle("🎙️ Invalid Timezone")
                .setDescription(
                    `Timezone \`${timezoneOpt}\` tidak valid.\nGunakan format IANA seperti \`Asia/Jakarta\` (WIB), \`Asia/Makassar\` (WITA), atau \`Asia/Jayapura\` (WIT).`,
                )
                .setFooter({ text: "LAGUKAN VOICE SYSTEM", iconURL: botIconUrl });

            return interaction.editReply({ embeds: [errEmbed] });
        }

        const hasChanges = Boolean(statusOpt || timezoneOpt);

        if (hasChanges) {
            if (statusOpt === "reset" && !timezoneOpt) {
                guildData = normalizeGuildData(client, guild, {
                    ...guildData,
                    voiceLog: { source: "env" },
                });
            } else {
                const currentResolved = await resolveGuildVoiceConfig(client, guild);
                const nextEnabled = statusOpt === "enable" ? true : statusOpt === "disable" ? false : Boolean(currentResolved.enabled);
                const nextTimezone = timezoneOpt
                    ? timezoneOpt.trim()
                    : currentResolved.timezone || client.config.timezone || "Asia/Jakarta";

                guildData.voiceLog = {
                    enabled: nextEnabled,
                    timezone: nextTimezone,
                    source: "command",
                };
            }

            client.data.set(`guildData_${guild.id}`, guildData);

            await client.guildData
                .findOneAndUpdate({ id: guild.id }, { $set: { voiceLog: guildData.voiceLog } }, { upsert: true, returnDocument: "after" })
                .catch(() => {});
        }

        const resolved = await resolveGuildVoiceConfig(client, guild);
        const activeVoiceId = getBotVoiceChannelId(client, guild);
        const targetDisplay = activeVoiceId
            ? `<#${activeVoiceId}> *(Voice Channel Chat)*`
            : "`Auto (Active Voice Channel Chat when Lagukan joins)`";
        const statusDisplay = resolved.enabled ? "🟢 `ENABLED`" : "🔴 `DISABLED`";
        const previewTime = formatVoiceTime(new Date(), resolved.timezone);

        const embed = new EmbedBuilder()
            .setColor(COLORS.SYSTEM)
            .setTitle(hasChanges ? "🎙️ Voice Logger Updated" : "🎙️ Voice Logger Configuration")
            .setDescription(
                [
                    `**Status:** ${statusDisplay}`,
                    `**Target Chat:** ${targetDisplay}`,
                    `**Timezone:** \`${resolved.timezone}\` (🕒 \`${previewTime}\`)`,
                    `**Config Source:** \`${resolved.isCommandOverride ? "Server MongoDB" : ".env Default"}\``,
                ].join("\n\n"),
            )
            .setFooter({ text: "LAGUKAN VOICE SYSTEM", iconURL: botIconUrl })
            .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
