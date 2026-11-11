/**
 * Authoritative documentation catalog for all 40 registered Lagukan slash commands.
 * Every entry documents:
 * 1. name (Nama command)
 * 2. func (Fungsi)
 * 3. usage (Cara penggunaan)
 * 4. params (Parameter wajib / opsional)
 * 5. example (Contoh penggunaan)
 * 6. permission (Permission yang dibutuhkan)
 * 7. limits (Batasan penggunaan)
 */

const HELP_CATEGORIES = {
    home: {
        id: "home",
        label: "Home",
        title: "🏠 Ringkasan Bantuan & Panduan Cepat",
        emoji: "🏠",
        description: "Ringkasan platform musik, kategori fitur, dan panduan mulai cepat.",
    },
    music: {
        id: "music",
        label: "Music",
        title: "🎵 Kategori: MUSIC (Pemutar & Kontrol Antrean)",
        emoji: "🎵",
        description: "Perintah pemutaran lagu multi-platform, antrean, navigasi lagu, volume, dan lirik.",
    },
    playlist: {
        id: "playlist",
        label: "Playlist",
        title: "📂 Kategori: PLAYLIST, FAVORITE & HISTORY",
        emoji: "📂",
        description: "Manajemen playlist pribadi lintas server, playlist bersama server, daftar lagu favorit, dan riwayat lagu.",
    },
    settings: {
        id: "settings",
        label: "Music Settings",
        title: "⚙️ Kategori: MUSIC SETTINGS",
        emoji: "⚙️",
        description: "Pengaturan Smart Autoplay, efek audio Filter/Equalizer, mode 24/7, DJ Mode, DJ Role, dan Auto-Leave.",
    },
    customrole: {
        id: "customrole",
        label: "Custom Role",
        title: "🎨 Kategori: CUSTOM ROLE",
        emoji: "🎨",
        description: "Pembuatan role kustom member (warna/gradasi/ikon) dan konfigurasi panel Custom Role admin.",
    },
    admin: {
        id: "admin",
        label: "Admin",
        title: "🛡️ Kategori: ADMIN, LOGS & UTILITAS",
        emoji: "🛡️",
        description: "Konfigurasi Server Tag Logger, Server Tag Auto Role, Voice Activity Logger, statistik, & utilitas.",
    },
};

const COMMAND_DOCS = [
    // =========================================================================
    // MUSIC (21 Commands)
    // =========================================================================
    {
        name: "play",
        categoryKey: "music",
        func: "Memutar lagu, playlist, atau tautan musik (YouTube, YT Music, Spotify, SoundCloud, Deezer, Bandcamp, URL Audio).",
        usage: "/play query:<judul/artis/URL> [direct:<true|false>]",
        params: "Wajib: `query` (teks/URL) • Opsional: `direct` (langsung putar hasil #1 tanpa menu pilih)",
        example: "/play query:Teh Hijau • /play query:Hindia Secukupnya direct:true",
        permission: "User & Bot: `Connect`, `Speak` pada voice channel",
        limits: "Wajib berada di voice channel yang sama dengan bot; batas anti-spam pencarian aktif.",
    },
    {
        name: "search",
        categoryKey: "music",
        func: "Mencari daftar lagu berdasarkan judul/artis pada sumber pilihan lalu memilih dari menu interaktif.",
        usage: "/search query:<kata_kunci> [source:<ytmusic|youtube|soundcloud>]",
        params: "Wajib: `query` • Opsional: `source` (mesin pencari)",
        example: "/search query:Sheila On 7 Dan source:ytmusic",
        permission: "User & Bot: `Connect`, `Speak` pada voice channel",
        limits: "Menampilkan maks. 10 kandidat lagu dengan batas waktu pilih 60 detik.",
    },
    {
        name: "pause",
        categoryKey: "music",
        func: "Menjeda (pause) pemutaran lagu yang sedang berjalan.",
        usage: "/pause",
        params: "Tidak ada parameter",
        example: "/pause",
        permission: "Anggota di voice yang sama (atau DJ Role / Peminta lagu jika DJ Mode aktif)",
        limits: "Hanya dapat digunakan saat ada lagu yang sedang diputar dan belum dijeda.",
    },
    {
        name: "resume",
        categoryKey: "music",
        func: "Melanjutkan kembali pemutaran lagu yang sedang dijeda.",
        usage: "/resume",
        params: "Tidak ada parameter",
        example: "/resume",
        permission: "Anggota di voice yang sama (atau DJ Role / Peminta lagu jika DJ Mode aktif)",
        limits: "Hanya dapat digunakan saat player dalam keadaan paused.",
    },
    {
        name: "skip",
        categoryKey: "music",
        func: "Melewati lagu saat ini ke lagu berikutnya atau melompat langsung ke nomor urut antrean tertentu.",
        usage: "/skip [to:<nomor_antrean>]",
        params: "Opsional: `to` (angka >= 1 untuk melompat ke posisi antrean)",
        example: "/skip • /skip to:3",
        permission: "Voice yang sama; DJ Role/Admin diperlukan untuk melompat banyak antrean jika DJ Mode aktif",
        limits: "Membutuhkan lagu berikutnya di antrean atau fitur `/autoplay` dalam keadaan aktif.",
    },
    {
        name: "previous",
        categoryKey: "music",
        func: "Memutar kembali lagu sebelumnya dari sesi aktif atau riwayat lagu server.",
        usage: "/previous",
        params: "Tidak ada parameter",
        example: "/previous",
        permission: "Anggota di voice yang sama (DJ Role/Admin jika DJ Mode aktif)",
        limits: "Membutuhkan minimal 1 lagu pada riwayat sesi atau riwayat server (`/history`).",
    },
    {
        name: "stop",
        categoryKey: "music",
        func: "Menghentikan pemutaran lagu saat ini dan mengosongkan antrean tanpa memutus mode 24/7.",
        usage: "/stop",
        params: "Tidak ada parameter",
        example: "/stop",
        permission: "Anggota di voice yang sama (DJ Role/Admin jika DJ Mode aktif)",
        limits: "Hanya aktif saat ada lagu yang sedang diputar.",
    },
    {
        name: "join",
        categoryKey: "music",
        func: "Memanggil bot untuk masuk dan bersiap di voice channel Anda.",
        usage: "/join",
        params: "Tidak ada parameter",
        example: "/join",
        permission: "User: `Connect` • Bot: `Connect`, `Speak`",
        limits: "User harus berada di voice channel yang tidak penuh dan dapat diakses bot.",
    },
    {
        name: "leave",
        categoryKey: "music",
        func: "Memutus bot dari voice channel, menghapus antrean, dan menghentikan Auto-Reconnect hingga `/play` berikutnya.",
        usage: "/leave",
        params: "Tidak ada parameter",
        example: "/leave",
        permission: "Anggota di voice yang sama atau Admin (`Manage Server`)",
        limits: "Menonaktifkan sesi 24/7 aktif di server tersebut agar bot tidak masuk kembali sendiri.",
    },
    {
        name: "nowplaying",
        categoryKey: "music",
        func: "Menampilkan informasi lengkap lagu yang sedang diputar atau mengirim ulang dashboard kontrol interaktif.",
        usage: "/nowplaying [resend:<true|false>]",
        params: "Opsional: `resend` (`true` untuk mengirim ulang panel tombol ke channel teks)",
        example: "/nowplaying • /nowplaying resend:true",
        permission: "Semua anggota server",
        limits: "Hanya aktif ketika ada lagu yang sedang diputar di server.",
    },
    {
        name: "queue",
        categoryKey: "music",
        func: "Melihat daftar antrean lagu per halaman, memindahkan urutan lagu, atau melompat ke posisi antrean.",
        usage: "/queue [move_from:<no>] [move_to:<no>] [skipto:<no>]",
        params: "Opsional: `move_from` & `move_to` (pindah urutan), `skipto` (lompat ke nomor antrean)",
        example: "/queue • /queue move_from:4 move_to:1 • /queue skipto:2",
        permission: "Semua anggota untuk melihat; Voice sama + DJ Role untuk memodifikasi antrean",
        limits: "Nomor posisi harus berada dalam rentang jumlah antrean aktif.",
    },
    {
        name: "remove",
        categoryKey: "music",
        func: "Menghapus satu lagu tertentu dari daftar antrean berdasarkan nomor posisinya.",
        usage: "/remove position:<nomor_antrean>",
        params: "Wajib: `position` (angka >= 1)",
        example: "/remove position:2",
        permission: "Anggota di voice yang sama (DJ Role/Admin jika DJ Mode aktif)",
        limits: "Tidak menghapus lagu yang sedang diputar (gunakan `/skip` untuk lagu aktif).",
    },
    {
        name: "clear",
        categoryKey: "music",
        func: "Mengosongkan seluruh lagu berikutnya di dalam antrean (dengan konfirmasi aman).",
        usage: "/clear [force:<true|false>]",
        params: "Opsional: `force` (`true` untuk langsung hapus tanpa tombol konfirmasi)",
        example: "/clear • /clear force:true",
        permission: "Anggota di voice yang sama (DJ Role/Admin jika DJ Mode aktif)",
        limits: "Konfirmasi otomatis batal jika tidak ditekan dalam 30 detik.",
    },
    {
        name: "shuffle",
        categoryKey: "music",
        func: "Mengacak urutan lagu-lagu yang ada di dalam antrean.",
        usage: "/shuffle",
        params: "Tidak ada parameter",
        example: "/shuffle",
        permission: "Anggota di voice yang sama (DJ Role/Admin jika DJ Mode aktif)",
        limits: "Membutuhkan minimal 2 lagu di dalam daftar antrean.",
    },
    {
        name: "loop",
        categoryKey: "music",
        func: "Mengatur mode pengulangan pemutaran: mati (`off`), ulangi lagu (`song`), atau ulangi antrean (`queue`).",
        usage: "/loop mode:<off|song|queue>",
        params: "Wajib: `mode` (`off`, `song`, `queue`)",
        example: "/loop mode:song • /loop mode:queue",
        permission: "Anggota di voice yang sama (DJ Role/Admin jika DJ Mode aktif)",
        limits: "Status loop direset saat pemutaran dihentikan penuh.",
    },
    {
        name: "volume",
        categoryKey: "music",
        func: "Melihat atau mengubah volume suara pemutar musik serta opsional menyimpan volume bawaan server.",
        usage: "/volume [value:<angka>] [save_default:<true|false>]",
        params: "Opsional: `value` (persentase volume), `save_default` (simpan sebagai default server)",
        example: "/volume value:85 • /volume value:100 save_default:true",
        permission: "Voice sama (+ DJ Role jika DJ Mode aktif); `Manage Server` untuk `save_default`",
        limits: "Rentang volume dibatasi sesuai konfigurasi `MIN_VOLUME`–`MAX_VOLUME` (bawaan 1–100/150%).",
    },
    {
        name: "seek",
        categoryKey: "music",
        func: "Memajukan atau memundurkan posisi waktu lagu yang sedang diputar (dalam detik).",
        usage: "/seek time:<detik>",
        params: "Wajib: `time` (posisi tujuan dalam satuan detik)",
        example: "/seek time:90",
        permission: "Anggota di voice yang sama (DJ Role/Admin jika DJ Mode aktif)",
        limits: "Tidak dapat digunakan pada siaran langsung (LIVE stream) dan tidak boleh melebihi durasi lagu.",
    },
    {
        name: "lyrics",
        categoryKey: "music",
        func: "Mencari dan menampilkan lirik lagu yang sedang diputar atau berdasarkan judul lagu pilihan.",
        usage: "/lyrics [song:<judul_dan_artis>]",
        params: "Opsional: `song` (kosongkan untuk mengambil lirik lagu yang sedang diputar)",
        example: "/lyrics • /lyrics song:Hivi Remaja",
        permission: "Semua anggota server",
        limits: "Hasil lirik bergantung pada ketersediaan katalog LRCLIB/penyedia lirik publik.",
    },
    {
        name: "lyric",
        categoryKey: "music",
        func: "Alias cepat dari `/lyrics` untuk menampilkan lirik lagu aktif maupun pencarian judul lagu.",
        usage: "/lyric [song:<judul_dan_artis>]",
        params: "Opsional: `song` (judul lagu yang ingin dicari)",
        example: "/lyric • /lyric song:Hindia Secukupnya",
        permission: "Semua anggota server",
        limits: "Identik dengan `/lyrics`; otomatis membagi halaman jika lirik panjang.",
    },

    // =========================================================================
    // PLAYLIST (3 Commands: /playlist, /favorite, /history)
    // =========================================================================
    {
        name: "playlist",
        categoryKey: "playlist",
        func: "Mengelola dan memutar Playlist Pribadi (lintas server) maupun Playlist Server bersama.",
        usage: "/playlist <create|add|savequeue|load|view|list|remove|delete> ...",
        params: "Subcommand wajib (`create`, `add`, `savequeue`, `load`, `view`, `list`, `remove`, `delete`) + `name` & `scope` (`personal`/`server`)",
        example: "/playlist create name:Santai scope:personal • /playlist load name:Santai shuffle:true",
        permission: "Semua user untuk `personal` & `load`/`view`; `Manage Server`/DJ Role untuk ubah `server` playlist",
        limits: "Maks. 25 playlist per pemilik/server dan maks. 300 lagu per playlist.",
    },
    {
        name: "favorite",
        categoryKey: "playlist",
        func: "Menyimpan, melihat, menghapus, dan memutar daftar lagu favorit pribadi Anda di server mana pun.",
        usage: "/favorite <add|list|play|remove|clear> ...",
        params: "Subcommand wajib: `add [query]`, `list`, `play [position] [shuffle]`, `remove position:<no>`, `clear`",
        example: "/favorite add • /favorite list • /favorite play shuffle:true",
        permission: "Semua anggota server (`play` membutuhkan koneksi ke voice channel)",
        limits: "Maksimal 100 lagu favorit tersimpan per akun pengguna.",
    },
    {
        name: "history",
        categoryKey: "playlist",
        func: "Melihat daftar 50 lagu terakhir yang diputar di server atau memutar ulang lagu dari riwayat.",
        usage: "/history [play_index:<1-50>] [clear:<true|false>]",
        params: "Opsional: `play_index` (putar ulang nomor riwayat), `clear` (hapus riwayat server)",
        example: "/history • /history play_index:1",
        permission: "Semua anggota untuk melihat/putar; `Manage Server` atau DJ Role untuk `clear:true`",
        limits: "Menyimpan maksimal 50 riwayat lagu terbaru per server di MongoDB.",
    },

    // =========================================================================
    // MUSIC SETTINGS (5 Commands: /autoplay, /filter, /247, /dj, /musicconfig)
    // =========================================================================
    {
        name: "autoplay",
        categoryKey: "settings",
        func: "Mengaktifkan atau menonaktifkan pemutaran rekomendasi lagu serupa otomatis saat antrean habis.",
        usage: "/autoplay",
        params: "Tidak ada parameter (toggle aktif/nonaktif)",
        example: "/autoplay",
        permission: "Anggota di voice channel (DJ Role/Admin jika DJ Mode aktif)",
        limits: "Membutuhkan lagu terakhir sebagai referensi rekomendasi.",
    },
    {
        name: "filter",
        categoryKey: "settings",
        func: "Menerapkan filter efek suara real-time (Bassboost, Nightcore, Vaporwave, 8D, Equalizer, Karaoke, dll.).",
        usage: "/filter mode:<nama_filter|clear> [eq_preset:<flat|bass_boost|vocal|pop|rock|electronic>]",
        params: "Wajib: `mode` (16 preset + `clear`) • Opsional: `eq_preset` (khusus mode `equalizer`)",
        example: "/filter mode:bass • /filter mode:nightcore • /filter mode:clear",
        permission: "Anggota di voice yang sama (DJ Role/Admin jika DJ Mode aktif)",
        limits: "Memerlukan dukungan filter aktif pada server Lavalink; perubahan efek membutuhkan ~1–2 detik buffer.",
    },
    {
        name: "247",
        categoryKey: "settings",
        func: "Mengaktifkan/menonaktifkan mode 24/7 agar bot tetap berada di voice channel dan tersambung ulang otomatis.",
        usage: "/247",
        params: "Tidak ada parameter (toggle aktif/nonaktif)",
        example: "/247",
        permission: "`Manage Server` (`ManageGuild`)",
        limits: "Harus dijalankan saat bot dan pengguna berada di voice channel; dihentikan jika `/leave` dijalankan.",
    },
    {
        name: "dj",
        categoryKey: "settings",
        func: "Mengatur status DJ Mode dan menetapkan DJ Role yang berhak mengontrol pemutar musik di server.",
        usage: "/dj [mode:<enable|disable>] [role:@Role] [clear_role:<true|false>]",
        params: "Opsional: `mode` (`enable`/`disable`), `role` (Role DJ), `clear_role` (hapus DJ Role)",
        example: "/dj mode:enable role:@DJ • /dj mode:disable",
        permission: "`Manage Server` (`ManageGuild`)",
        limits: "Role `@everyone` ditolak otomatis demi keamanan kontrol server.",
    },
    {
        name: "musicconfig",
        categoryKey: "settings",
        func: "Panel konfigurasi lengkap musik server: DJ Mode, DJ Role, Auto-Leave, waktu tunggu keluar, dan Default Volume.",
        usage: "/musicconfig [dj_mode] [dj_role] [clear_dj_role] [auto_leave] [auto_leave_timeout] [default_volume]",
        params: "Semua opsional (panggil tanpa argumen untuk melihat konfigurasi aktif saat ini)",
        example: "/musicconfig auto_leave:enable auto_leave_timeout:120 default_volume:90",
        permission: "`Manage Server` (`ManageGuild`)",
        limits: "`auto_leave_timeout` 5–3600 detik; `@everyone` tidak diizinkan sebagai DJ Role.",
    },

    // =========================================================================
    // CUSTOM ROLE (2 Commands — also accessible under Settings/Custom Role)
    // =========================================================================
    {
        name: "customrole",
        categoryKey: "customrole",
        func: "Membuka dashboard interaktif anggota untuk membuat, mengubah nama, warna/gradasi, ikon, atau menghapus Custom Role.",
        usage: "/customrole",
        params: "Tidak ada parameter (interaksi penuh melalui tombol & modal pada panel)",
        example: "/customrole",
        permission: "Sesuai kebijakan server (Server Booster / Role Khusus / Semua Member yang diizinkan Admin)",
        limits: "Bot harus memiliki permission `Manage Roles` dengan posisi role bot di atas posisi Custom Role.",
    },
    {
        name: "customrole-config",
        categoryKey: "customrole",
        func: "Konfigurasi admin untuk panel otomatis Custom Role, syarat akses (Booster/Role tertentu), posisi anchor, & batas.",
        usage: "/customrole-config",
        params: "Tidak ada parameter (dashboard konfigurasi interaktif)",
        example: "/customrole-config",
        permission: "`Manage Server` atau `Administrator`",
        limits: "Membutuhkan permission `Manage Roles` pada bot agar pembuatan role berjalan normal.",
    },

    // =========================================================================
    // ADMIN, LOGS & UTILITIES (11 Commands)
    // =========================================================================
    {
        name: "voicelog",
        categoryKey: "admin",
        func: "Mengatur fitur pencatatan aktivitas keluar/masuk/pindah member di voice channel beserta zona waktu.",
        usage: "/voicelog [status:<enable|disable|reset>] [timezone:<IANA_Timezone>]",
        params: "Opsional: `status` (`enable`/`disable`/`reset`), `timezone` (mis. `Asia/Jakarta`)",
        example: "/voicelog status:enable timezone:Asia/Jakarta",
        permission: "`Manage Server` (`ManageGuild`)",
        limits: "Format timezone harus mengikuti standar IANA (contoh: `Asia/Jakarta`, `Asia/Makassar`, `Asia/Jayapura`).",
    },
    {
        name: "setlogs",
        categoryKey: "admin",
        func: "Menetapkan channel teks tujuan untuk mencatat aktivitas perubahan Server Tag anggota.",
        usage: "/setlogs channel:<#channel>",
        params: "Wajib: `channel` (Text Channel server)",
        example: "/setlogs channel:#server-tag-logs",
        permission: "`Manage Server` atau `Administrator`",
        limits: "Bot harus memiliki izin `View Channel`, `Send Messages`, dan `Embed Links` di channel tujuan.",
    },
    {
        name: "ceklogs",
        categoryKey: "admin",
        func: "Memeriksa status konfigurasi channel Server Tag Logger dan kesiapan intent di server ini.",
        usage: "/ceklogs",
        params: "Tidak ada parameter",
        example: "/ceklogs",
        permission: "`Manage Server` atau `Administrator` (atau pemeriksa konfigurasi)",
        limits: "Deteksi real-time optimal jika `SERVER MEMBERS INTENT` diaktifkan di Developer Portal.",
    },
    {
        name: "resetlogs",
        categoryKey: "admin",
        func: "Menonaktifkan dan menghapus konfigurasi channel log Server Tag pada server ini.",
        usage: "/resetlogs",
        params: "Tidak ada parameter",
        example: "/resetlogs",
        permission: "`Manage Server` atau `Administrator`",
        limits: "Hanya menghapus pengaturan channel log tanpa menghapus data statistik yang sudah tercatat.",
    },
    {
        name: "settagrole",
        categoryKey: "admin",
        func: "Memilih dan mengaktifkan pemberian role otomatis bagi member yang memasang Server Tag server ini.",
        usage: "/settagrole",
        params: "Tidak ada parameter (memilih role melalui menu interaktif)",
        example: "/settagrole",
        permission: "`Manage Server` atau `Administrator`",
        limits: "Role yang dipilih harus berada di bawah hirarki role tertinggi milik bot dan bukan role managed/bot.",
    },
    {
        name: "cektagrole",
        categoryKey: "admin",
        func: "Melihat status konfigurasi Server Tag Auto Role serta kesehatan izin role pada server ini.",
        usage: "/cektagrole",
        params: "Tidak ada parameter",
        example: "/cektagrole",
        permission: "Semua anggota / Admin server",
        limits: "Menampilkan peringatan otomatis jika hirarki role bot berubah di bawah role target.",
    },
    {
        name: "resettagrole",
        categoryKey: "admin",
        func: "Menghapus konfigurasi Server Tag Auto Role sehingga bot berhenti memberi/mencabut role otomatis.",
        usage: "/resettagrole",
        params: "Tidak ada parameter",
        example: "/resettagrole",
        permission: "`Manage Server` atau `Administrator`",
        limits: "Hanya dapat dijalankan oleh administrator/pengelola server.",
    },
    {
        name: "synctagrole",
        categoryKey: "admin",
        func: "Memindai seluruh anggota server dan menyinkronkan pemberian/pencabutan role sesuai pemakaian Server Tag.",
        usage: "/synctagrole",
        params: "Tidak ada parameter",
        example: "/synctagrole",
        permission: "`Manage Server` atau `Administrator`",
        limits: "Membutuhkan konfigurasi `/settagrole` yang sudah aktif terlebih dahulu.",
    },
    {
        name: "tagstats",
        categoryKey: "admin",
        func: "Melihat statistik jumlah pengguna Server Tag di server ini atau riwayat tag spesifik seorang member.",
        usage: "/tagstats [member:@User]",
        params: "Opsional: `member` (mention/pilih anggota tertentu)",
        example: "/tagstats • /tagstats member:@User",
        permission: "Semua anggota server",
        limits: "Menampilkan data yang telah teramati dan tersimpan di database server.",
    },
    {
        name: "ping",
        categoryKey: "admin",
        func: "Memeriksa latensi koneksi WebSocket bot ke Discord Gateway.",
        usage: "/ping",
        params: "Tidak ada parameter",
        example: "/ping",
        permission: "Semua anggota server",
        limits: "Tidak ada batasan.",
    },
    {
        name: "help",
        categoryKey: "admin",
        func: "Membuka pusat bantuan interaktif lengkap beserta detail seluruh slash command yang tersedia.",
        usage: "/help [command:<nama_command>]",
        params: "Opsional: `command` (lihat dokumentasi spesifik satu perintah secara langsung)",
        example: "/help • /help command:play",
        permission: "Semua anggota server",
        limits: "Navigasi tombol/menu aktif selama 5 menit per sesi pesan bantuan.",
    },
];

function buildFallbackDocFromCommand(cmd) {
    const opts = Array.isArray(cmd.options) ? cmd.options : [];
    const usageParts = opts.map((o) => (o.required ? `${o.name}:<value>` : `[${o.name}]`)).join(" ");
    const reqOpts = opts.filter((o) => o.required).map((o) => `\`${o.name}\``);
    const optOpts = opts.filter((o) => !o.required).map((o) => `\`${o.name}\``);
    const paramsText =
        !reqOpts.length && !optOpts.length
            ? "Tidak ada parameter"
            : [reqOpts.length ? `Wajib: ${reqOpts.join(", ")}` : null, optOpts.length ? `Opsional: ${optOpts.join(", ")}` : null]
                  .filter(Boolean)
                  .join(" • ");

    const userPerms = cmd.permissions?.user?.length ? cmd.permissions.user.map((p) => `\`${p}\``).join(", ") : "Semua anggota";
    const categoryKey = cmd.category === "music" ? "music" : cmd.category === "setting" ? "settings" : "admin";

    return {
        name: cmd.name,
        categoryKey,
        func: cmd.description || "Menjalankan perintah bot.",
        usage: `/${cmd.name}${usageParts ? ` ${usageParts}` : ""}`,
        params: paramsText,
        example: `/${cmd.name}`,
        permission: userPerms,
        limits: cmd.settings?.voice ? "Pengguna harus berada di voice channel." : "Sesuai izin channel server.",
    };
}

/**
 * Returns the verified list of command documentation entries matching `client.slash`
 * so `/help` never displays non-existent commands and never omits a registered command.
 */
function getVerifiedCommandDocs(client) {
    const registeredMap = client?.slash && typeof client.slash.has === "function" && client.slash.size > 0 ? client.slash : null;

    if (!registeredMap) {
        return [...COMMAND_DOCS];
    }

    const docs = [];
    const seen = new Set();

    for (const entry of COMMAND_DOCS) {
        if (registeredMap.has(entry.name)) {
            docs.push(entry);
            seen.add(entry.name);
        }
    }

    for (const [name, cmd] of registeredMap.entries()) {
        if (!seen.has(name)) {
            docs.push(buildFallbackDocFromCommand(cmd));
            seen.add(name);
        }
    }

    return docs;
}

function getDocsForSection(allDocs, sectionKey) {
    if (sectionKey === "settings") {
        // Group Music Settings + Custom Role under the [Settings] quick button while keeping Custom Role selectable too
        return allDocs.filter((d) => d.categoryKey === "settings" || d.categoryKey === "customrole");
    }
    if (sectionKey === "music_settings_only") {
        return allDocs.filter((d) => d.categoryKey === "settings");
    }
    return allDocs.filter((d) => d.categoryKey === sectionKey);
}

function formatCommandField(doc) {
    return {
        name: `\`/${doc.name}\``,
        value: [
            `• **Fungsi:** ${doc.func}`,
            `• **Cara Pakai:** \`${doc.usage}\``,
            `• **Parameter:** ${doc.params}`,
            `• **Contoh:** \`${doc.example}\``,
            `• **Permission:** ${doc.permission}`,
            `• **Batasan:** ${doc.limits}`,
        ]
            .join("\n")
            .slice(0, 1024),
        inline: false,
    };
}

module.exports = {
    HELP_CATEGORIES,
    COMMAND_DOCS,
    getVerifiedCommandDocs,
    getDocsForSection,
    formatCommandField,
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
