const { EmbedBuilder, InteractionType, MessageFlags } = require("discord.js");
const { permissions } = require("../../../functions/getPermission.js");
const { createDataGuild, createDataUser } = require("../../../functions/createData.js");
const { handlePassiveMemberObservation } = require("../../../functions/serverTagLogger.js");
const { buildSupportComponents, safeReply, isUnknownInteractionError } = require("../../../functions/interactionResponder.js");
const Logger = require("../../../utils/logger");

module.exports = async (client, interaction) => {
    if (!interaction?.guild || interaction.user?.bot) return;

    const isSlashCommand =
        typeof interaction.isChatInputCommand === "function"
            ? interaction.isChatInputCommand()
            : interaction.type === InteractionType.ApplicationCommand;

    if (!isSlashCommand) return;

    // Non-blocking background sync so MongoDB latency NEVER delays Discord's 3-second acknowledgement deadline
    createDataGuild(client, interaction.guild).catch(() => {});
    createDataUser(client, interaction.user).catch(() => {});
    handlePassiveMemberObservation(client, interaction.guild, interaction.user, interaction.member).catch(() => {});

    const command = client.slash.get(interaction.commandName);
    if (!command) return;

    const botName = client.config.botName || "Lagukan";
    const userData = client.data.get(`userData_${interaction.user.id}`);
    const embed = new EmbedBuilder().setColor(client.config.embedColor);
    const supportComponents = buildSupportComponents(client, "Support Server");

    try {
        if (interaction.channel?.permissionsFor && interaction.guild.members?.me) {
            const botPermissions = ["ViewChannel", "SendMessages", "EmbedLinks", "ReadMessageHistory"];
            const botMissingPermissions = [];

            for (const perm of botPermissions) {
                if (!interaction.channel.permissionsFor(interaction.guild.members.me)?.has(perm)) {
                    botMissingPermissions.push(perm);
                }
            }

            if (botMissingPermissions.length > 0) {
                const content = `The bot doesn't have one of these permissions \`${botMissingPermissions.join(", ")}\`.\nPlease double check them in your server role & channel settings.`;

                return await safeReply(interaction, {
                    content,
                    components: supportComponents,
                    flags: MessageFlags.Ephemeral,
                });
            }
        }

        if (userData && userData.ban?.status) {
            embed.setDescription(
                `You have been banned from using the bot.\n\`\`\`${userData.ban.reason}\`\`\`\nPlease contact the developer if you think this is a mistake.`,
            );

            return await safeReply(interaction, {
                embeds: [embed],
                components: supportComponents,
                flags: MessageFlags.Ephemeral,
            });
        }

        if (client.data.get("maintenance") && !client.config.dev.includes(interaction.user.id)) {
            embed.setDescription(
                `${botName} is currently under maintenance. Please try again later.\nJoin our support server for more information.`,
            );

            return await safeReply(interaction, {
                embeds: [embed],
                components: supportComponents,
                flags: MessageFlags.Ephemeral,
            });
        }

        await permissions(client, interaction, command);
    } catch (error) {
        if (isUnknownInteractionError(error)) {
            Logger.warn(`[Interaction] Token kedaluwarsa (10062) pada /${interaction.commandName} — interaksi dihentikan tanpa retry.`);
            return;
        }

        Logger.error(`[Interaction] Error tidak terduga pada /${interaction.commandName}:`, error);
    }
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
