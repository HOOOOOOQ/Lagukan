const { EmbedBuilder, MessageFlags } = require("discord.js");
const { hasAdminPermission, buildAdminDeniedEmbed } = require("../../../functions/serverTagLogger.js");
const { AUTO_ROLE_COLORS, AUTO_ROLE_FOOTER, buildSetTagRolePanel } = require("../../../functions/serverTagAutoRole.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "settagrole",
    description: "Atur dan pilih role otomatis untuk pengguna Server Tag server ini",
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
                .setColor(AUTO_ROLE_COLORS.ERROR)
                .setTitle("⚠️ Server Tidak Ditemukan")
                .setDescription("Data server ini belum tersedia di cache bot. Silakan coba beberapa saat lagi.")
                .setFooter({ text: AUTO_ROLE_FOOTER, iconURL: botAvatar })
                .setTimestamp();

            return safeEditReply(interaction, { embeds: [guildErrEmbed] });
        }

        if (!hasAdminPermission(interaction, guild)) {
            const deniedEmbed = buildAdminDeniedEmbed(client, "settagrole");
            return safeEditReply(interaction, { embeds: [deniedEmbed] });
        }

        const panel = await buildSetTagRolePanel(client, guild, interaction.user.id);
        return safeEditReply(interaction, panel);
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
