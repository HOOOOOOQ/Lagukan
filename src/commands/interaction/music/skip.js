const { EmbedBuilder, MessageFlags } = require("discord.js");
const { isGuildAutoplayEnabled, checkDjAccess } = require("../../../functions/musicPermissions.js");
const { truncateText } = require("../../../functions/nowPlayingManager.js");
const { safeReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "skip",
    description: "Skip the current song or jump to a specific track number in queue",
    category: "music",
    options: [
        {
            name: "to",
            description: "Optional queue position to jump directly to (1 = next track)",
            type: 4,
            min_value: 1,
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
        allowRequester: true,
    },
    devOnly: false,
    run: async (client, interaction, player) => {
        const embed = new EmbedBuilder().setColor(client.config.embedColor);
        const jumpTo = interaction.options.getInteger("to");

        if (jumpTo !== null) {
            if (jumpTo > 1) {
                const djMulti = checkDjAccess(client, {
                    guild: interaction.guild,
                    member: interaction.member,
                    user: interaction.user,
                    player,
                    track: player.queue.current,
                    allowRequester: false,
                    interaction,
                });
                if (!djMulti.allowed) {
                    embed.setDescription(djMulti.reason);
                    return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
                }
            }

            if (player.queue.isEmpty || jumpTo < 1 || jumpTo > player.queue.size) {
                embed.setDescription(
                    player.queue.isEmpty ? "Queue is empty." : `Invalid position. Choose between \`1\` and \`${player.queue.size}\`.`,
                );
                return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
            }

            const target = player.queue[jumpTo - 1];
            if (jumpTo > 1) {
                player.queue.splice(0, jumpTo - 1);
            }
            await Promise.resolve(player.skip());

            embed.setDescription(`⏭️ Skipped to \`#${jumpTo}\`: **${truncateText(target?.title, 50)}**.`);
            return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        if (player.queue.isEmpty && !isGuildAutoplayEnabled(client, player.guildId)) {
            embed.setDescription("Queue is empty. Add another song or enable `/autoplay` to skip.");
            return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        await Promise.resolve(player.skip());
        embed.setDescription("Skipped the current song.");

        return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
