const FALLBACK_UNKNOWN_MESSAGE = "Maaf, 666 belum memahami perintahmu. Ketik `666 help` untuk melihat daftar perintah.";

const CONVERSATION_RESPONSES = Object.freeze({
    greeting: [
        "Halo! Ada yang bisa 666 bantu?",
        "Hai! Mau putar lagu favoritmu atau dengar cerita hari ini? Ketik saja perintahmu untuk 666.",
        "Halo juga! 666 siap menemani aktivitasmu di server ini.",
        "Hai! Senang menyapamu. Butuh musik santai atau dongeng singkat? Panggil 666 kapan saja!",
    ],
    how_are_you: [
        "666 baik! Kamu sendiri bagaimana?",
        "Kabar 666 prima dan siap memutar musik kapan pun! Semoga harimu juga menyenangkan ya.",
        "666 selalu semangat! Bagaimana kabarmu hari ini?",
        "Baik sekali! Kalau kamu butuh teman dengar lagu, 666 selalu siap.",
    ],
    thanks: [
        "Sama-sama!",
        "Sama-sama! Senang bisa membantu.",
        "Dengan senang hati! Panggil 666 lagi kalau butuh lagu atau cerita lainnya ya.",
        "Sama-sama! Selamat menikmati waktumu di voice channel maupun chat.",
    ],
    identity: [
        "Aku 666, asisten lokal milik Lagukan. Aku berjalan langsung secara lokal di dalam sistem bot untuk membantumu mengontrol musik, mengobrol ringan, dan membacakan cerita.",
        "Kenalkan, aku 666—asisten teks bawaan Lagukan! Seluruh responsku berasal dari sistem lokal Lagukan (tanpa layanan AI generatif eksternal), siap membantumu putar musik dan berbagi cerita.",
        "Aku 666, asisten lokal milik Lagukan yang siap membantumu memutar lagu, mengatur antrean, maupun membacakan dongeng kapan saja tanpa API eksternal!",
    ],
    compliment: [
        "Hehe, terima kasih!",
        "Wah, terima kasih banyak! Kamu juga keren kok.",
        "Hehe, jadi makin semangat menemani kamu dengar musik!",
        "Terima kasih apresiasinya! Yuk lanjut putar lagu kesukaanmu.",
    ],
    morning: [
        "Selamat pagi! Semoga harimu diawali dengan semangat dan musik yang menyenangkan.",
        "Pagi! Jangan lupa sarapan dan awali aktivitasmu dengan lagu favorit lewat `666 play <judul lagu>`.",
        "Selamat pagi! 666 siap menemani produktivitasmu hari ini.",
    ],
    afternoon: [
        "Selamat siang menjelang sore! Jangan lupa istirahat sejenak sambil dengar musik santai.",
        "Halo, selamat siang! Kalau mulai lelah beraktivitas, 666 siap putarkan lagu penyemangat untukmu.",
        "Selamat sore! Waktu yang pas untuk memutar lagu akustik atau membaca cerita pendek dari 666.",
    ],
    night: [
        "Selamat malam! Semoga istirahatmu nyaman.",
        "Selamat malam! Kalau ingin ditemani sebelum tidur, coba ketik `666 dongengin aku` atau putar lagu lembut.",
        "Malam! Terima kasih sudah melewati hari ini dengan hebat. Selamat beristirahat dengan tenang.",
    ],
    mood_sad: [
        "Tetap semangat ya. Tidak apa-apa beristirahat sejenak saat lelah—kalau mau, 666 bisa putarkan lagu yang menenangkan atau bacakan dongeng hangat.",
        "Pelan-pelan saja ya, semoga perasaanmu lekas membaik. Ketik `666 dongengin aku` atau `666 play <lagu tenang>` kalau butuh teman.",
        "666 di sini menemanimu! Kadang satu lagu hangat dan tarik napas panjang bisa membuat hati sedikit lebih lega.",
    ],
    mood_bored: [
        "Lagi bosan? Yuk coba `666 cerita lucu`, `666 cerita horor`, atau putar lagu seru pakai `666 play <judul lagu>`!",
        "Kalau lagi gabut, 666 punya 60 koleksi dongeng, cerpen, komedi, sampai horor lho—cukup ketik `666 cerita lucu` atau `666 cerita fantasi`!",
        "Saatnya isi suasana dengan musik! Ketik `666 play Sheila On 7` atau minta `666 buat cerita pendek`.",
    ],
    music_recommend: [
        "Coba dengarkan beberapa lagu populer ini: `666 play Teh Hijau`, `666 play Sheila On 7 Dan`, `666 play Hindia Secukupnya`, atau `666 play Tulus Monokrom`!",
        "Rekomendasi dari 666: kalau ingin suasana santai coba `666 play Payung Teduh Akad`, atau kalau ingin bernostalgia coba `666 play Dewa 19 Kangen`!",
        "Lagi cari lagu asik? Ketik `666 play Bernadya Untungnya Bumi Masih Berputar` atau `666 play Juicy Luicy Lantas`!",
    ],
});

const MAX_RESPONSE_MEMORY = 1000;
const lastPickedIndexMap = new Map();

function pickVariedResponse(userId, categoryKey, customTimeResolver = null) {
    if (categoryKey === "time_today") {
        const now = customTimeResolver ? customTimeResolver() : new Date();
        const formatted = now.toLocaleString("id-ID", {
            timeZone: "Asia/Jakarta",
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
        return `Sekarang pukul **${formatted} WIB**. Jangan lupa atur waktumu dengan baik ya!`;
    }

    const pool = CONVERSATION_RESPONSES[categoryKey];
    if (!Array.isArray(pool) || pool.length === 0) {
        return FALLBACK_UNKNOWN_MESSAGE;
    }

    if (pool.length === 1) return pool[0];

    const memKey = `${String(userId || "anon")}:${categoryKey}`;
    const prevIdx = lastPickedIndexMap.has(memKey) ? lastPickedIndexMap.get(memKey) : -1;

    let nextIdx = Math.floor(Math.random() * pool.length);
    if (nextIdx === prevIdx) {
        nextIdx = (prevIdx + 1) % pool.length;
    }

    if (lastPickedIndexMap.size >= MAX_RESPONSE_MEMORY && !lastPickedIndexMap.has(memKey)) {
        const oldest = lastPickedIndexMap.keys().next().value;
        if (oldest) lastPickedIndexMap.delete(oldest);
    }
    lastPickedIndexMap.set(memKey, nextIdx);

    return pool[nextIdx];
}

module.exports = {
    FALLBACK_UNKNOWN_MESSAGE,
    CONVERSATION_RESPONSES,
    pickVariedResponse,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
