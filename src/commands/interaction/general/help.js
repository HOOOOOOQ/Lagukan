const {
    ActionRowBuilder,
    ApplicationCommandOptionType,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags,
    StringSelectMenuBuilder,
} = require("discord.js");
const { HELP_CATEGORIES, getVerifiedCommandDocs, getDocsForSection, formatCommandField } = require("../../../functions/helpCatalog.js");
const { safeReply, safeEditReply, safeDeferUpdate } = require("../../../functions/interactionResponder.js");

const COMMANDS_PER_PAGE = 4;
const COLLECTOR_TIMEOUT_MS = 5 * 60 * 1000;

function buildHomeEmbed(client, interaction, allDocs) {
    const botName = client.config.botName || "Lagukan";
    const iconUrl = client.user?.displayAvatarURL?.() || undefined;
    const requesterLabel = interaction.member || `<@${interaction.user.id}>`;

    const musicDocs = allDocs.filter((d) => d.categoryKey === "music");
    const playlistDocs = allDocs.filter((d) => d.categoryKey === "playlist");
    const profileDocs = allDocs.filter((d) => d.categoryKey === "profile");
    const settingDocs = allDocs.filter((d) => d.categoryKey === "settings");
    const djDocs = allDocs.filter((d) => d.categoryKey === "dj");
    const gameDocs = allDocs.filter((d) => d.categoryKey === "games");
    const premiumDocs = allDocs.filter((d) => d.categoryKey === "premium");
    const adminDocs = allDocs.filter((d) => d.categoryKey === "admin");

    const fmtNames = (arr) => arr.map((d) => `\`/${d.name}\``).join(", ") || "-";

    return new EmbedBuilder()
        .setColor(client.config.embedColor)
        .setAuthor({ name: `${botName} Music Bot • Pusat Bantuan (/help)`, iconURL: iconUrl })
        .setThumbnail(iconUrl || null)
        .setDescription(
            `Halo **${requesterLabel}**! Saya **${botName}**, bot musik multi-platform, profil pendengar, & mini-game komunitas Discord.\n` +
                `Mendukung **YouTube, YouTube Music, Spotify** *(resolusi audio cerdas)*, **SoundCloud, Deezer, Bandcamp, & Direct Audio URL**.\n\n` +
                `Pilih salah satu dari **8 Kategori** pada **Select Menu** atau klik tombol di bawah untuk melihat detail setiap perintah.`,
        )
        .addFields(
            {
                name: `🎵 MUSIC (${musicDocs.length})`,
                value: fmtNames(musicDocs),
                inline: false,
            },
            {
                name: `📂 PLAYLIST (${playlistDocs.length})`,
                value: fmtNames(playlistDocs),
                inline: true,
            },
            {
                name: `👤 PERSONAL PROFILE (${profileDocs.length})`,
                value: fmtNames(profileDocs),
                inline: true,
            },
            {
                name: `🎧 DJ SYSTEM (${djDocs.length})`,
                value: fmtNames(djDocs),
                inline: true,
            },
            {
                name: `⚙️ SERVER SETTINGS (${settingDocs.length})`,
                value: fmtNames(settingDocs),
                inline: false,
            },
            {
                name: `🎮 MUSIC GAMES (${gameDocs.length})`,
                value: fmtNames(gameDocs),
                inline: true,
            },
            {
                name: `💎 PREMIUM (${premiumDocs.length})`,
                value: fmtNames(premiumDocs),
                inline: true,
            },
            {
                name: `🛡️ ADMIN (${adminDocs.length})`,
                value: fmtNames(adminDocs),
                inline: false,
            },
        )
        .setFooter({
            text: `© ${botName} Music Bot • Total Slash Command Aktif: ${allDocs.length} • Ketik /help command:<nama> untuk detail`,
            iconURL: iconUrl,
        })
        .setTimestamp();
}

function buildSectionEmbed(client, sectionKey, pageIndex, allDocs) {
    const botName = client.config.botName || "Lagukan";
    const iconUrl = client.user?.displayAvatarURL?.() || undefined;

    const meta = sectionKey === "music_settings_only" ? HELP_CATEGORIES.settings : HELP_CATEGORIES[sectionKey] || HELP_CATEGORIES.music;

    const sectionDocs = getDocsForSection(allDocs, sectionKey);
    const totalPages = Math.max(1, Math.ceil(sectionDocs.length / COMMANDS_PER_PAGE));
    const safePage = Math.max(0, Math.min(pageIndex, totalPages - 1));
    const slice = sectionDocs.slice(safePage * COMMANDS_PER_PAGE, (safePage + 1) * COMMANDS_PER_PAGE);

    const embed = new EmbedBuilder()
        .setColor(client.config.embedColor)
        .setAuthor({ name: `${botName} • Dokumentasi Perintah`, iconURL: iconUrl })
        .setTitle(meta.title)
        .setDescription(meta.description)
        .setFooter({
            text: `Halaman ${safePage + 1}/${totalPages} • Menampilkan ${slice.length} dari ${sectionDocs.length} command di kategori ini`,
            iconURL: iconUrl,
        })
        .setTimestamp();

    for (const doc of slice) {
        embed.addFields(formatCommandField(doc));
    }

    return { embed, totalPages, safePage, sectionDocs };
}

function buildSingleCommandEmbed(client, doc) {
    const botName = client.config.botName || "Lagukan";
    const iconUrl = client.user?.displayAvatarURL?.() || undefined;
    const catMeta = HELP_CATEGORIES[doc.categoryKey] || HELP_CATEGORIES.music;
    const cmdDisplay = doc.isPrefix ? doc.name : `/${doc.name}`;

    return new EmbedBuilder()
        .setColor(client.config.embedColor)
        .setAuthor({ name: `${botName} • Detail Perintah`, iconURL: iconUrl })
        .setTitle(`${catMeta.emoji} Command: ${cmdDisplay}`)
        .setDescription(doc.func)
        .addFields(
            { name: "📌 Nama Command", value: `\`${cmdDisplay}\``, inline: true },
            { name: "🗂️ Kategori", value: `\`${catMeta.label.toUpperCase()}\``, inline: true },
            { name: "🔐 Permission Dibutuhkan", value: doc.permission, inline: false },
            { name: "⌨️ Cara Penggunaan", value: `\`${doc.usage}\``, inline: false },
            { name: "🧩 Parameter Wajib / Opsional", value: doc.params, inline: false },
            { name: "💡 Contoh Penggunaan", value: `\`${doc.example}\``, inline: false },
            { name: "⚠️ Batasan Penggunaan", value: doc.limits, inline: false },
        )
        .setFooter({
            text: `${botName} Help Center • Gunakan tombol di bawah untuk kembali ke kategori`,
            iconURL: iconUrl,
        })
        .setTimestamp();
}

function buildHelpComponents(client, state, allDocs) {
    const { view, sectionKey, page, totalPages, selectedCommand } = state;
    const rows = [];

    // Row 1: Category SelectMenu (All 8 Required Categories + Home)
    const categoryMenu = new StringSelectMenuBuilder()
        .setCustomId("help:category")
        .setPlaceholder("📂 Pilih kategori perintah...")
        .addOptions([
            {
                label: "Home — Ringkasan Semua Command",
                description: "Tampilkan halaman utama & daftar singkat seluruh kategori",
                value: "home",
                emoji: "🏠",
                default: view === "home",
            },
            {
                label: "Music — Pemutar, Radio, Sleep & Party",
                description: "Play, Search, Queue, Sleep Timer, Radio Mode, Music Party, dll.",
                value: "music",
                emoji: "🎵",
                default: view === "section" && sectionKey === "music",
            },
            {
                label: "Playlist — Playlist, Favorite & History",
                description: "Manajemen /playlist (create/rename/load), /favorite & /history",
                value: "playlist",
                emoji: "📂",
                default: view === "section" && sectionKey === "playlist",
            },
            {
                label: "Personal Profile — Level, Wrapped & Leaderboard",
                description: "Profil /musicprofile, /musicrank, /wrapped & /musicleaderboard",
                value: "profile",
                emoji: "👤",
                default: view === "section" && sectionKey === "profile",
            },
            {
                label: "Server Settings — Request Panel, Autoplay, Filter & 24/7",
                description: "/musicrequest-config, /autoplay, /filter, /247 & /musicconfig",
                value: "settings",
                emoji: "⚙️",
                default: view === "section" && sectionKey === "settings",
            },
            {
                label: "DJ System — Kontrol Hak Akses DJ Role",
                description: "Pengaturan DJ Mode & DJ Role berbasis Role ID (/dj)",
                value: "dj",
                emoji: "🎧",
                default: view === "section" && sectionKey === "dj",
            },
            {
                label: "Music Games — Guess The Song & Music Battle",
                description: "Mini-game /guessthesong dan voting /musicbattle",
                value: "games",
                emoji: "🎮",
                default: view === "section" && sectionKey === "games",
            },
            {
                label: "Premium — Status Kuota & Kustomisasi Dashboard",
                description: "Cek status & kustomisasi tema server Premium (/premium)",
                value: "premium",
                emoji: "💎",
                default: view === "section" && sectionKey === "premium",
            },
            {
                label: "Admin — Voice Logger & Utilitas",
                description: "Pengaturan log aktivitas voice (/voicelog), /ping & /help",
                value: "admin",
                emoji: "🛡️",
                default: view === "section" && sectionKey === "admin",
            },
        ]);
    rows.push(new ActionRowBuilder().addComponents(categoryMenu));

    // Row 2 (when inside a category/command view): Quick Command Detail SelectMenu
    const activeSectionDocs =
        view === "section"
            ? getDocsForSection(allDocs, sectionKey)
            : view === "command" && selectedCommand
              ? getDocsForSection(allDocs, selectedCommand.categoryKey)
              : [];

    if (activeSectionDocs.length > 0) {
        const cmdMenu = new StringSelectMenuBuilder()
            .setCustomId("help:command")
            .setPlaceholder("🔎 Pilih command untuk melihat kartu detail penuh...")
            .addOptions(
                activeSectionDocs.slice(0, 25).map((doc) => ({
                    label: doc.isPrefix ? doc.name : `/${doc.name}`,
                    description: doc.func.slice(0, 95),
                    value: doc.name,
                    default: view === "command" && selectedCommand?.name === doc.name,
                })),
            );
        rows.push(new ActionRowBuilder().addComponents(cmdMenu));
    }

    // Row 3: Quick Category Buttons [Home] [Music] [Profile] [Games] [Settings]
    const isSettingsActive = view === "section" && ["settings", "music_settings_only", "dj"].includes(sectionKey);
    const navButtonsRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("help:btn:home")
            .setLabel("Home")
            .setEmoji("🏠")
            .setStyle(view === "home" ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("help:btn:music")
            .setLabel("Music")
            .setEmoji("🎵")
            .setStyle(view === "section" && sectionKey === "music" ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("help:btn:profile")
            .setLabel("Profile")
            .setEmoji("👤")
            .setStyle(view === "section" && sectionKey === "profile" ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("help:btn:games")
            .setLabel("Games")
            .setEmoji("🎮")
            .setStyle(view === "section" && sectionKey === "games" ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("help:btn:settings")
            .setLabel("Settings")
            .setEmoji("⚙️")
            .setStyle(isSettingsActive ? ButtonStyle.Primary : ButtonStyle.Secondary),
    );
    rows.push(navButtonsRow);

    // Row 4: Pagination + [Close] (+ optional Support Server link)
    const utilityButtons = [];
    if (view === "section" && totalPages > 1) {
        utilityButtons.push(
            new ButtonBuilder()
                .setCustomId("help:page:prev")
                .setLabel("Prev")
                .setEmoji("◀️")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page <= 0),
            new ButtonBuilder()
                .setCustomId("help:page:info")
                .setLabel(`${page + 1} / ${totalPages}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId("help:page:next")
                .setLabel("Next")
                .setEmoji("▶️")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= totalPages - 1),
        );
    }

    utilityButtons.push(new ButtonBuilder().setCustomId("help:btn:close").setLabel("Close").setEmoji("✖️").setStyle(ButtonStyle.Danger));

    const supportUrl = typeof client?.config?.supportServerUrl === "string" ? client.config.supportServerUrl.trim() : "";
    if (supportUrl && /^https?:\/\//i.test(supportUrl) && utilityButtons.length < 5) {
        utilityButtons.push(new ButtonBuilder().setLabel("Support Server").setURL(supportUrl).setStyle(ButtonStyle.Link));
    }

    rows.push(new ActionRowBuilder().addComponents(utilityButtons));
    return rows;
}

module.exports = {
    name: "help",
    description: "Buka pusat bantuan interaktif lengkap untuk seluruh slash command Lagukan",
    category: "general",
    options: [
        {
            name: "command",
            description: "Nama slash command spesifik yang ingin dilihat detailnya (opsional)",
            type: ApplicationCommandOptionType.String,
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
        const allDocs = getVerifiedCommandDocs(client);
        const rawQuery = interaction.options?.getString?.("command")?.trim()?.replace(/^\//, "")?.toLowerCase() || "";

        let state = {
            view: "home",
            sectionKey: "home",
            page: 0,
            totalPages: 1,
            selectedCommand: null,
        };

        if (rawQuery) {
            const matched = allDocs.find((d) => d.name.toLowerCase() === rawQuery);
            if (matched) {
                state = {
                    view: "command",
                    sectionKey: matched.categoryKey,
                    page: 0,
                    totalPages: 1,
                    selectedCommand: matched,
                };
            }
        }

        const renderPayload = () => {
            if (state.view === "command" && state.selectedCommand) {
                const embed = buildSingleCommandEmbed(client, state.selectedCommand);
                return {
                    embeds: [embed],
                    components: buildHelpComponents(client, state, allDocs),
                };
            }

            if (state.view === "section") {
                const { embed, totalPages, safePage } = buildSectionEmbed(client, state.sectionKey, state.page, allDocs);
                state.page = safePage;
                state.totalPages = totalPages;
                return {
                    embeds: [embed],
                    components: buildHelpComponents(client, state, allDocs),
                };
            }

            state.totalPages = 1;
            state.page = 0;
            const embed = buildHomeEmbed(client, interaction, allDocs);
            return {
                embeds: [embed],
                components: buildHelpComponents(client, state, allDocs),
            };
        };

        const initialReply = await safeReply(interaction, {
            ...renderPayload(),
            withResponse: true,
        });

        const message = initialReply?.resource?.message || initialReply;
        if (!message || typeof message.createMessageComponentCollector !== "function") {
            return initialReply;
        }

        const collector = message.createMessageComponentCollector({ time: COLLECTOR_TIMEOUT_MS });
        let closedManually = false;

        collector.on("collect", (comp) => {
            void (async () => {
                if (comp.user.id !== interaction.user.id) {
                    const notice = new EmbedBuilder()
                        .setColor(client.config.embedColor)
                        .setDescription("Gunakan perintah `/help` milik Anda sendiri untuk menavigasi menu bantuan.");
                    await safeReply(comp, { embeds: [notice], flags: MessageFlags.Ephemeral });
                    return;
                }

                const ack = await safeDeferUpdate(comp);
                if (!ack) return;

                if (comp.customId === "help:btn:close") {
                    closedManually = true;
                    collector.stop("closed");
                    if (typeof interaction.deleteReply === "function") {
                        const deleted = await interaction
                            .deleteReply()
                            .then(() => true)
                            .catch(() => false);
                        if (deleted) return;
                    }
                    const closedEmbed = new EmbedBuilder()
                        .setColor(client.config.embedColor)
                        .setDescription("✅ Menu bantuan ditutup. Ketik `/help` kapan saja untuk membukanya kembali.");
                    await safeEditReply(interaction, { embeds: [closedEmbed], components: [] });
                    return;
                }

                if (comp.customId === "help:category") {
                    const chosen = comp.values?.[0] || "home";
                    if (chosen === "home") {
                        state = { view: "home", sectionKey: "home", page: 0, totalPages: 1, selectedCommand: null };
                    } else {
                        state = { view: "section", sectionKey: chosen, page: 0, totalPages: 1, selectedCommand: null };
                    }
                } else if (comp.customId === "help:command") {
                    const cmdName = comp.values?.[0] || "";
                    const found = allDocs.find((d) => d.name === cmdName);
                    if (found) {
                        state = {
                            view: "command",
                            sectionKey: found.categoryKey,
                            page: 0,
                            totalPages: 1,
                            selectedCommand: found,
                        };
                    }
                } else if (comp.customId.startsWith("help:btn:")) {
                    const target = comp.customId.replace("help:btn:", "");
                    if (target === "home") {
                        state = { view: "home", sectionKey: "home", page: 0, totalPages: 1, selectedCommand: null };
                    } else {
                        state = { view: "section", sectionKey: target, page: 0, totalPages: 1, selectedCommand: null };
                    }
                } else if (comp.customId === "help:page:prev") {
                    state.page = Math.max(0, state.page - 1);
                } else if (comp.customId === "help:page:next") {
                    state.page = Math.min(state.totalPages - 1, state.page + 1);
                }

                await safeEditReply(interaction, renderPayload());
            })().catch(() => {});
        });

        collector.on("end", () => {
            if (closedManually) return;
            safeEditReply(interaction, { components: [] }).catch(() => {});
        });

        return initialReply;
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
