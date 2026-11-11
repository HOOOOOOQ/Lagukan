const { EmbedBuilder, MessageFlags, PermissionsBitField } = require("discord.js");
const Logger = require("../utils/logger");
const { safeReply, isUnknownInteractionError, isAlreadyAcknowledgedError } = require("./interactionResponder.js");
const { getGuildPlayer } = require("./voiceSessionManager.js");
const { checkDjAccess } = require("./musicPermissions.js");

function resolveMemberPermissions(response) {
    if (response?.memberPermissions && typeof response.memberPermissions.has === "function") {
        return response.memberPermissions;
    }

    const rawPerms = response?.member?.permissions;
    if (rawPerms && typeof rawPerms.has === "function") {
        return rawPerms;
    }

    if (typeof rawPerms === "string" || typeof rawPerms === "bigint" || typeof rawPerms === "number") {
        try {
            return new PermissionsBitField(BigInt(rawPerms));
        } catch {
            return null;
        }
    }

    return null;
}

module.exports = {
    permissions: async (client, response, command, args) => {
        const botName = client.config.botName || "Lagukan";
        const embed = new EmbedBuilder().setColor(client.config.embedColor);
        const userId = response.user?.id || response.author?.id;

        if (command.devOnly && !client.config.dev.includes(userId)) {
            embed.setDescription(`The command is only available for developers.`);

            return safeReply(response, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        const memberPerms = resolveMemberPermissions(response);
        if (command.permissions.user?.length > 0 && (!memberPerms || !memberPerms.has(command.permissions.user))) {
            embed.setDescription(`You don't have \`${command.permissions.user.join(", ")}\` permissions to execute this command.`);

            return safeReply(response, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        const botMember = response.guild?.members?.me;
        if (command.permissions.bot?.length > 0 && botMember && !botMember.permissions.has(command.permissions.bot)) {
            embed.setDescription(`The bot doesn't have \`${command.permissions.bot.join(", ")}\` permissions to execute this command.`);

            return safeReply(response, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        if (command.settings.voice) {
            const voiceChannel = response.member?.voice?.channel;
            if (!voiceChannel) {
                embed.setDescription(`You need to join a voice channel first.`);

                return safeReply(response, { embeds: [embed], flags: MessageFlags.Ephemeral });
            }

            if (botMember) {
                const botVoicePerms = voiceChannel.permissionsFor(botMember);
                if (botVoicePerms && !botVoicePerms.has(PermissionsBitField.Flags.Connect)) {
                    embed.setDescription(`The bot doesn't have \`Connect\` permission in ${voiceChannel.toString()}.`);

                    return safeReply(response, { embeds: [embed], flags: MessageFlags.Ephemeral });
                }

                if (botVoicePerms && !botVoicePerms.has(PermissionsBitField.Flags.Speak) && voiceChannel.type === 2) {
                    embed.setDescription(`The bot doesn't have \`Speak\` permission in ${voiceChannel.toString()}.`);

                    return safeReply(response, { embeds: [embed], flags: MessageFlags.Ephemeral });
                }
            }
        }

        let player = getGuildPlayer(client, response.guild?.id);

        if (command.settings.player) {
            if (!player) {
                embed.setDescription(`There is no active player in this server.`);

                return safeReply(response, { embeds: [embed], flags: MessageFlags.Ephemeral });
            }

            if (player.voiceId !== response.member?.voice?.channelId) {
                embed.setDescription(`You need to be in the same voice channel as ${botName}.`);

                return safeReply(response, { embeds: [embed], flags: MessageFlags.Ephemeral });
            }
        }

        if (command.settings.current) {
            if (!player || !player.queue.current) {
                embed.setDescription(`There is no song currently playing in this server.`);

                return safeReply(response, { embeds: [embed], flags: MessageFlags.Ephemeral });
            }
        }

        if (command.settings.dj) {
            const djResult = checkDjAccess(client, {
                guild: response.guild,
                member: response.member,
                user: response.user || response.author,
                player,
                track: player?.queue?.current || null,
                allowRequester: Boolean(command.settings.allowRequester),
                interaction: response,
            });

            if (!djResult.allowed) {
                embed.setDescription(djResult.reason);

                return safeReply(response, { embeds: [embed], flags: MessageFlags.Ephemeral });
            }
        }

        try {
            await command.run(client, response, player, args);
        } catch (error) {
            if (isUnknownInteractionError(error)) {
                Logger.warn(`[Command] Token interaction kedaluwarsa (10062) saat menjalankan '${command.name}'. Tidak dilakukan retry.`);
                return;
            }

            if (isAlreadyAcknowledgedError(error)) {
                Logger.debug(`[Command] Interaksi '${command.name}' sudah direspons sebelumnya (InteractionAlreadyReplied).`);
                return;
            }

            Logger.error(`Failed to execute command '${command.name}':`, error);

            const errEmbed = new EmbedBuilder()
                .setColor(0xff4757)
                .setDescription(
                    command.locale === "id"
                        ? "❌ Terjadi kesalahan internal saat menjalankan perintah ini. Silakan coba beberapa saat lagi."
                        : "❌ An unexpected error occurred while executing this command. Please try again later.",
                );

            await safeReply(response, { embeds: [errEmbed], flags: MessageFlags.Ephemeral });
        }
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
