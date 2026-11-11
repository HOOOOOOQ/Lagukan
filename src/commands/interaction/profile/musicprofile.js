const { ApplicationCommandOptionType } = require("discord.js");
const { buildProfileEmbedAndComponents, attachProfileCollector } = require("../../../functions/musicStatsEngine.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "musicprofile",
    description: "Lihat kartu Profil Musik Lagukan lengkap (Level, XP, Statistik, Favorit, Playlist & Wrapped)",
    category: "profile",
    options: [
        {
            name: "user",
            description: "Anggota server yang ingin dilihat profil musiknya (kosongkan untuk dirimu sendiri)",
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

        const payload = await buildProfileEmbedAndComponents(client, {
            guild: interaction.guild,
            targetUser,
            targetMember,
        });

        const sent = await safeEditReply(interaction, payload);
        if (sent) {
            attachProfileCollector(client, sent, {
                guild: interaction.guild,
                targetUser,
                targetMember,
                viewerId: interaction.user.id,
            });
        }
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
