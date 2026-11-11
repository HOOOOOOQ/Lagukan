function sanitizeBaseUrl(url) {
    const cleaned = String(url || "")
        .trim()
        .replace(/\/+$/, "");
    if (!/^https?:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/.test(cleaned)) {
        return "https://lagukan-installer.example.com";
    }
    return cleaned;
}

function generateTermuxInstallScript({ baseUrl, repoUrl = "https://github.com/HOOOOOOQ/Lagukan.git", botVersion = "3.1.0" }) {
    const safeApiUrl = sanitizeBaseUrl(baseUrl);
    const safeRepoUrl = String(repoUrl || "https://github.com/HOOOOOOQ/Lagukan.git").replace(/[^a-zA-Z0-9:/._-]/g, "");
    const safeVersion = String(botVersion || "3.1.0").replace(/[^a-zA-Z0-9._-]/g, "");

    return `#!/usr/bin/env bash
# ==============================================================================
# LAGUKAN INSTALLER — Official Termux Android Setup Script (v${safeVersion})
# Tagline   : Your Music Bot, One Step Away.
# Repository: ${safeRepoUrl}
# Security  : Zero MongoDB URI embedded. Scoped Cloud Gateway Auth + chmod 600.
# ==============================================================================

set -euo pipefail

API_BASE_URL="\${LAGUKAN_API_URL_OVERRIDE:-${safeApiUrl}}"
REPO_URL="${safeRepoUrl}"
TARGET_DIR="\${LAGUKAN_TARGET_DIR:-\$HOME/Lagukan}"
SELF_TEST_MODE="\${LAGUKAN_SELF_TEST:-0}"

# ANSI Colors (Black & Purple Theme)
C_RESET="\\033[0m"
C_PURPLE="\\033[1;35m"
C_CYAN="\\033[1;36m"
C_GREEN="\\033[1;32m"
C_YELLOW="\\033[1;33m"
C_RED="\\033[1;31m"
C_DIM="\\033[2m"

banner() {
  printf "\\n\${C_PURPLE}╔══════════════════════════════════════════════════════════════╗\${C_RESET}\\n"
  printf "\${C_PURPLE}║             🎵  L A G U K A N   I N S T A L L E R            ║\${C_RESET}\\n"
  printf "\${C_PURPLE}║              Your Music Bot, One Step Away.                  ║\${C_RESET}\\n"
  printf "\${C_PURPLE}╚══════════════════════════════════════════════════════════════╝\${C_RESET}\\n\\n"
}

info()  { printf "\${C_CYAN}[INFO]\${C_RESET} %s\\n" "$1"; }
ok()    { printf "\${C_GREEN}[OK]\${C_RESET}   %s\\n" "$1"; }
warn()  { printf "\${C_YELLOW}[WARN]\${C_RESET} %s\\n" "$1"; }
fail()  { printf "\${C_RED}[ERR]\${C_RESET}  %s\\n" "$1" >&2; exit 1; }

read_tty() {
  local prompt_text="$1"
  local var_name="$2"
  local secret_mode="\${3:-0}"
  local input_val=""

  if [ "\$SELF_TEST_MODE" = "1" ]; then
    eval "\$var_name=\"\${4:-}\""
    return 0
  fi

  if [ -r /dev/tty ]; then
    if [ "\$secret_mode" = "1" ]; then
      read -r -s -p "\$prompt_text" input_val < /dev/tty
      printf "\\n" > /dev/tty
    else
      read -r -p "\$prompt_text" input_val < /dev/tty
    fi
  else
    if [ "\$secret_mode" = "1" ]; then
      read -r -s -p "\$prompt_text" input_val
      printf "\\n"
    else
      read -r -p "\$prompt_text" input_val
    fi
  fi

  eval "\$var_name=\\"\$input_val\\""
}

report_stage() {
  local stage_key="$1"
  if [ -n "\${INST_ID:-}" ] && [ -n "\${INST_KEY:-}" ]; then
    curl -fsSL -X POST "\$API_BASE_URL/api/v1/installations/stage" \\
      -H "Content-Type: application/json" \\
      -H "Authorization: Bearer \$INST_KEY" \\
      -H "X-Lagukan-Installation-Id: \$INST_ID" \\
      -d "{\\"stage\\":\\"\$stage_key\\"}" >/dev/null 2>&1 || true
  fi
}

banner

# ------------------------------------------------------------------------------
# TAHAP 1: Pemeriksaan Lingkungan Termux / Sistem
# ------------------------------------------------------------------------------
info "[1/9] Memeriksa lingkungan sistem & Termux..."
IS_TERMUX=0
if [ -n "\${TERMUX_VERSION:-}" ] || ( [ -n "\${PREFIX:-}" ] && printf "%s" "\$PREFIX" | grep -q "com.termux" ); then
  IS_TERMUX=1
  ok "Lingkungan Android Termux terdeteksi (\${TERMUX_VERSION:-Termux})."
else
  warn "Bukan lingkungan Android Termux murni ($(uname -s)/$(uname -m)). Melanjutkan dalam mode kompatibilitas POSIX."
fi

# ------------------------------------------------------------------------------
# TAHAP 2: Pemeriksaan & Instalasi Kebutuhan Sistem (Node.js, Git, FFmpeg, Java)
# ------------------------------------------------------------------------------
info "[2/9] Memeriksa paket sistem (Node.js >= 18, Git, FFmpeg, Curl, Java opsional)..."

install_termux_pkg_if_missing() {
  local bin_name="$1"
  local pkg_name="$2"
  if ! command -v "\$bin_name" >/dev/null 2>&1; then
    if [ "\$IS_TERMUX" = "1" ] && command -v pkg >/dev/null 2>&1; then
      info "Menginstal paket Termux: \$pkg_name ..."
      pkg update -y && pkg install -y "\$pkg_name"
    else
      fail "Perintah '\$bin_name' belum terpasang. Silakan instal paket '\$pkg_name' terlebih dahulu."
    fi
  fi
}

install_termux_pkg_if_missing "curl" "curl"
install_termux_pkg_if_missing "git" "git"
install_termux_pkg_if_missing "node" "nodejs-lts"

if ! command -v ffmpeg >/dev/null 2>&1; then
  if [ "\$IS_TERMUX" = "1" ] && command -v pkg >/dev/null 2>&1; then
    info "Menginstal FFmpeg di Termux..."
    pkg install -y ffmpeg || warn "FFmpeg gagal diinstal otomatis; audio tetap berjalan melalui Lavalink server."
  else
    warn "FFmpeg tidak ditemukan secara lokal (opsional karena pemrosesan audio ditangani oleh node Lavalink)."
  fi
else
  ok "FFmpeg terdeteksi."
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "\$NODE_MAJOR" -lt 18 ]; then
  fail "Versi Node.js saat ini ($(node -v)) terlalu lama. Lagukan membutuhkan Node.js v18 ke atas."
fi
ok "Node.js $(node -v) & Git $(git --version | awk '{print $3}') siap digunakan."

if command -v java >/dev/null 2>&1; then
  ok "Java terdeteksi (opsional untuk Lavalink lokal)."
else
  info "Java tidak terpasang (tidak wajib — direkomendasikan memakai node Lavalink v4 eksternal di Termux)."
fi

# ------------------------------------------------------------------------------
# TAHAP 3 & 4: Pengecekan Folder Aman, Clone Repository, & Instalasi Dependencies
# ------------------------------------------------------------------------------
info "[3/9] Memeriksa direktori instalasi: \$TARGET_DIR"
SKIP_CLONE=0
PRESERVE_EXISTING_ENV=0

if [ -d "\$TARGET_DIR" ]; then
  warn "Folder '\$TARGET_DIR' sudah ada! Installer TIDAK AKAN menimpa atau menghapus file Anda secara otomatis."
  printf "\\nPilih tindakan yang diinginkan:\\n"
  printf "  [1] Update Lagukan (git pull --ff-only & pertahankan konfigurasi .env lama)\\n"
  printf "  [2] Konfigurasi ulang koneksi Cloud & Token saja (tanpa clone ulang)\\n"
  printf "  [3] Instalasi baru yang aman (pindahkan folder lama ke cadangan backup, tanpa menghapus file)\\n"
  printf "  [4] Batalkan & keluar\\n\\n"
  ACTION_CHOICE=""
  read_tty "Masukkan pilihan [1/2/3/4]: " ACTION_CHOICE 0 "\${LAGUKAN_EXISTING_ACTION:-2}"

  case "\$ACTION_CHOICE" in
    1)
      info "Menjalankan update aman pada '\$TARGET_DIR'..."
      cd "\$TARGET_DIR"
      git pull --ff-only origin main || warn "Git pull dilewati karena ada perubahan lokal; file Anda tetap utuh."
      SKIP_CLONE=1
      PRESERVE_EXISTING_ENV=1
      ;;
    2)
      info "Menggunakan folder '\$TARGET_DIR' yang sudah ada untuk pembaruan konfigurasi..."
      SKIP_CLONE=1
      ;;
    3)
      BACKUP_DIR="\${TARGET_DIR}_backup_$(date +%Y%m%d_%H%M%S)"
      mv "\$TARGET_DIR" "\$BACKUP_DIR"
      ok "Folder lama berhasil diamankan ke '\$BACKUP_DIR' (tidak ada file yang dihapus)."
      SKIP_CLONE=0
      ;;
    *)
      info "Instalasi dibatalkan oleh pengguna. Tidak ada perubahan yang dilakukan."
      exit 0
      ;;
  esac
fi

if [ "\$SKIP_CLONE" = "0" ]; then
  if [ "\$SELF_TEST_MODE" = "1" ] && [ -n "\${LAGUKAN_LOCAL_REPO_SOURCE:-}" ]; then
    info "[Self-Test] Menyalin struktur kerja dari sumber lokal..."
    mkdir -p "\$TARGET_DIR"
    cp "\$LAGUKAN_LOCAL_REPO_SOURCE/package.json" "\$TARGET_DIR/package.json"
  else
    info "Mengunduh repository resmi Lagukan dari GitHub..."
    git clone --depth 1 "\$REPO_URL" "\$TARGET_DIR"
  fi
  ok "Repository Lagukan berhasil disiapkan di '\$TARGET_DIR'."
fi

cd "\$TARGET_DIR"

info "[4/9] Menginstal dependencies Node.js..."
if [ "\$SELF_TEST_MODE" = "1" ]; then
  ok "[Self-Test] Melewati unduhan npm penuh pada mode uji cepat."
else
  npm install --no-audit --no-fund
  ok "Seluruh paket Node.js berhasil terpasang."
fi

# ------------------------------------------------------------------------------
# TAHAP 5 & 6: Registrasi / Sinkronisasi Layanan Backend Cloud Database Pusat
# ------------------------------------------------------------------------------
info "[5/9] Menghubungkan instalasi ke Lagukan Cloud Database Gateway..."
INST_ID=""
INST_KEY=""

if [ "\$PRESERVE_EXISTING_ENV" = "1" ] && [ -f ".env" ]; then
  EXISTING_ID="$(grep -E '^LAGUKAN_INSTALL_ID=' .env | head -n1 | cut -d'=' -f2- | tr -d '\"' | xargs || true)"
  EXISTING_KEY="$(grep -E '^LAGUKAN_API_KEY=' .env | head -n1 | cut -d'=' -f2- | tr -d '\"' | xargs || true)"
  if [ -n "\$EXISTING_ID" ] && [ -n "\$EXISTING_KEY" ]; then
    INST_ID="\$EXISTING_ID"
    INST_KEY="\$EXISTING_KEY"
    ok "Menggunakan Installation ID yang sudah tersimpan: \$INST_ID"
  fi
fi

if [ -z "\$INST_ID" ]; then
  printf "\\nApakah Anda sudah membuat Installation ID di halaman Web Installer?\\n"
  WEB_INST_ID=""
  read_tty "Masukkan Installation ID (atau tekan Enter untuk membuat baru otomatis): " WEB_INST_ID 0 "\${LAGUKAN_PRE_INSTALL_ID:-}"

  if [ -n "\$WEB_INST_ID" ]; then
    WEB_INST_KEY=""
    read_tty "Masukkan Installation Access Key Anda (input disembunyikan): " WEB_INST_KEY 1 "\${LAGUKAN_PRE_API_KEY:-}"
    INST_ID="\$WEB_INST_ID"
    INST_KEY="\$WEB_INST_KEY"
  else
    REG_JSON="$(curl -fsSL -X POST "\$API_BASE_URL/api/v1/installations/register" \\
      -H "Content-Type: application/json" \\
      -d "{\\"label\\":\\"Termux Android\\",\\"platform\\":\\"$(uname -s)-$(uname -m)\\",\\"nodeVersion\\":\\"$(node -v)\\"}")" || fail "Gagal menghubungi server installer di \$API_BASE_URL."

    INST_ID="$(node -e "const d=JSON.parse(process.argv[1]); if(!d.ok) process.exit(1); process.stdout.write(d.installation.installationId);" "\$REG_JSON")" || fail "Respons registrasi tidak valid."
    INST_KEY="$(node -e "const d=JSON.parse(process.argv[1]); process.stdout.write(d.apiKey);" "\$REG_JSON")"
    ok "Installation ID berhasil dibuat: \$INST_ID"
    printf "\${C_YELLOW}PENTING — Simpan kredensial Dashboard Web Anda di tempat aman:\${C_RESET}\\n"
    printf "  • Installation ID : %s\\n" "\$INST_ID"
    printf "  • Access Key      : %s\\n\\n" "\$INST_KEY"
  fi
fi

report_stage "env_check"
report_stage "deps_check"
report_stage "repo_clone"
report_stage "npm_deps"

# ------------------------------------------------------------------------------
# TAHAP 7: Input & Validasi Aman Discord Bot Token
# ------------------------------------------------------------------------------
info "[7/9] Mempersiapkan validasi Discord Bot Token..."
DISCORD_BOT_TOKEN=""

if [ "\$PRESERVE_EXISTING_ENV" = "1" ] && [ -f ".env" ]; then
  SAVED_TOKEN="$(grep -E '^TOKEN=' .env | head -n1 | cut -d'=' -f2- | tr -d '\"' | xargs || true)"
  if [ -n "\$SAVED_TOKEN" ]; then
    ok "Mempertahankan Discord Bot Token pada file .env yang sudah ada."
    DISCORD_BOT_TOKEN="\$SAVED_TOKEN"
  fi
fi

while [ -z "\$DISCORD_BOT_TOKEN" ]; do
  CANDIDATE_TOKEN=""
  read_tty "Masukkan Discord Bot Token Anda (input disembunyikan demi keamanan): " CANDIDATE_TOKEN 1 "\${LAGUKAN_TEST_DISCORD_TOKEN:-}"
  CANDIDATE_TOKEN="$(printf "%s" "\$CANDIDATE_TOKEN" | xargs)"

  if [ -z "\$CANDIDATE_TOKEN" ]; then
    warn "Token tidak boleh kosong. Silakan salin dari Discord Developer Portal -> Bot -> Token."
    [ "\$SELF_TEST_MODE" = "1" ] && fail "Token kosong pada mode self-test."
    continue
  fi

  VERIFY_PAYLOAD="$(node -e "process.stdout.write(JSON.stringify({ token: process.argv[1], installationId: process.argv[2] }))" "\$CANDIDATE_TOKEN" "\$INST_ID")"
  VERIFY_RES="$(curl -sS -X POST "\$API_BASE_URL/api/v1/verify-token" \\
    -H "Content-Type: application/json" \\
    -H "Authorization: Bearer \$INST_KEY" \\
    -H "X-Lagukan-Installation-Id: \$INST_ID" \\
    -d "\$VERIFY_PAYLOAD" || true)"

  IS_VALID="$(node -e "try{const r=JSON.parse(process.argv[1]); process.stdout.write(r.valid?'1':'0');}catch{process.stdout.write('0');}" "\$VERIFY_RES")"
  MSG_OUT="$(node -e "try{const r=JSON.parse(process.argv[1]); process.stdout.write(r.message||r.error||'');}catch{process.stdout.write('Gagal memeriksa token');}" "\$VERIFY_RES")"

  if [ "\$IS_VALID" = "1" ]; then
    DISCORD_BOT_TOKEN="\$CANDIDATE_TOKEN"
    ok "\$MSG_OUT"
    report_stage "token_verify"
  else
    warn "Validasi gagal: \$MSG_OUT"
    [ "\$SELF_TEST_MODE" = "1" ] && fail "Token tidak valid pada mode self-test."
  fi
done

# ------------------------------------------------------------------------------
# TAHAP 6 (Penulisan File .env Aman — Tanpa MONGO_URI, Permission 600)
# ------------------------------------------------------------------------------
info "[6/9] Membuat file konfigurasi .env terenkripsi akses lokal (chmod 600)..."
if [ -f ".env" ] && [ "\$PRESERVE_EXISTING_ENV" = "0" ]; then
  cp ".env" ".env.backup.$(date +%Y%m%d_%H%M%S)"
  chmod 600 .env.backup.* 2>/dev/null || true
  info "File .env sebelumnya telah dicadangkan dengan aman."
fi

if [ "\$PRESERVE_EXISTING_ENV" = "0" ] || [ ! -f ".env" ]; then
  umask 077
  cat > ".env" <<EOF
# =========================================================
# LAGUKAN TERMUX CONFIGURATION (MANAGED BY WEB INSTALLER)
# =========================================================
BOT_NAME=Lagukan
TOKEN=\${DISCORD_BOT_TOKEN}
PREFIX=666!
EMBED_COLOR=8B5CF6
STANDALONE_MODE=true
TIMEZONE=Asia/Jakarta
VOICE_LOG_ENABLED=true
SERVER_MEMBERS_INTENT=true

# CENTRAL CLOUD DATABASE GATEWAY (NO DIRECT MONGO_URI NEEDED)
LAGUKAN_CLOUD_MODE=true
LAGUKAN_API_URL=\${API_BASE_URL}
LAGUKAN_INSTALL_ID=\${INST_ID}
LAGUKAN_API_KEY=\${INST_KEY}

# LAVALINK v4 CONFIGURATION (Ubah ke host Lavalink v4 pilihan Anda jika perlu)
LAVALINK_NAME=Lagukan
LAVALINK_HOST=localhost
LAVALINK_PORT=2333
LAVALINK_PASSWORD=youshallnotpass
LAVALINK_SECURE=false
LAVALINK_DRIVER=lavalink/v4/koinu
DEFAULT_SEARCH_ENGINE=youtubeMusic
SEARCH_FALLBACK_ENGINE=youtube
EOF
  chmod 600 ".env"
fi
unset DISCORD_BOT_TOKEN CANDIDATE_TOKEN VERIFY_PAYLOAD
ok "File .env tersimpan aman (izin akses 600 khusus pemilik perangkat)."
report_stage "config_setup"

# ------------------------------------------------------------------------------
# TAHAP 8: Pengujian Koneksi Cloud API & Pemeriksaan Konfigurasi
# ------------------------------------------------------------------------------
info "[8/9] Menguji koneksi terautentikasi ke Lagukan Cloud Database Gateway..."
PING_RES="$(curl -fsSL -X POST "\$API_BASE_URL/api/v1/db/ping" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer \$INST_KEY" \\
  -H "X-Lagukan-Installation-Id: \$INST_ID" \\
  -d "{\\"version\\":\\"${safeVersion}\\",\\"nodeVersion\\":\\"$(node -v)\\"}")" || fail "Pengujian koneksi API gagal. Periksa koneksi internet atau Access Key Anda."

PING_OK="$(node -e "const r=JSON.parse(process.argv[1]); process.stdout.write(r.ok?'1':'0');" "\$PING_RES")"
if [ "\$PING_OK" != "1" ]; then
  fail "Autentikasi Cloud Database ditolak."
fi
ok "Koneksi ke Cloud Database pusat berhasil & terisolasi untuk \$INST_ID!"
report_stage "api_test"

if [ -f "src/functions/slashCommandValidator.js" ] && [ "\$SELF_TEST_MODE" = "0" ]; then
  info "Memvalidasi skema seluruh slash command..."
  npm run validate:commands
fi

if [ -f "src/features/assistant/assistantSelfTest.js" ] && [ "\$SELF_TEST_MODE" = "0" ]; then
  info "Memvalidasi modul lokal 666 Text Assistant..."
  npm run validate:assistant
fi

report_stage "bot_ready"

# ------------------------------------------------------------------------------
# TAHAP 9: Instruksi Menjalankan Bot
# ------------------------------------------------------------------------------
printf "\\n\${C_GREEN}╔══════════════════════════════════════════════════════════════╗\${C_RESET}\\n"
printf "\${C_GREEN}║          ✅ INSTALASI LAGUKAN SELESAI DENGAN AMAN!           ║\${C_RESET}\\n"
printf "\${C_GREEN}╚══════════════════════════════════════════════════════════════╝\${C_RESET}\\n\\n"
printf "  • Folder Instalasi : \${C_CYAN}%s\${C_RESET}\\n" "\$TARGET_DIR"
printf "  • Installation ID  : \${C_PURPLE}%s\${C_RESET}\\n" "\$INST_ID"
printf "  • Dashboard Web    : \${C_CYAN}%s\${C_RESET}\\n\\n" "\$API_BASE_URL"
printf "Jalankan perintah berikut untuk menyalakan bot di Termux:\\n"
printf "  \${C_PURPLE}cd %s && npm run start:termux\${C_RESET}\\n\\n" "\$TARGET_DIR"
`;
}

module.exports = {
    generateTermuxInstallScript,
    sanitizeBaseUrl,
};
