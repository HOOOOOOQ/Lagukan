const { EmbedBuilder, MessageFlags } = require("discord.js");
const { createDataGuild, normalizeGuildData } = require("../../../functions/createData.js");
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

        guildData.reconnect.status = !guildData.reconnect.status;
        guildData.reconnect.text = player.textId || interaction.channelId;
        guildData.reconnect.voice = player.voiceId || interaction.member.voice.channelId;

        client.data.set(`guildData_${interaction.guildId}`, guildData);

        await client.guildData
            ?.findOneAndUpdate(
                { id: interaction.guildId },
                { $set: { reconnect: guildData.reconnect } },
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
