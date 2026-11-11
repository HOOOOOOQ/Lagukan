const { EmbedBuilder, MessageFlags } = require("discord.js");
const { isGuildAutoplayEnabled, setGuildAutoplay } = require("../../../functions/musicPermissions.js");
const { refreshNowPlayingDashboard } = require("../../../functions/nowPlayingManager.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "autoplay",
    description: "Toggle Lagukan smart autoplay recommendations for this server",
    category: "setting",
    permissions: {
        bot: [],
        user: [],
    },
    settings: {
        voice: true,
        player: false,
        current: false,
        dj: true,
    },
    devOnly: false,
    run: async (client, interaction, player) => {
        const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const currentStatus = isGuildAutoplayEnabled(client, interaction.guildId);
        const nextStatus = await setGuildAutoplay(client, interaction.guild, !currentStatus);

        if (player) {
            await refreshNowPlayingDashboard(client, player);
        }

        const embed = new EmbedBuilder()
            .setColor(client.config.embedColor)
            .setDescription(
                nextStatus ? "Smart Autoplay is now `enabled` for this server." : "Smart Autoplay is now `disabled` for this server.",
            );

        return safeEditReply(interaction, { embeds: [embed] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
