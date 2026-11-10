const { EmbedBuilder, MessageFlags } = require("discord.js");
const {
    CR_COLORS,
    CR_FOOTER,
    isUserStrictAdmin,
    checkCustomRoleAccess,
    buildCustomRoleDashboard,
} = require("../../../functions/customRoleSystem.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "customrole",
    description: "Buka dashboard pembuatan & pengaturan Custom Role (nama, warna, gradasi, dan ikon)",
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

        const access = await checkCustomRoleAccess(client, guild, interaction);
        if (!access.allowed) {
            const deniedEmbed = new EmbedBuilder()
                .setColor(CR_COLORS.ERROR)
                .setTitle("⛔ Akses Custom Role Dibatasi")
                .setDescription(access.reason)
                .setFooter({ text: CR_FOOTER, iconURL: botAvatar })
                .setTimestamp();

            return safeEditReply(interaction, { embeds: [deniedEmbed] });
        }

        const dashboardPayload = await buildCustomRoleDashboard(client, guild, interaction.user, {
            isStrictAdmin: isUserStrictAdmin(interaction, guild),
        });

        return safeEditReply(interaction, dashboardPayload);
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
