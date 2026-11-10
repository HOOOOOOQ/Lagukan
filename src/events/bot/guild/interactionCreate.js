const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, InteractionType, MessageFlags } = require("discord.js");
const { createDataGuild, createDataUser } = require("../../../functions/createData.js");
const { permissions } = require("../../../functions/getPermission.js");
const { handlePassiveMemberObservation } = require("../../../functions/serverTagLogger.js");
const Logger = require("../../../utils/logger");

module.exports = async (client, interaction) => {
    if (!interaction.guild || interaction.user.bot) return;

    await createDataGuild(client, interaction.guild);
    await createDataUser(client, interaction.user);
    handlePassiveMemberObservation(client, interaction.guild, interaction.user, interaction.member).catch(() => {});

    const botName = client.config.botName || "Lagukan";
    const userData = client.data.get(`userData_${interaction.user.id}`);
    const embed = new EmbedBuilder().setColor(client.config.embedColor);
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel("Support Server").setURL(client.config.supportServerUrl).setStyle(ButtonStyle.Link),
    );

    if (interaction.type === InteractionType.ApplicationCommand) {
        const command = client.slash.get(interaction.commandName);
        if (!command) return;

        Logger.info(
            `[Slash] [${command.name}] | (${interaction.user.username})[${interaction.user.id}] | ${interaction.guild.name} [${interaction.guildId}]`,
        );

        const botPermissions = ["ViewChannel", "SendMessages", "EmbedLinks", "ReadMessageHistory"];
        const botMissingPermissions = [];

        for (const perm of botPermissions) {
            if (!interaction.channel.permissionsFor(interaction.guild.members.me).has(perm)) botMissingPermissions.push(perm);
        }

        if (botMissingPermissions.length > 0) {
            const content =
                command.locale === "id"
                    ? `${botName} belum memiliki izin berikut di channel ini: \`${botMissingPermissions.join(", ")}\`.\nSilakan periksa kembali pengaturan role & izin channel di server ini.`
                    : `${botName} doesn't have one of these permissions \`${botMissingPermissions.join(", ")}\`.\nPlease double check them in your server role & channel settings.`;

            return interaction.reply({ content: content, components: [row], flags: [MessageFlags.Ephemeral] });
        }

        if (userData && userData.ban.status) {
            embed.setDescription(`You have been banned from using ${botName}.\n\`\`\`${userData.ban.reason}\`\`\``);

            return interaction.reply({ embeds: [embed], components: [row], flags: [MessageFlags.Ephemeral] });
        }

        const maintenance = client.data.get("maintenance");

        if (maintenance && !client.config.dev.includes(interaction.user.id)) {
            embed.setDescription(`${botName} is currently under maintenance. Please try again later.`);

            return interaction.reply({ embeds: [embed], components: [row], flags: [MessageFlags.Ephemeral] });
        }

        let player = client.rainlink.players.get(interaction.guildId);

        return permissions(client, interaction, command, embed, player);
    }
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
