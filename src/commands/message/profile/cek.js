const { buildProfileEmbedAndComponents, attachProfileCollector } = require("../../../functions/musicStatsEngine.js");

module.exports = {
    name: "cek",
    aliases: ["musiccek"],
    description: "Tampilkan profil musik Lagukan milikmu atau anggota lain (666!cek / 666!cek @user)",
    category: "profile",
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
    run: async (client, message, player, args = []) => {
        let targetUser = message.mentions?.users?.first?.() || null;
        let targetMember = message.mentions?.members?.first?.() || null;

        if (!targetUser && args[0]) {
            const idMatch = String(args[0]).match(/^<?@?!?(\d{17,20})>?$/);
            if (idMatch) {
                const targetId = idMatch[1];
                targetMember =
                    message.guild.members?.cache?.get?.(targetId) || (await message.guild.members?.fetch?.(targetId).catch(() => null));
                targetUser =
                    targetMember?.user || client.users?.cache?.get?.(targetId) || (await client.users?.fetch?.(targetId).catch(() => null));
            }
        }

        if (!targetUser) {
            targetUser = message.author;
            targetMember = message.member;
        }

        const payload = await buildProfileEmbedAndComponents(client, {
            guild: message.guild,
            targetUser,
            targetMember,
        });

        const sent = await message.reply(payload).catch(() => null);
        if (sent) {
            attachProfileCollector(client, sent, {
                guild: message.guild,
                targetUser,
                targetMember,
                viewerId: message.author.id,
            });
        }
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
