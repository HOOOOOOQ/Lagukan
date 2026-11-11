const { EmbedBuilder, MessageFlags } = require("discord.js");
const { nodeSupportsFilter } = require("../../../functions/nodeHealthManager.js");
const { refreshNowPlayingDashboard } = require("../../../functions/nowPlayingManager.js");
const { safeDeferReply, safeEditReply } = require("../../../functions/interactionResponder.js");

const EQUALIZER_PRESETS = {
    flat: Array.from({ length: 15 }, (_, band) => ({ band, gain: 0.0 })),
    bass: [
        { band: 0, gain: 0.35 },
        { band: 1, gain: 0.3 },
        { band: 2, gain: 0.22 },
        { band: 3, gain: 0.12 },
        { band: 4, gain: 0.0 },
        { band: 5, gain: -0.05 },
    ],
    pop: [
        { band: 0, gain: -0.05 },
        { band: 1, gain: 0.12 },
        { band: 2, gain: 0.2 },
        { band: 3, gain: 0.22 },
        { band: 4, gain: 0.14 },
        { band: 5, gain: 0.0 },
    ],
    rock: [
        { band: 0, gain: 0.28 },
        { band: 1, gain: 0.22 },
        { band: 2, gain: 0.08 },
        { band: 3, gain: -0.08 },
        { band: 4, gain: 0.05 },
        { band: 5, gain: 0.2 },
        { band: 6, gain: 0.26 },
    ],
    vocal: [
        { band: 0, gain: -0.15 },
        { band: 1, gain: -0.1 },
        { band: 4, gain: 0.2 },
        { band: 5, gain: 0.28 },
        { band: 6, gain: 0.25 },
        { band: 7, gain: 0.15 },
    ],
    treble: [
        { band: 8, gain: 0.18 },
        { band: 9, gain: 0.24 },
        { band: 10, gain: 0.28 },
        { band: 11, gain: 0.3 },
        { band: 12, gain: 0.3 },
    ],
};

const FILTER_REQUIRED_CAPABILITY = {
    eightD: "rotation",
    bass: "equalizer",
    equalizer: "equalizer",
    chimpunk: "timescale",
    earrape: "equalizer",
    electronic: "equalizer",
    karaoke: "karaoke",
    nightcore: "timescale",
    pitch: "timescale",
    slow: "timescale",
    soft: "lowpass",
    tremolo: "tremolo",
    treblebass: "equalizer",
    vaporwave: "timescale",
    vibrato: "vibrato",
};

const FILTER_LABELS = {
    eightD: "8D Audio",
    bass: "Bassboost",
    equalizer: "Equalizer",
    chimpunk: "Chipmunk",
    earrape: "Earrape",
    electronic: "Electronic",
    karaoke: "Karaoke",
    nightcore: "Nightcore",
    pitch: "Pitch",
    slow: "Slowed",
    soft: "Soft",
    tremolo: "Tremolo",
    treblebass: "Treble & Bass",
    vaporwave: "Vaporwave",
    vibrato: "Vibrato",
};

module.exports = {
    name: "filter",
    description: "Apply audio filters (Bassboost, Nightcore, Vaporwave, 8D, Equalizer, and more)",
    category: "music",
    options: [
        {
            name: "mode",
            description: "Choose an audio filter preset",
            type: 3,
            required: true,
            choices: [
                { name: "clear / off", value: "clear" },
                { name: "bassboost", value: "bass" },
                { name: "nightcore", value: "nightcore" },
                { name: "vaporwave", value: "vaporwave" },
                { name: "8d", value: "eightD" },
                { name: "equalizer", value: "equalizer" },
                { name: "electronic", value: "electronic" },
                { name: "karaoke", value: "karaoke" },
                { name: "treblebass", value: "treblebass" },
                { name: "soft", value: "soft" },
                { name: "slow", value: "slow" },
                { name: "tremolo", value: "tremolo" },
                { name: "vibrato", value: "vibrato" },
                { name: "pitch", value: "pitch" },
                { name: "chipmunk", value: "chimpunk" },
                { name: "earrape", value: "earrape" },
            ],
        },
        {
            name: "eq_preset",
            description: "Equalizer curve when mode is set to equalizer",
            type: 3,
            required: false,
            choices: [
                { name: "Flat", value: "flat" },
                { name: "Deep Bass", value: "bass" },
                { name: "Pop", value: "pop" },
                { name: "Rock", value: "rock" },
                { name: "Vocal Boost", value: "vocal" },
                { name: "Treble Boost", value: "treble" },
            ],
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
        const deferred = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const embed = new EmbedBuilder().setColor(client.config.embedColor);
        const mode = interaction.options.getString("mode");
        const eqPreset = interaction.options.getString("eq_preset") || "pop";
        const currentVolume = player.volume;

        if (mode !== "clear") {
            const requiredCap = FILTER_REQUIRED_CAPABILITY[mode];
            if (requiredCap && !nodeSupportsFilter(player.node, requiredCap)) {
                embed.setDescription(
                    `The \`${FILTER_LABELS[mode] || mode}\` filter (\`${requiredCap}\`) is disabled on the connected Lavalink node.`,
                );
                return safeEditReply(interaction, { embeds: [embed] });
            }
        }

        if (mode === "clear") {
            await Promise.resolve(player.filter.clear());
            player.data?.delete?.("activeFilter");
            embed.setDescription("All audio filters have been cleared.");
        } else if (mode === "equalizer") {
            const bands = EQUALIZER_PRESETS[eqPreset] || EQUALIZER_PRESETS.pop;
            await Promise.resolve(player.filter.setEqualizer(bands));
            const label = `EQ (${eqPreset})`;
            player.data?.set?.("activeFilter", label);
            embed.setDescription(`Equalizer preset set to \`${eqPreset}\`.`);
        } else {
            await Promise.resolve(player.filter.set(mode));
            const label = FILTER_LABELS[mode] || mode;
            player.data?.set?.("activeFilter", label);
            embed.setDescription(`Audio filter set to \`${label}\`.`);
        }

        await Promise.resolve(player.setVolume(currentVolume));
        await refreshNowPlayingDashboard(client, player);

        return safeEditReply(interaction, { embeds: [embed] });
    },
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
