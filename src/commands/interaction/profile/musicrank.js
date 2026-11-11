const { ApplicationCommandOptionType, EmbedBuilder } = require("discord.js");
const { computeUserProfileSnapshot, formatListeningDurationHuman } = require("../../../functions/musicStatsEngine.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "musicrank",
    description: "Cek Listener Level, Music XP, progres menuju level berikutnya, dan peringkat di server",
    category: "profile",
    options: [
        {
            name: "user",
            description: "Anggota yang ingin dilihat peringkat musiknya",
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

        const snap = await computeUserProfileSnapshot(client, {
            targetUser,
            targetMember,
            guild: interaction.guild,
        });
        const lv = snap.levelInfo;

        const embed = new EmbedBuilder()
            .setColor(client.config?.embedColor || "#5865F2")
            .setAuthor({
                name: `${client.config?.botName || "Lagukan"} • Listener Rank & Level`,
                iconURL: client.user?.displayAvatarURL?.(),
            })
            .setTitle(`${lv.badge} ${targetUser.username} — ${lv.title}`)
            .setThumbnail(targetUser.displayAvatarURL?.({ size: 256 }) || null)
            .setDescription(
                `**Progres Music XP:**\n` +
                    `\`${lv.progressBar}\` **${lv.progressPct}%** (\`${lv.xp} / ${lv.nextLevelXp} XP\`)\n\n` +
                    `*Catatan: Music XP hanya diberikan dari pemutaran lagu yang benar-benar berjalan (anti-farming aktif).*`,
            )
            .addFields(
                { name: "Listener Level", value: `\`Lv.${lv.level} • ${lv.title}\``, inline: true },
                { name: "Total Music XP", value: `\`${lv.xp.toLocaleString("id-ID")} XP\``, inline: true },
                { name: "Server Rank", value: `\`${snap.serverRank}\``, inline: true },
                {
                    name: "Lagu Selesai Diputar",
                    value: `\`${Number(snap.profile?.totalTracksCompleted || 0)} lagu\``,
                    inline: true,
                },
                {
                    name: "Total Waktu Dengar",
                    value: `\`${formatListeningDurationHuman(snap.profile?.totalListeningMs || 0)}\``,
                    inline: true,
                },
                {
                    name: "Status Akun",
                    value: `\`${snap.premium?.label || "Standard"}\``,
                    inline: true,
                },
            )
            .setFooter({ text: `Gunakan 666!cek atau /musicprofile untuk melihat kartu profil lengkap` })
            .setTimestamp();

        return safeEditReply(interaction, { embeds: [embed] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
