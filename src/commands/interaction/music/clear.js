const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require("discord.js");
const { refreshNowPlayingDashboard } = require("../../../functions/nowPlayingManager.js");
const { safeDeferReply, safeEditReply, safeDeferUpdate, safeReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "clear",
    description: "Clear all upcoming tracks in the Lagukan music queue",
    category: "music",
    options: [
        {
            name: "force",
            description: "Clear immediately without confirmation prompt",
            type: 5,
            required: false,
        },
    ],
    permissions: {
        bot: [],
        user: [],
    },
    settings: {
        voice: true,
        player: true,
        current: true,
        dj: true,
    },
    devOnly: false,
    run: async (client, interaction, player) => {
        const embed = new EmbedBuilder().setColor(client.config.embedColor);

        if (player.queue.isEmpty) {
            embed.setDescription("The queue is already empty.");
            return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        const force = Boolean(interaction.options.getBoolean("force"));
        if (force) {
            const count = player.queue.size;
            player.queue.clear();
            player.data?.set?.("shuffled", false);
            await refreshNowPlayingDashboard(client, player);

            embed.setDescription(`Cleared \`${count}\` track(s) from the queue.`);
            return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const count = player.queue.size;
        embed.setDescription(`Are you sure you want to clear all **\`${count}\`** upcoming track(s) from the queue?`);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("queue_clear:confirm").setLabel(`Clear ${count} Track(s)`).setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("queue_clear:cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
        );

        const msg = await safeEditReply(interaction, { embeds: [embed], components: [row] });
        if (!msg || typeof msg.createMessageComponentCollector !== "function") return;

        const collector = msg.createMessageComponentCollector({ time: 30000 });
        let handled = false;

        collector.on("collect", (btn) => {
            void (async () => {
                if (btn.user.id !== interaction.user.id) return;
                const ack = await safeDeferUpdate(btn);
                if (!ack) return;

                handled = true;
                collector.stop("done");

                if (btn.customId === "queue_clear:cancel") {
                    embed.setDescription("Queue clear cancelled.");
                    await safeEditReply(interaction, { embeds: [embed], components: [] });
                    return;
                }

                const clearedCount = player.queue?.size || 0;
                player.queue?.clear?.();
                player.data?.set?.("shuffled", false);
                await refreshNowPlayingDashboard(client, player);

                embed.setDescription(`Cleared \`${clearedCount}\` track(s) from the queue.`);
                await safeEditReply(interaction, { embeds: [embed], components: [] });
            })().catch(() => {});
        });

        collector.on("end", () => {
            if (handled) return;
            embed.setDescription("Queue clear confirmation timed out.");
            safeEditReply(interaction, { embeds: [embed], components: [] }).catch(() => {});
        });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
