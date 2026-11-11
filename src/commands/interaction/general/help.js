const { EmbedBuilder } = require("discord.js");
const { readdirSync } = require("fs");
const path = require("path");
const { buildSupportComponents, safeReply } = require("../../../functions/interactionResponder.js");

module.exports = {
    name: "help",
    description: "Get a list of Lagukan commands",
    category: "general",
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
        const botName = client.config.botName || "Lagukan";
        const embed = new EmbedBuilder().setColor(client.config.embedColor);
        const categories = readdirSync(path.join(__dirname, ".."));

        for (const category of categories) {
            const commands = client.slash.filter((c) => c.category === category);
            if (!commands.size) continue;

            const slashCommandData = commands.map((c) => `\`${c.name}\``);
            const categoryNames = { general: "General", music: "Music", setting: "Settings" };
            const categoryName = categoryNames[category] || category;

            embed.addFields({
                name: `\`❯\`  ${toOppositeCase(categoryName)}`,
                value: `${slashCommandData.join(", ")}`,
            });
        }

        const requesterLabel = interaction.member || `<@${interaction.user.id}>`;

        embed
            .setAuthor({ name: `${botName} Music Bot - Help`, iconURL: client.user.displayAvatarURL() })
            .setThumbnail(client.user.displayAvatarURL())
            .setDescription(
                `Hello **${requesterLabel}**, I'm **${botName}** (${client.user}) — **${botName} Music Bot**, a Multi-Platform Discord Music Bot supporting YouTube, YouTube Music, Spotify, SoundCloud, Deezer, Bandcamp & More. Find out what I can do using the commands below:`,
            )
            .setFooter({
                text: `© ${botName} Music Bot | Total Commands: ${client.slash.size}`,
                iconURL: client.user.displayAvatarURL(),
            })
            .setTimestamp();

        const components = buildSupportComponents(client, "Support Server");

        return safeReply(interaction, { embeds: [embed], components });
    },
};

function toOppositeCase(char) {
    if (!char) return "Commands";
    return char.charAt(0).toUpperCase() + char.slice(1).toLowerCase();
}

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
