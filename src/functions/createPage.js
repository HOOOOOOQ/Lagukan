const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require("discord.js");
const { safeReply, safeDeferUpdate } = require("./interactionResponder.js");

module.exports = {
    createPage: async (client, response, embed, pages) => {
        let page = 0;

        const updateEmbed = (pageIndex) => {
            embed.setDescription(pages[pageIndex] || "No data found.");
        };

        updateEmbed(page);

        if (pages.length <= 1) {
            return safeReply(response, { embeds: [embed] });
        }

        const pageEmoji = client.emoji.page;
        const buttons = {
            first: new ButtonBuilder().setCustomId("first").setEmoji(pageEmoji.first).setStyle(ButtonStyle.Secondary),
            back: new ButtonBuilder().setCustomId("back").setEmoji(pageEmoji.back).setStyle(ButtonStyle.Secondary),
            close: new ButtonBuilder().setCustomId("close").setEmoji(pageEmoji.close).setStyle(ButtonStyle.Danger),
            next: new ButtonBuilder().setCustomId("next").setEmoji(pageEmoji.next).setStyle(ButtonStyle.Secondary),
            last: new ButtonBuilder().setCustomId("last").setEmoji(pageEmoji.last).setStyle(ButtonStyle.Secondary),
        };
        const row = new ActionRowBuilder().addComponents(Object.values(buttons));
        const msg = await safeReply(response, { embeds: [embed], components: [row] });
        if (!msg || typeof msg.createMessageComponentCollector !== "function") return;

        const ownerId = response.user?.id || response.author?.id;
        const collector = msg.createMessageComponentCollector({ time: 60000 });

        collector.on("collect", async (button) => {
            if (button.user.id !== ownerId) {
                const embedDenied = new EmbedBuilder()
                    .setColor(client.config.embedColor)
                    .setDescription(`You are not allowed to use this button.`);

                return safeReply(button, { embeds: [embedDenied], flags: MessageFlags.Ephemeral });
            }

            const acknowledged = await safeDeferUpdate(button);
            if (!acknowledged) return;

            switch (button.customId) {
                case "first":
                    page = 0;
                    break;
                case "back":
                    page = page > 0 ? page - 1 : 0;
                    break;
                case "close":
                    await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
                    return collector.stop();
                case "next":
                    page = page + 1 < pages.length ? page + 1 : pages.length - 1;
                    break;
                case "last":
                    page = pages.length - 1;
                    break;
            }

            updateEmbed(page);

            await msg.edit({ embeds: [embed], components: [row] }).catch(() => {});
        });

        collector.on("end", async () => {
            await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
        });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
