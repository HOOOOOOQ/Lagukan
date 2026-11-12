const { EmbedBuilder, InteractionType, MessageFlags } = require("discord.js");
const { permissions } = require("../../../functions/getPermission.js");
const { createDataGuild, createDataUser } = require("../../../functions/createData.js");
const { handleRequestPanelInteraction } = require("../../../functions/voiceRequestSystem.js");
const { handleMusicBattleInteraction } = require("../../../functions/musicGamesSystem.js");
const { buildSupportComponents, safeReply, isUnknownInteractionError } = require("../../../functions/interactionResponder.js");
const Logger = require("../../../utils/logger");

const MAX_PROCESSED_INTERACTION_IDS = 2000;

function markInteractionProcessed(client, interactionId) {
    if (!interactionId) return false;
    if (!(client._processedInteractionIds instanceof Set)) {
        client._processedInteractionIds = new Set();
    }
    const key = String(interactionId);
    if (client._processedInteractionIds.has(key)) {
        return true;
    }
    if (client._processedInteractionIds.size >= MAX_PROCESSED_INTERACTION_IDS) {
        const oldest = client._processedInteractionIds.values().next().value;
        if (oldest) client._processedInteractionIds.delete(oldest);
    }
    client._processedInteractionIds.add(key);
    return false;
}

module.exports = async (client, interaction) => {
    if (!interaction?.guild || interaction.user?.bot) return;

    // Ensure this bot only processes interactions explicitly targeted to its own Discord Application ID
    if (interaction.applicationId && client.user?.id && String(interaction.applicationId) !== String(client.user.id)) {
        return;
    }

    // Deduplicate by interaction ID so each slash/component interaction is processed at most once
    if (markInteractionProcessed(client, interaction.id)) {
        return;
    }

    // Handle Voice Channel Music Request Panel buttons & modals (`mreq:*`)
    if (typeof interaction.customId === "string" && interaction.customId.startsWith("mreq:")) {
        if (interaction.message?.author?.id && client.user?.id && String(interaction.message.author.id) !== String(client.user.id)) {
            return;
        }
        createDataGuild(client, interaction.guild).catch(() => {});
        createDataUser(client, interaction.user).catch(() => {});
        try {
            await handleRequestPanelInteraction(client, interaction);
        } catch (err) {
            if (!isUnknownInteractionError(err)) {
                Logger.error("[VoiceRequest] Error pada interaksi Request Panel:", err);
            }
        }
        return;
    }

    // Handle Music Battle submission & voting buttons/modals (`mbat:*`)
    if (typeof interaction.customId === "string" && interaction.customId.startsWith("mbat:")) {
        if (interaction.message?.author?.id && client.user?.id && String(interaction.message.author.id) !== String(client.user.id)) {
            return;
        }
        createDataGuild(client, interaction.guild).catch(() => {});
        createDataUser(client, interaction.user).catch(() => {});
        try {
            await handleMusicBattleInteraction(client, interaction);
        } catch (err) {
            if (!isUnknownInteractionError(err)) {
                Logger.error("[MusicBattle] Error pada interaksi Music Battle:", err);
            }
        }
        return;
    }

    const isSlashCommand =
        typeof interaction.isChatInputCommand === "function"
            ? interaction.isChatInputCommand()
            : interaction.type === InteractionType.ApplicationCommand;

    if (!isSlashCommand) return;

    // Non-blocking background sync so MongoDB latency NEVER delays Discord's 3-second acknowledgement deadline
    createDataGuild(client, interaction.guild).catch(() => {});
    createDataUser(client, interaction.user).catch(() => {});

    const command = client.slash.get(interaction.commandName);
    if (!command) return;

    const botName = client.user?.username || client.config.botName || "Lagukan";
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
