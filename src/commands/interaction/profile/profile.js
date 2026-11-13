const { ApplicationCommandOptionType } = require("discord.js");
const { buildUserProfile666Payload } = require("../../../functions/profile666Engine.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "profile",
    description: "Lihat kartu 666 User Music Profile (Total Play, Jam, Lagu Favorit, Rank & Badge)",
    category: "profile",
    options: [
        {
            name: "user",
            description: "Pengguna yang ingin dilihat profil musiknya (kosongkan untuk dirimu sendiri)",
            type: ApplicationCommandOptionType.User,
            required: false,
        },
    ],
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
        const deferred = await safeDeferReply(interaction);
        if (!deferred) return;

        const targetUser = interaction.options.getUser("user") || interaction.user;
        const targetMember =
            targetUser.id === interaction.user.id
                ? interaction.member
                : interaction.guild.members?.cache?.get?.(targetUser.id) ||
                  (await interaction.guild.members?.fetch?.(targetUser.id).catch(() => null));

        const payload = await buildUserProfile666Payload(client, {
            guild: interaction.guild,
            targetUser,
            targetMember,
        });

        await safeEditReply(interaction, payload);
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
