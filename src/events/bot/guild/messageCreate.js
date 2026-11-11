const { EmbedBuilder } = require("discord.js");
const { createDataGuild, createDataUser } = require("../../../functions/createData.js");
const { permissions } = require("../../../functions/getPermission.js");
const { handlePassiveMemberObservation } = require("../../../functions/serverTagLogger.js");
const { handleCrossGuildUserTagAutoRole } = require("../../../functions/serverTagAutoRole.js");
const { buildSupportComponents } = require("../../../functions/interactionResponder.js");
const { buildProfileEmbedAndComponents, attachProfileCollector } = require("../../../functions/musicStatsEngine.js");
const { handleRequestChannelMessage } = require("../../../functions/voiceRequestSystem.js");
const { handleGuessTheSongMessage } = require("../../../functions/musicGamesSystem.js");
const { handleAssistantMessage } = require("../../../features/assistant/assistantHandler.js");
const Logger = require("../../../utils/logger");

module.exports = async (client, message) => {
    if (message.author.bot || !message.guild || message.system || message.webhookId) return;

    await createDataGuild(client, message.guild);
    await createDataUser(client, message.author);
    handlePassiveMemberObservation(client, message.guild, message.author, message.member).catch(() => {});
    handleCrossGuildUserTagAutoRole(client, message.author, {
        originGuildId: message.guild.id,
        member: message.member?.roles?.add ? message.member : undefined,
    }).catch(() => {});

    const botName = client.config.botName || "Lagukan";
    const userData = client.data.get(`userData_${message.author.id}`);
    const embed = new EmbedBuilder().setColor(client.config.embedColor);
    const supportComponents = buildSupportComponents(client, "Support Server");

    if (message.channel?.permissionsFor && message.guild.members?.me) {
        const botPermissions = ["ViewChannel", "SendMessages", "EmbedLinks"];
        const botMissingPermissions = [];

        for (const perm of botPermissions) {
            if (!message.channel.permissionsFor(message.guild.members.me)?.has(perm)) botMissingPermissions.push(perm);
        }

        if (botMissingPermissions.length > 0) {
            const content = `${botName} doesn't have one of these permissions \`${botMissingPermissions.join(", ")}\`.\nPlease double check them in your server role & channel settings.`;

            const dmChannel =
                message.author.dmChannel == null ? await message.author.createDM().catch(() => null) : message.author.dmChannel;

            if (dmChannel) {
                await dmChannel.send({ content, components: supportComponents }).catch(() => {});
            }
            return;
        }
    }

    const mention = new RegExp(`^<@!?${client.user.id}>( |)$`);

    if (message.content.match(mention)) {
        embed.setDescription(
            `Hello! I'm **${botName} Music Bot**. Use \`/help\` for Slash Commands, \`666 help\` for **666 Text Assistant**, or \`666!cek\` for your music profile.`,
        );

        await message.reply({ embeds: [embed] }).catch(() => {});
    }

    // 1. Public User Music Profile Prefix Command: `666!cek` & `666!cek @user`
    const trimmedContent = String(message.content || "").trim();
    if (/^666!cek(?:\s+|$)/i.test(trimmedContent)) {
        if (userData?.ban?.status) {
            embed.setDescription(
                `You have been banned from using the bot.\n\`\`\`${userData.ban.reason}\`\`\`\nPlease contact the developer if you think this is a mistake.`,
            );
            await message.reply({ embeds: [embed], components: supportComponents }).catch(() => {});
            return;
        }

        if (client.data.get("maintenance") && !client.config.dev.includes(message.author.id)) {
            embed.setDescription(`${botName} is currently under maintenance. Please try again later.`);
            await message.reply({ embeds: [embed], components: supportComponents }).catch(() => {});
            return;
        }

        const rawArg = trimmedContent.replace(/^666!cek\s*/i, "").trim();
        let targetUser = message.mentions?.users?.first?.() || null;
        let targetMember = message.mentions?.members?.first?.() || null;

        if (!targetUser && rawArg) {
            const idMatch = rawArg.match(/^<?@?!?(\d{17,20})>?$/);
            if (idMatch) {
                const targetId = idMatch[1];
                targetMember =
                    message.guild.members?.cache?.get?.(targetId) || (await message.guild.members?.fetch?.(targetId).catch(() => null));
                targetUser =
                    targetMember?.user || client.users?.cache?.get?.(targetId) || (await client.users?.fetch?.(targetId).catch(() => null));
            }
        }

        if (!targetUser) {
            targetUser = message.author;
            targetMember = message.member;
        } else if (!targetMember && message.guild.members?.fetch) {
            targetMember = await message.guild.members.fetch(targetUser.id).catch(() => null);
        }

        try {
            const payload = await buildProfileEmbedAndComponents(client, {
                guild: message.guild,
                targetUser,
                targetMember,
            });
            const sent = await message.reply(payload).catch(() => null);
            if (sent) {
                attachProfileCollector(client, sent, {
                    guild: message.guild,
                    targetUser,
                    targetMember,
                    viewerId: message.author.id,
                });
            }
        } catch (err) {
            Logger.error("[ProfileCommand] Error saat merender 666!cek:", err);
        }
        return;
    }

    // 2. 666 Local Text Assistant (`666 play ...`, `666 halo`, `666 dongengin aku`, `666 help`, etc.)
    const handledAssistant = await handleAssistantMessage(client, message).catch((err) => {
        Logger.error("[666Assistant] Unhandled error:", err?.message || err);
        return false;
    });
    if (handledAssistant) return;

    // 3. Active Guess The Song Round Plain-Text Answer Detection
    const handledGuess = await handleGuessTheSongMessage(client, message).catch(() => false);
    if (handledGuess) return;

    // 4. Dedicated Voice Channel Music Request Panel Direct Message Input
    if (!userData?.ban?.status) {
        const handledReq = await handleRequestChannelMessage(client, message).catch(() => false);
        if (handledReq) return;
    }

    let prefix = client.config.prefix;

    if (message.content.startsWith(prefix) && message.author.id !== client.config.owner && !client.config.dev.includes(message.author.id))
        return;
    if (!message.content.startsWith(prefix) && client.config.owner === message.author.id) {
        prefix = "";
    }

    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const prefixRegex = new RegExp(`^(<@!?${client.user.id}>|${escapeRegex(prefix)})\\s*`);

    if (!prefixRegex.test(message.content)) return;

    const [matchedPrefix] = message.content.match(prefixRegex);
    const args = message.content.slice(matchedPrefix.length).trim().split(/ +/g);
    const cmd = args.shift().toLowerCase();

    if (!cmd.length) return;

    let command = client.prefix.get(cmd);

    if (!command) command = client.prefix.get(client.aliases.get(cmd));
    if (!command) return;

    Logger.info(
        `[PREFIX] [${command.name}] | (${message.author.username})[${message.author.id}] | (${message.guild.name})[${message.guildId}]`,
    );

    if (userData && userData.ban?.status) {
        embed.setDescription(`You have been banned from using ${botName}.\n\`\`\`${userData.ban.reason}\`\`\``);

        return message.reply({ embeds: [embed] }).catch(() => {});
    }

    const maintenance = client.data.get("maintenance");

    if (maintenance && !client.config.dev.includes(message.author.id)) {
        embed.setDescription(`${botName} is currently under maintenance. Please try again later.`);

        return message.reply({ embeds: [embed] }).catch(() => {});
    }

    return permissions(client, message, command, args);
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
