const { EmbedBuilder, MessageFlags } = require("discord.js");
const {
    CR_COLORS,
    CR_FOOTER,
    canManageCustomRoleConfig,
    buildAdminConfigDeniedEmbed,
    buildCustomRoleConfigDashboard,
} = require("../../../functions/customRoleSystem.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "customrole-config",
    description: "Konfigurasi sistem akses Custom Role server (Booster, Role Khusus, dan batas kepemilikan)",
    category: "setting",
    locale: "id",
    options: [],
    permissions: {
        bot: [],
        user: [],
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

        const guildId = interaction.guildId;
        const guild = interaction.guild || client.guilds.cache.get(guildId);
        const botAvatar = client.user?.displayAvatarURL?.({ size: 128 }) || undefined;

        if (!guild) {
            const guildErrEmbed = new EmbedBuilder()
                .setColor(CR_COLORS.ERROR)
                .setTitle("⚠️ Server Tidak Ditemukan")
                .setDescription("Data server ini belum tersedia di cache bot. Silakan coba beberapa saat lagi.")
                .setFooter({ text: CR_FOOTER, iconURL: botAvatar })
                .setTimestamp();

            return safeEditReply(interaction, { embeds: [guildErrEmbed] });
        }

        if (!canManageCustomRoleConfig(interaction, guild)) {
            const deniedEmbed = buildAdminConfigDeniedEmbed(client);
            return safeEditReply(interaction, { embeds: [deniedEmbed] });
        }

        const configPanel = await buildCustomRoleConfigDashboard(client, guild, interaction.user.id);
        return safeEditReply(interaction, configPanel);
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
