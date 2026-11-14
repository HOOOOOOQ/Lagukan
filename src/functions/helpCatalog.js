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
        title: "🎵 Kategori: MUSIC (Pemutar, Radio, Sleep & Party)",
        emoji: "🎵",
        description: "Perintah pemutaran lagu multi-platform, Radio Mode, Sleep Timer, Music Party, antrean, volume, & lirik.",
    },
    playlist: {
        id: "playlist",
        label: "Playlist",
        title: "📂 Kategori: PLAYLIST, FAVORITE & HISTORY",
        emoji: "📂",
        description: "Manajemen playlist pribadi lintas server (buat, ganti nama, tambah, hapus, putar), lagu favorit, & riwayat.",
    },
    profile: {
        id: "profile",
        label: "Personal Profile",
        title: "👤 Kategori: PERSONAL PROFILE, WRAPPED & LEADERBOARD",
        emoji: "👤",
        description: "Kartu profil musik (`/musicprofile`), Listener Level & XP (`/musicrank`), `/wrapped`, & `/musicleaderboard`.",
    },
    settings: {
        id: "settings",
        label: "Server Settings",
        title: "⚙️ Kategori: SERVER SETTINGS & REQUEST PANEL",
        emoji: "⚙️",
        description: "Voice Channel Music Request (`/musicrequest-config`), Smart Autoplay, Filter Audio, 24/7, & Music Config.",
    },
    dj: {
        id: "dj",
        label: "DJ System",
        title: "🎧 Kategori: DJ SYSTEM",
        emoji: "🎧",
        description: "Kontrol hak akses pemutar musik server berbasis Role ID menggunakan `/dj` dan `/musicconfig`.",
    },
    games: {
        id: "games",
        label: "Music Games",
        title: "🎮 Kategori: MUSIC GAMES",
        emoji: "🎮",
        description: "Mini-game musik interaktif di server: tebak potongan lagu (`/guessthesong`) dan adu lagu voting (`/musicbattle`).",
    },
    premium: {
        id: "premium",
        label: "Premium",
        title: "💎 Kategori: PREMIUM SYSTEM",
        emoji: "💎",
        description: "Status akses Premium terverifikasi, kuota ekstra playlist/favorit/wrapped, & kustomisasi tema dashboard server.",
    },
    admin: {
        id: "admin",
        label: "Admin",
        title: "🛡️ Kategori: ADMIN, LOGS & UTILITAS",
        emoji: "🛡️",
        description: "Konfigurasi Voice Activity Logger (`/voicelog`), pengecekan latensi (`/ping`), & bantuan sistem (`/help`).",
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
    {
        name: "sleep",
        categoryKey: "music",
        func: "Mengatur Sleep Timer tunggal per server (15m, 30m, 45m, 60m, atau kustom) untuk menghentikan musik otomatis.",
        usage: "/sleep preset:<15|30|45|60|custom|status|cancel> [custom_minutes] [leave_voice] [clear_queue]",
        params: "Wajib: `preset` • Opsional: `custom_minutes` (1-720), `leave_voice`, `clear_queue`",
        example: "/sleep preset:30 • /sleep preset:custom custom_minutes:90 leave_voice:true",
        permission: "Anggota di voice yang sama (DJ Role/Admin jika DJ Mode aktif)",
        limits: "Hanya 1 timer aktif per server (timer baru menggantikan timer lama secara aman).",
    },
    {
        name: "radio",
        categoryKey: "music",
        func: "Menyalakan Radio Mode (stasiun genre berkelanjutan) atau Auto DJ pintar tanpa pengulangan lagu.",
        usage: "/radio <station|autodj|custom|status|stop> ...",
        params: "Subcommand wajib: `station genre:<pilihan>`, `autodj`, `custom query:<tema>`, `status`, atau `stop`",
        example: "/radio station genre:indonesian_pop • /radio autodj • /radio stop",
        permission: "Anggota di voice channel (DJ Role/Admin jika DJ Mode aktif)",
        limits: "Memverifikasi source audio yang valid sebelum antrean dan mencegah duplikasi 30 lagu terakhir.",
    },
    {
        name: "musicparty",
        categoryKey: "music",
        func: "Membuat dan mengelola sesi mendengarkan bersama (Music Party) lengkap dengan Party Host & Vote Skip di server ini.",
        usage: "/musicparty <create|join|leave|queue|host|transfer|voteskip|close> ...",
        params: "Subcommand wajib (`create [name]`, `join`, `leave`, `queue`, `host`, `transfer user:@User`, `voteskip`, `close`)",
        example: "/musicparty create name:Malam Minggu • /musicparty voteskip",
        permission: "Anggota di voice channel yang sama; `transfer`/`close` khusus Party Host atau Admin",
        limits: "Berjalan dalam 1 voice channel server aktif (sesuai arsitektur single-guild voice Discord).",
    },

    // =========================================================================
    // PLAYLIST (3 Commands: /playlist, /favorite, /history)
    // =========================================================================
    {
        name: "playlist",
        categoryKey: "playlist",
        func: "Mengelola dan memutar Playlist Pribadi (lintas server) maupun Playlist Server bersama (termasuk ganti nama).",
        usage: "/playlist <create|rename|add|play|load|savequeue|view|list|remove|delete> ...",
        params: "Subcommand wajib (`create`, `rename`, `add`, `play`, `load`, `savequeue`, `view`, `list`, `remove`, `delete`) + `name` & `scope`",
        example: "/playlist create name:Santai • /playlist rename name:Santai new_name:Fokus • /playlist play name:Fokus",
        permission: "Semua user untuk `personal`; `Manage Server`/DJ Role untuk modifikasi `server` playlist",
        limits: "Kuota standar 25 playlist & 300 lagu/playlist (otomatis meningkat hingga 200 playlist untuk akun Premium).",
    },
    {
        name: "favorite",
        categoryKey: "playlist",
        func: "Menyimpan, melihat, menghapus, dan memutar daftar lagu favorit pribadi Anda di server mana pun.",
        usage: "/favorite <add|list|play|remove|clear> ...",
        params: "Subcommand wajib: `add [query]`, `list`, `play [position] [shuffle]`, `remove position:<no>`, `clear`",
        example: "/favorite add • /favorite list • /favorite play shuffle:true",
        permission: "Semua anggota server (`play` membutuhkan koneksi ke voice channel)",
        limits: "Kuota standar 100 lagu favorit per akun (hingga 1.000 lagu untuk akun Premium).",
    },
    {
        name: "history",
        categoryKey: "playlist",
        func: "Melihat riwayat mendengarkan Personal kamu maupun Recently Played Server serta memutar ulang lagu.",
        usage: "/history [scope:<personal|server>] [play_index:<1-50>] [clear:<true|false>]",
        params: "Opsional: `scope` (`personal`/`server`), `play_index` (putar ulang nomor riwayat), `clear` (hapus riwayat server)",
        example: "/history scope:personal • /history play_index:1",
        permission: "Semua anggota untuk melihat/putar; `Manage Server` untuk `clear:true`",
        limits: "Riwayat personal mencatat durasi dengar nyata yang disimpan di MongoDB.",
    },

    // =========================================================================
    // PERSONAL PROFILE, WRAPPED & LEADERBOARD (4 Slash Commands)
    // =========================================================================
    {
        name: "musicprofile",
        categoryKey: "profile",
        func: "Menampilkan Kartu Profil Musik Lagukan lengkap (Level, XP, Waktu Dengar, Top Lagu/Artis, & 5 tombol interaktif).",
        usage: "/musicprofile [user:@User]",
        params: "Opsional: `user` (anggota yang ingin dilihat profil musiknya)",
        example: "/musicprofile • /musicprofile user:@Teman",
        permission: "Semua anggota server",
        limits: "Data dihitung murni dari pemutaran lagu nyata; profil member lain bersifat read-only.",
    },
    {
        name: "musicrank",
        categoryKey: "profile",
        func: "Melihat Listener Level, progres bar Music XP menuju level berikutnya, dan peringkat pendengar di server.",
        usage: "/musicrank [user:@User]",
        params: "Opsional: `user` (kosongkan untuk melihat level & rank milik sendiri)",
        example: "/musicrank • /musicrank user:@Teman",
        permission: "Semua anggota server",
        limits: "XP hanya diperoleh dari lagu yang benar-benar diputar (dilengkapi anti-farming lagu berulang).",
    },
    {
        name: "wrapped",
        categoryKey: "profile",
        func: "Menampilkan ringkasan Music Wrapped personal berhalaman (Top Lagu, Top Artis, Genre, Hari & Jam Teraktif).",
        usage: "/wrapped [period:<alltime|weekly|monthly>] [user:@User]",
        params: "Opsional: `period` (`alltime`, `weekly`, `monthly`), `user`",
        example: "/wrapped • /wrapped period:weekly • /wrapped period:monthly",
        permission: "Semua anggota server",
        limits: "Menampilkan pemberitahuan jujur apabila riwayat pemutaran pada periode tersebut masih kosong.",
    },
    {
        name: "musicleaderboard",
        categoryKey: "profile",
        func: "Menampilkan 6 papan peringkat musik khusus server ini (Active Listener, Listening Time, Top Songs, Top Artists, Weekly, Monthly).",
        usage: "/musicleaderboard [mode:<active|songs|artists|time|weekly|monthly>]",
        params: "Opsional: `mode` (juga dapat diganti langsung lewat dropdown interaktif)",
        example: "/musicleaderboard • /musicleaderboard mode:weekly",
        permission: "Semua anggota server",
        limits: "Peringkat diisolasi khusus aktivitas nyata di masing-masing server (`guildId`).",
    },

    // =========================================================================
    // SERVER SETTINGS & DJ SYSTEM
    // =========================================================================
    {
        name: "musicrequest-config",
        categoryKey: "settings",
        func: "Mengatur channel khusus Voice Channel Music Request Panel agar member bisa request lagu tanpa `/play`.",
        usage: "/musicrequest-config <setup|settings|refresh|disable> ...",
        params: "Subcommand wajib: `setup channel:#ch [cooldown] [max_queue] [links_only]`, `settings`, `refresh`, `disable`",
        example: "/musicrequest-config setup channel:#request-musik cooldown:10 max_queue:5",
        permission: "`Manage Server` (`ManageGuild`)",
        limits: "Dilengkapi validasi voice channel, cooldown per user, batas antrean per user, & filter link aman.",
    },
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
        name: "profile-notification",
        categoryKey: "settings",
        func: "Mengonfigurasi channel notifikasi profil & achievement per Voice Channel (mendukung chat Voice Channel langsung atau text channel khusus).",
        usage: "/profile-notification <setup|set-channel|disable> ...",
        params: "`setup` (`voice_channel`, `[fallback_channel]`), `set-channel` (`voice_channel`, `text_channel`), `disable` (`voice_channel`)",
        example: "/profile-notification set-channel voice_channel:#Voice-1 text_channel:#chat-voice-1",
        permission: "`Manage Server` (`ManageGuild`)",
        limits: "Terisolasi per Application ID, Guild ID, dan Voice Channel ID; tidak pernah mengirim ke channel acak.",
    },
    {
        name: "profile",
        categoryKey: "profile",
        func: "Menampilkan kartu 666 User Music Profile (Avatar, Username, User ID, Total Play, Total Hours, Favorite Song, Join Server, Rank & Badge Music Lover).",
        usage: "/profile [user:@User]",
        params: "Opsional: `user` (anggota server yang ingin dilihat profilnya)",
        example: "/profile • /profile user:@User",
        permission: "Semua anggota server",
        limits: "Durasi mendengarkan dihitung murni dari waktu pemutaran aktif (waktu pause dan antrian tidak dihitung).",
    },
    {
        name: "leaderboard",
        categoryKey: "profile",
        func: "Menampilkan Top 10 pengguna paling aktif mendengarkan musik di server ini lengkap dengan kartu visual 666 & paginasi.",
        usage: "/leaderboard",
        params: "Tidak ada parameter (gunakan tombol navigasi untuk berpindah halaman)",
        example: "/leaderboard",
        permission: "Semua anggota server",
        limits: "Dipisahkan ketat per Guild ID dan di-cache untuk efisiensi database.",
    },
    {
        name: "dj",
        categoryKey: "dj",
        func: "Mengatur status DJ Mode dan menetapkan DJ Role berdasarkan Role ID server untuk membatasi kontrol pemutar.",
        usage: "/dj [mode:<enable|disable>] [role:@Role] [clear_role:<true|false>]",
        params: "Opsional: `mode` (`enable`/`disable`), `role` (Role DJ), `clear_role` (hapus DJ Role)",
        example: "/dj mode:enable role:@DJ • /dj mode:disable",
        permission: "`Manage Server` (`ManageGuild`)",
        limits: "Diverifikasi ketat menggunakan Role ID & `guildId` (bukan nama role); member biasa tetap dapat request lagu.",
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
    // MUSIC GAMES (2 Commands: /guessthesong, /musicbattle)
    // =========================================================================
    {
        name: "guessthesong",
        categoryKey: "games",
        func: "Memulai mini-game tebak judul lagu dari potongan audio di voice channel dengan 3 tingkat kesulitan & skor.",
        usage: "/guessthesong <start|stop|leaderboard> [difficulty:<easy|medium|hard>]",
        params: "Subcommand wajib: `start [difficulty]`, `stop`, atau `leaderboard`",
        example: "/guessthesong start difficulty:medium • /guessthesong leaderboard",
        permission: "Anggota di voice channel untuk `start`; semua anggota untuk `leaderboard`",
        limits: "Judul lagu disembunyikan rapat dari Now Playing Dashboard hingga ronde berakhir.",
    },
    {
        name: "musicbattle",
        categoryKey: "games",
        func: "Pertandingan adu lagu pilihan antara 2 anggota server dengan voting tombol anti-duplikat & leaderboard.",
        usage: "/musicbattle <start|stats|leaderboard> ...",
        params: "Subcommand wajib: `start opponent:@User [your_song] [opponent_song] [vote_seconds]`, `stats`, `leaderboard`",
        example: "/musicbattle start opponent:@Teman your_song:Hivi Remaja vote_seconds:45",
        permission: "Semua anggota server",
        limits: "Setiap anggota server hanya dihitung maksimal 1 suara per battle (anti double-vote).",
    },

    // =========================================================================
    // PREMIUM SYSTEM (1 Command: /premium)
    // =========================================================================
    {
        name: "premium",
        categoryKey: "premium",
        func: "Melihat status & kuota akses Premium terverifikasi, kustomisasi warna/judul dashboard server, & kelola akses.",
        usage: "/premium <status|customize|grant|revoke> ...",
        params: "Subcommand wajib: `status`, `customize [accent_color] [dashboard_title]`, `grant` (Dev), `revoke` (Dev)",
        example: "/premium status • /premium customize accent_color:#00E5FF dashboard_title:Lagukan VIP",
        permission: "Semua anggota untuk `status`; `Manage Server` untuk `customize`; Owner/Dev Bot untuk `grant`/`revoke`",
        limits: "Dikelola secara resmi oleh Admin/Developer Bot tanpa klaim atau pembayaran otomatis palsu.",
    },

    // =========================================================================
    // ADMIN, LOGS & UTILITIES (3 Commands)
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
    if (sectionKey === "settings" || sectionKey === "music_settings_only") {
        return allDocs.filter((d) => d.categoryKey === "settings");
    }
    return allDocs.filter((d) => d.categoryKey === sectionKey);
}

function formatCommandField(doc) {
    const label = `\`/${doc.name}\``;
    return {
        name: label,
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
