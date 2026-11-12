const { EmbedBuilder, MessageFlags } = require("discord.js");
const { createDataGuild, normalizeGuildData } = require("../../../functions/createData.js");
const { clearManualDisconnect, cancelInactivityTimer } = require("../../../functions/voiceSessionManager.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "247",
    description: "Toggle Lagukan 24/7 mode",
    category: "setting",
    permissions: {
        bot: [],
        user: ["ManageGuild"],
    },
    settings: {
        voice: true,
        player: true,
        current: false,
    },
    devOnly: false,
    run: async (client, interaction, player) => {
        const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const guild = interaction.guild;
        const guildData =
            client.data.get(`guildData_${interaction.guildId}`) ||
            (await createDataGuild(client, guild)) ||
            normalizeGuildData(client, guild, { id: interaction.guildId });

        const nextStatus = !guildData.reconnect.status;

        if (nextStatus) {
            await clearManualDisconnect(client, interaction.guildId, guild);
            cancelInactivityTimer(interaction.guildId);
            guildData.manualDisconnect = false;
            guildData.reconnect = {
                status: true,
                text: player.textId || interaction.channelId,
                voice: player.voiceId || interaction.member.voice.channelId,
                botId: client.user?.id || null,
            };
        } else {
            guildData.reconnect = {
                status: false,
                text: null,
                voice: null,
                botId: null,
            };
        }

        client.data.set(`guildData_${interaction.guildId}`, guildData);

        await client.guildData
            ?.findOneAndUpdate(
                { id: interaction.guildId },
                {
                    $set: {
                        manualDisconnect: Boolean(guildData.manualDisconnect),
                        reconnect: guildData.reconnect,
                    },
                },
                { upsert: true, returnDocument: "after" },
            )
            .catch(() => {});

        const embed = new EmbedBuilder()
            .setColor(client.config.embedColor)
            .setDescription(guildData.reconnect.status ? "24/7 mode is now `enabled`." : "24/7 mode is now `disabled`.");

        return safeEditReply(interaction, { embeds: [embed] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
