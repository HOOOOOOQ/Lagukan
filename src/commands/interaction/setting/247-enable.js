const { EmbedBuilder, MessageFlags, PermissionsBitField } = require("discord.js");
const { getAuto247Config, upsertAuto247Config, ensureBotAuto247Connected } = require("../../../functions/auto247Manager.js");
const { clearManualDisconnect } = require("../../../functions/voiceSessionManager.js");
const { THEME_666 } = require("../../../functions/cardRenderer666.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "247-enable",
    description: "Aktifkan kembali mode Voice Channel 24/7 otomatis pada bot ini",
    category: "setting",
    options: [],
    permissions: {
        bot: [],
        user: [PermissionsBitField.Flags.ManageGuild],
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

        const existing = await getAuto247Config(client, interaction.guildId);
        const fallbackVoiceId = existing?.voiceChannelId || interaction.member?.voice?.channelId || null;

        if (!fallbackVoiceId) {
            const errEmbed = new EmbedBuilder()
                .setColor(0xff4757)
                .setDescription("❌ Belum ada Voice Channel 24/7 yang dikonfigurasi untuk bot ini. Jalankan `/247-setup` terlebih dahulu.");
            return safeEditReply(interaction, { embeds: [errEmbed] });
        }

        await clearManualDisconnect(client, interaction.guildId, interaction.guild);
        await upsertAuto247Config(client, {
            guildId: interaction.guildId,
            voiceChannelId: fallbackVoiceId,
            enabled: true,
            autoReconnect: existing?.autoReconnect ?? true,
            updatedBy: interaction.user.id,
        });

        const connectResult = await ensureBotAuto247Connected(client, interaction.guildId);
        const botName = client.user?.username || "Lagukan 666";

        const embed = new EmbedBuilder()
            .setColor(THEME_666.embedColor)
            .setTitle("666 • Auto 24/7 Enabled")
            .setDescription(
                [
                    `✅ Mode **Auto 24/7** untuk **${botName}** kini **Aktif**.`,
                    `• **Voice Channel:** <#${fallbackVoiceId}>`,
                    `• **Status:** ${connectResult.connected ? "🟢 Terhubung" : `🟡 Menunggu node (${connectResult.reason})`}`,
                ].join("\n"),
            );

        return safeEditReply(interaction, { embeds: [embed] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
