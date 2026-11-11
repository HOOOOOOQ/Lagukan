const STORIES_DATA = require("./stories.json");

const STORY_CATEGORY_META = Object.freeze({
    dongeng: {
        key: "dongeng",
        label: "Dongeng Pengantar & Hikmah",
        emoji: "🧚",
        commandHint: "666 dongengin aku",
    },
    horor: {
        key: "horor",
        label: "Cerita Horor & Misteri",
        emoji: "👻",
        commandHint: "666 cerita horor",
    },
    romantis: {
        key: "romantis",
        label: "Cerita Romantis & Hangat",
        emoji: "💖",
        commandHint: "666 cerita romantis",
    },
    lucu: {
        key: "lucu",
        label: "Cerita Lucu & Komedi",
        emoji: "😂",
        commandHint: "666 cerita lucu",
    },
    fantasi: {
        key: "fantasi",
        label: "Cerita Fantasi & Petualangan",
        emoji: "🧙",
        commandHint: "666 cerita fantasi",
    },
    pendek: {
        key: "pendek",
        label: "Cerita Pendek (Cerpen)",
        emoji: "📖",
        commandHint: "666 buat cerita pendek",
    },
});

const MAX_RECENT_USERS = 1000;
const recentStoryHistory = new Map();

function pickStoryForUser(userId, categoryKey = "pendek") {
    const normalizedKey = STORY_CATEGORY_META[categoryKey] ? categoryKey : "pendek";
    const list = Array.isArray(STORIES_DATA[normalizedKey]) ? STORIES_DATA[normalizedKey] : STORIES_DATA.pendek;
    const meta = STORY_CATEGORY_META[normalizedKey];

    const mapKey = `${String(userId || "anon")}:${normalizedKey}`;
    const seenIds = recentStoryHistory.get(mapKey) || [];

    let candidates = list.filter((item) => !seenIds.includes(item.id));
    if (candidates.length === 0) {
        candidates = list;
        seenIds.length = 0;
    }

    const chosen = candidates[Math.floor(Math.random() * candidates.length)];

    const updatedSeen = [...seenIds, chosen.id].slice(-Math.max(1, list.length - 1));
    if (recentStoryHistory.size >= MAX_RECENT_USERS && !recentStoryHistory.has(mapKey)) {
        const oldestKey = recentStoryHistory.keys().next().value;
        if (oldestKey) recentStoryHistory.delete(oldestKey);
    }
    recentStoryHistory.set(mapKey, updatedSeen);

    return {
        category: meta,
        story: chosen,
        totalInCategory: list.length,
    };
}

function getStoryCategoryCounts() {
    const summary = {};
    for (const key of Object.keys(STORY_CATEGORY_META)) {
        summary[key] = Array.isArray(STORIES_DATA[key]) ? STORIES_DATA[key].length : 0;
    }
    return summary;
}

module.exports = {
    STORIES_DATA,
    STORY_CATEGORY_META,
    pickStoryForUser,
    getStoryCategoryCounts,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
