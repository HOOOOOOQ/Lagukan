const { EmbedBuilder, MessageFlags, PermissionsBitField } = require("discord.js");
const { getAuto247Config, upsertAuto247Config, cancelAuto247Timer } = require("../../../functions/auto247Manager.js");
const { THEME_666 } = require("../../../functions/cardRenderer666.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "247-disable",
    description: "Nonaktifkan mode Voice Channel 24/7 otomatis pada bot ini tanpa mengganggu bot lain",
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
        cancelAuto247Timer(client, interaction.guildId);

        if (existing?.voiceChannelId) {
            await upsertAuto247Config(client, {
                guildId: interaction.guildId,
                voiceChannelId: existing.voiceChannelId,
                enabled: false,
                autoReconnect: existing.autoReconnect ?? false,
                updatedBy: interaction.user.id,
            });
        }

        const botName = client.user?.username || "Lagukan 666";
        const embed = new EmbedBuilder()
            .setColor(THEME_666.embedColor)
            .setTitle("666 • Auto 24/7 Disabled")
            .setDescription(
                `🔕 Mode **Auto 24/7** untuk **${botName}** telah **Dinonaktifkan** di server ini. Bot tidak akan otomatis masuk atau auto-reconnect saat restart/terputus.`,
            );

        return safeEditReply(interaction, { embeds: [embed] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
