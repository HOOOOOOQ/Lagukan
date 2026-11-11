const { ApplicationCommandOptionType, EmbedBuilder, MessageFlags, PermissionsBitField } = require("discord.js");
const {
    getActiveParty,
    createPartySession,
    joinPartySession,
    leavePartySession,
    transferPartyHost,
    voteSkipPartyTrack,
    closePartySession,
    buildPartyEmbed,
} = require("../../../functions/musicPartySystem.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "musicparty",
    description: "Buat atau kelola sesi mendengarkan bersama (Music Party) di voice channel server ini",
    category: "music",
    options: [
        {
            name: "create",
            description: "Buat sesi Music Party baru di voice channel kamu saat ini",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "name",
                    description: "Nama sesi party (opsional)",
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
            ],
        },
        {
            name: "join",
            description: "Bergabung ke sesi Music Party yang sedang berjalan di server ini",
            type: ApplicationCommandOptionType.Subcommand,
        },
        {
            name: "leave",
            description: "Keluar dari sesi Music Party",
            type: ApplicationCommandOptionType.Subcommand,
        },
        {
            name: "queue",
            description: "Lihat antrean lagu dan anggota Music Party saat ini",
            type: ApplicationCommandOptionType.Subcommand,
        },
        {
            name: "host",
            description: "Lihat informasi Party Host dan status sesi Music Party",
            type: ApplicationCommandOptionType.Subcommand,
        },
        {
            name: "transfer",
            description: "Pindahkan peran Party Host ke anggota lain",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "user",
                    description: "Anggota tujuan penerima Party Host",
                    type: ApplicationCommandOptionType.User,
                    required: true,
                },
            ],
        },
        {
            name: "voteskip",
            description: "Berikan suara untuk melewati lagu yang sedang diputar di Music Party",
            type: ApplicationCommandOptionType.Subcommand,
        },
        {
            name: "close",
            description: "Tutup sesi Music Party (khusus Party Host atau Admin Server)",
            type: ApplicationCommandOptionType.Subcommand,
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
        const sub = interaction.options.getSubcommand();
        const color = client.config?.embedColor || "#5865F2";
        const deferred = await safeDeferReply(interaction);
        if (!deferred) return;

        const hasManageGuild = Boolean(interaction.memberPermissions?.has?.(PermissionsBitField.Flags.ManageGuild));

        if (sub === "create") {
            const name = interaction.options.getString("name") || "";
            const res = await createPartySession(client, {
                guild: interaction.guild,
                hostUser: interaction.user,
                hostMember: interaction.member,
                name,
                textChannelId: interaction.channelId,
            });
            if (!res.ok) {
                return safeEditReply(interaction, {
                    embeds: [new EmbedBuilder().setColor(color).setDescription(`⚠️ ${res.error}`)],
                });
            }
            return safeEditReply(interaction, { embeds: [buildPartyEmbed(client, res.party)] });
        }

        if (sub === "join") {
            const res = await joinPartySession(client, {
                guild: interaction.guild,
                user: interaction.user,
                member: interaction.member,
            });
            if (!res.ok) {
                return safeEditReply(interaction, {
                    embeds: [new EmbedBuilder().setColor(color).setDescription(`⚠️ ${res.error}`)],
                });
            }
            return safeEditReply(interaction, {
                embeds: [
                    new EmbedBuilder()
                        .setColor(color)
                        .setDescription(
                            `🎉 <@${interaction.user.id}> bergabung ke **${res.party.name}**! Total anggota: \`${res.party.members.length}\`.`,
                        ),
                ],
            });
        }

        if (sub === "leave") {
            const res = await leavePartySession(client, {
                guild: interaction.guild,
                userId: interaction.user.id,
            });
            if (!res.ok) {
                return safeEditReply(interaction, {
                    embeds: [new EmbedBuilder().setColor(color).setDescription(`⚠️ ${res.error}`)],
                });
            }
            const msg = res.closed
                ? `👋 Kamu keluar dan sesi **${res.party.name}** ditutup karena tidak ada anggota tersisa.`
                : res.hostTransferred
                  ? `👋 Kamu keluar dari party. Party Host otomatis dipindahkan ke <@${res.nextHostId}>.`
                  : `👋 Kamu telah keluar dari **${res.party.name}**.`;
            return safeEditReply(interaction, {
                embeds: [new EmbedBuilder().setColor(color).setDescription(msg)],
            });
        }

        if (sub === "queue" || sub === "host") {
            const party = await getActiveParty(client, interaction.guildId);
            if (!party) {
                return safeEditReply(interaction, {
                    embeds: [
                        new EmbedBuilder()
                            .setColor(color)
                            .setDescription("Belum ada sesi Music Party aktif di server ini. Gunakan `/musicparty create`!"),
                    ],
                });
            }
            return safeEditReply(interaction, { embeds: [buildPartyEmbed(client, party)] });
        }

        if (sub === "transfer") {
            const targetUser = interaction.options.getUser("user", true);
            const res = await transferPartyHost(client, {
                guild: interaction.guild,
                requesterId: interaction.user.id,
                targetUser,
                hasManageGuild,
            });
            if (!res.ok) {
                return safeEditReply(interaction, {
                    embeds: [new EmbedBuilder().setColor(color).setDescription(`⚠️ ${res.error}`)],
                });
            }
            return safeEditReply(interaction, {
                embeds: [
                    new EmbedBuilder()
                        .setColor(color)
                        .setDescription(`👑 Party Host untuk **${res.party.name}** berhasil dipindahkan ke <@${targetUser.id}>!`),
                ],
            });
        }

        if (sub === "voteskip") {
            const res = await voteSkipPartyTrack(client, {
                guild: interaction.guild,
                userId: interaction.user.id,
            });
            if (!res.ok) {
                return safeEditReply(interaction, {
                    embeds: [new EmbedBuilder().setColor(color).setDescription(`⚠️ ${res.error}`)],
                });
            }
            if (res.skipped) {
                return safeEditReply(interaction, {
                    embeds: [
                        new EmbedBuilder()
                            .setColor(color)
                            .setDescription(
                                `⏭️ **Vote Skip Tercapai (\`${res.votesCount}/${res.required}\`)!** Melewati lagu **${res.skippedTitle}**.`,
                            ),
                    ],
                });
            }
            return safeEditReply(interaction, {
                embeds: [
                    new EmbedBuilder()
                        .setColor(color)
                        .setDescription(
                            `🗳️ Suara Vote Skip tercatat: **\`${res.votesCount} / ${res.required}\`** suara dibutuhkan untuk melewati lagu ini.`,
                        ),
                ],
            });
        }

        if (sub === "close") {
            const res = await closePartySession(client, {
                guild: interaction.guild,
                requesterId: interaction.user.id,
                hasManageGuild,
            });
            if (!res.ok) {
                return safeEditReply(interaction, {
                    embeds: [new EmbedBuilder().setColor(color).setDescription(`⚠️ ${res.error}`)],
                });
            }
            return safeEditReply(interaction, {
                embeds: [new EmbedBuilder().setColor(color).setDescription(`🛑 Sesi Music Party **${res.party.name}** telah ditutup.`)],
            });
        }
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
