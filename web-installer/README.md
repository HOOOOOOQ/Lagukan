# LAGUKAN INSTALLER — Official Web Installer & Central Cloud Database Gateway

> **Tagline:** _Your Music Bot, One Step Away._  
> **Repository Bot Resmi:** [https://github.com/HOOOOOOQ/Lagukan](https://github.com/HOOOOOOQ/Lagukan)

Website resmi untuk menginstal, mengonfigurasi, dan memantau Discord Music Bot **Lagukan** di **Android Termux** dengan satu perintah, terhubung secara aman ke **MongoDB Atlas pusat** milik pemilik project tanpa pernah mengekspos kredensial database kepada pengguna.

---

## 1. Arsitektur Keamanan & Isolasi Database Pusat

Hasil audit arsitektur **Lagukan** menunjukkan bahwa bot menggunakan **21 koleksi Mongoose** (`guild`, `user`, `playlist`, `UserMusicProfiles`, `ListeningHistory`, `FavoriteTracks`, `UserPlaylists`, `MusicStatistics`, `MusicWrapped`, `MusicLeaderboard`, `MusicRequestConfig`, `DJConfig`, `MusicParty`, `GuessTheSong`, `MusicBattle`, `PremiumConfig`, `customRole`, `customRoleConfig`, `serverTagConfig`, `serverTagMember`, `serverTagAutoRole`).

Agar pemilik project memegang kendali penuh atas database pusat:

1. **`MONGO_URI` Hanya Berada di Server Backend**:
    - Variabel `MONGO_URI` disimpan eksklusif di environment server backend (`web-installer/.env` atau Environment Variables Vercel/VPS).
    - Tidak pernah dikirim ke frontend, tidak ada di dalam `/install.sh`, dan tidak pernah ditulis ke file `.env` Termux milik pengguna.
2. **Isolasi Penuh Antarinstalasi (`installationId`)**:
    - Setiap pengguna installer memperoleh `LAGUKAN_INSTALL_ID` (`lgk_inst_...`) dan `LAGUKAN_API_KEY` (`lgk_sk_...`) yang di-hash satu arah menggunakan `crypto.scryptSync` + salt acak.
    - Seluruh operasi CRUD dari bot Termux melalui adapter `src/databases/cloudAdapter.js` dikirim ke endpoint terautentikasi `POST /api/v1/db/:model/:operation`.
    - Backend membuang properti `installationId` kiriman klien dan menyuntikkan `installationId` terverifikasi secara paksa ke setiap filter, update, dan dokumen (`cloud_<model>`), sehingga data server Discord pengguna **mustahil saling tercampur**.
3. **Perlindungan Berlapis**:
    - **Blokir Kredensial pada URL**: Middleware menolak otomatis setiap permintaan yang menaruh `token`, `apiKey`, `mongoUri`, atau pola Discord Bot Token di query/path URL.
    - **Validasi Discord Token Tanpa Penyimpanan**: Endpoint `POST /api/v1/verify-token` memeriksa struktur Snowflake & kriptografi token (serta verifikasi live ke Discord API `/users/@me`) tanpa pernah mencatat token di log maupun menyimpannya ke database. Di Termux, token hanya disimpan lokal di `~/Lagukan/.env` dengan permission ketat `chmod 600`.
    - **Sanitasi Query & Allowlist Model**: Memblokir operator berbahaya (`$where`, `$function`, `$accumulator`, `$expr`, `$lookup`, `$out`, `$merge`, prototype pollution) dan hanya mengizinkan 21 model resmi Lagukan.
    - **Autentikasi Dashboard `HttpOnly` + Rate Limit**: Sesi dashboard ditandatangani dengan `HMAC-SHA256`, disimpan pada cookie `HttpOnly`, dan memblokir percobaan akses silang antar-`installationId` (`403 Forbidden`). Tidak ada endpoint eksekusi shell di server.
    - **Kompatibilitas Mundur 100%**: Pemilik/pengguna VPS yang tetap mengisi `MONGO_URI` langsung pada bot tetap terhubung langsung ke Mongoose seperti semula.

---

## 2. Struktur Folder `web-installer/`

```text
web-installer/
├── api/
│   └── index.js               # Entry Serverless Function untuk deployment Vercel
├── scripts/
│   └── termux-install.sh      # Salinan referensi script instalasi Termux
├── server/
│   ├── index.js               # Entry HTTP server produksi (bind 0.0.0.0)
│   ├── app.js                 # Express router, CSP/security headers, rate limit, auth, & static SPA
│   ├── centralDb.js           # Manajer koneksi MongoDB Atlas pusat & isolasi 21 koleksi tenant
│   ├── security.js            # Scrypt API key, HMAC session, sanitasi query, redaksi rahasia
│   ├── discordVerifier.js     # Validator aman Discord Bot Token (POST body only)
│   └── installScriptGen.js    # Generator dinamis /install.sh sesuai domain publik aktif
├── src/
│   ├── App.jsx                # Navigasi responsif mobile (Black & Purple Dark UI)
│   ├── api.js                 # Client fetch relatif (/api/v1/...)
│   ├── styles.css             # Tema dark mode hitam-ungu & animasi ringan
│   └── pages/
│       ├── HomePage.jsx       # Halaman Utama + Status Layanan Real-Time
│       ├── InstallPage.jsx    # Wizard Instalasi 8 Tahap + Validator Token + Tes API
│       ├── DashboardPage.jsx  # Dashboard Pengguna Terautentikasi
│       └── DocsPage.jsx       # Dokumentasi Lengkap Termux & Troubleshooting
├── .env.example               # Template konfigurasi server backend
├── vercel.json                # Konfigurasi routing & build Vercel
├── vite.config.js             # Konfigurasi build Vite (outDir: public-build)
└── package.json
```

---

## 3. Cara Menjalankan Website Secara Lokal / VPS

1. Masuk ke folder `web-installer` dan instal dependencies:

    ```bash
    cd web-installer
    npm install
    ```

2. Buat file `.env` dari template `.env.example`:

    ```bash
    cp .env.example .env
    ```

    Isi variabel berikut pada `web-installer/.env`:
    - `MONGO_URI` — Connection string **MongoDB Atlas** pusat milik pemilik project.
    - `SESSION_SECRET` — String acak minimal 32 karakter (contoh: `openssl rand -hex 32`).
    - `PORT` — Port server (default `3000`).
    - `PUBLIC_BASE_URL` — Opsional, domain HTTPS publik website Anda (misal `https://installer.lagukan.my.id`; jika dikosongkan otomatis membaca header HTTPS request).

3. Jalankan build frontend produksi lalu nyalakan server:
    ```bash
    npm run build
    npm start
    ```
    Server akan berjalan pada `http://0.0.0.0:3000` (menyajikan seluruh halaman `/`, `/install`, `/dashboard`, `/docs`, script `/install.sh`, dan seluruh endpoint `/api/v1/*`).

---

## 4. Cara Deploy ke Vercel

1. Buka dashboard **Vercel** → **Add New Project** → pilih repository `HOOOOOOQ/Lagukan`.
2. Pada bagian **Root Directory**, ubah ke:
    ```text
    web-installer
    ```
3. Tambahkan **Environment Variables** di Vercel (Settings → Environment Variables):
    - `MONGO_URI` = `mongodb+srv://...` _(MongoDB Atlas pusat milik Anda)_
    - `SESSION_SECRET` = `<64-hex-random-secret>`
    - `LAGUKAN_BOT_VERSION` = `3.1.0`
    - `LAGUKAN_SUPPORT_URL` = `https://discord.gg/kNdSkHchzH`
4. Klik **Deploy** (`vercel.json` otomatis menjalankan `npm run build`, memetakan `/api/*` serta `/install.sh` ke Serverless Function `api/index.js`, dan mengarahkan halaman SPA ke `public-build`).
5. Pastikan di **MongoDB Atlas → Network Access**, IP akses untuk fungsi serverless Vercel telah diizinkan (`0.0.0.0/0` dengan autentikasi database user kuat yang hanya memiliki hak baca/tulis pada database `lagukan_central`, bukan hak `atlasAdmin`).

---

## 5. Cara Pengguna Menginstal Bot di Termux

Pengguna cukup membuka website installer, menyalin satu perintah berikut di Termux Android:

```bash
curl -fsSL https://<domain-installer-anda>/install.sh | bash
```

Lalu menyalakan bot:

```bash
cd ~/Lagukan && npm run start:termux
```
