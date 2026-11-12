import React from "react";
import { Copy, Check, ExternalLink, Smartphone, Terminal, KeyRound, Play, RefreshCw, Wrench, MessageCircle } from "lucide-react";

export default function DocsPage({ health, onCopyText, copiedKey, onNavigate }) {
    const originUrl = typeof window !== "undefined" ? window.location.origin : "";
    const installCmd = health?.installCommand || `curl -fsSL ${originUrl}/install.sh | bash`;
    const termuxInitCmd = "termux-wake-lock && pkg update -y && pkg upgrade -y && pkg install -y curl git nodejs-lts ffmpeg";
    const startCmd = "cd ~/Lagukan && npm run start:termux";
    const updateCmd = "cd ~/Lagukan && git pull --ff-only origin main && npm install --no-audit --no-fund && npm run validate:commands";

    return (
        <div className="container page-anim">
            <section className="card" style={{ marginBottom: 20 }}>
                <span className="badge badge-purple">Dokumentasi Resmi</span>
                <h1 style={{ fontSize: "1.45rem", fontWeight: 900, marginTop: 6 }}>
                    Panduan Lengkap Instalasi & Pengoperasian Lagukan di Termux
                </h1>
                <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)", marginTop: 4 }}>
                    Semua yang perlu Anda ketahui mulai dari memasang aplikasi Termux di Android hingga menjalankan, memperbarui, dan
                    mengatasi kendala pada bot musik Lagukan.
                </p>
            </section>

            {/* 1. Cara Install Termux */}
            <section className="card" style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
                    <Smartphone size={19} color="#c084fc" />
                    <h2 style={{ fontSize: "1.1rem", fontWeight: 800 }}>1. Cara Install Termux di Android</h2>
                </div>
                <ol style={{ paddingLeft: 20, fontSize: "0.88rem", color: "var(--text-secondary)", display: "grid", gap: 6 }}>
                    <li>
                        Unduh aplikasi <strong>Termux</strong> resmi dari <strong>F-Droid</strong> atau halaman{" "}
                        <a href="https://github.com/termux/termux-app/releases" target="_blank" rel="noreferrer">
                            GitHub Releases Termux <ExternalLink size={12} />
                        </a>{" "}
                        (hindari versi lama yang tidak diperbarui agar repositori <code>pkg</code> tetap aktif).
                    </li>
                    <li>
                        Buka Termux, aktifkan <strong>Wake Lock</strong> agar Android tidak mematikan koneksi saat layar terkunci, lalu
                        perbarui paket dasar:
                    </li>
                </ol>
                <div className="cmd-box">
                    <code className="cmd-text">{termuxInitCmd}</code>
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => onCopyText(termuxInitCmd, "doc-init", "Perintah persiapan Termux disalin!")}
                    >
                        {copiedKey === "doc-init" ? <Check size={14} /> : <Copy size={14} />}
                        Salin
                    </button>
                </div>
            </section>

            {/* 2. Cara Menjalankan Installer */}
            <section className="card" style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
                    <Terminal size={19} color="#c084fc" />
                    <h2 style={{ fontSize: "1.1rem", fontWeight: 800 }}>2. Cara Menjalankan Installer</h2>
                </div>
                <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)" }}>
                    Salin satu perintah berikut dan jalankan di Termux. Anda juga bisa membuat <strong>Installation ID</strong> terlebih
                    dahulu di menu{" "}
                    <button
                        type="button"
                        onClick={() => onNavigate("install")}
                        style={{ background: "none", border: "none", color: "var(--purple-soft)", fontWeight: 700, cursor: "pointer" }}
                    >
                        Install Lagukan
                    </button>{" "}
                    agar status setiap tahapan langsung terpantau dari browser HP.
                </p>
                <div className="cmd-box">
                    <code className="cmd-text">{installCmd}</code>
                    <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => onCopyText(installCmd, "doc-inst", "Perintah installer disalin!")}
                    >
                        {copiedKey === "doc-inst" ? <Check size={14} /> : <Copy size={14} />}
                        Salin
                    </button>
                </div>
            </section>

            {/* 3. Cara Memasukkan Discord Token */}
            <section className="card" style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
                    <KeyRound size={19} color="#c084fc" />
                    <h2 style={{ fontSize: "1.1rem", fontWeight: 800 }}>3. Cara Mendapatkan & Memasukkan Discord Token</h2>
                </div>
                <ol style={{ paddingLeft: 20, fontSize: "0.88rem", color: "var(--text-secondary)", display: "grid", gap: 6 }}>
                    <li>
                        Buka{" "}
                        <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">
                            Discord Developer Portal <ExternalLink size={12} />
                        </a>{" "}
                        → klik <strong>New Application</strong> → buka tab <strong>Bot</strong>.
                    </li>
                    <li>
                        Gulir ke bagian <strong>Privileged Gateway Intents</strong> lalu aktifkan <strong>MESSAGE CONTENT INTENT</strong>{" "}
                        (agar request lagu langsung di channel & tebakan lagu <code>/guessthesong</code> berfungsi). Klik{" "}
                        <strong>Save Changes</strong>.
                    </li>
                    <li>
                        Klik <strong>Reset Token</strong> → salin token bot Anda. Saat installer Termux meminta token, cukup{" "}
                        <strong>Paste</strong> lalu tekan <strong>Enter</strong> (karakter sengaja tidak ditampilkan di layar demi keamanan,
                        dan disimpan dengan izin akses <code>chmod 600</code> di file <code>~/Lagukan/.env</code>).
                    </li>
                    <li>
                        Undang bot ke server Anda melalui menu <strong>OAuth2 → URL Generator</strong> dengan mencentang scope{" "}
                        <code>bot</code> dan <code>applications.commands</code>.
                    </li>
                </ol>
            </section>

            {/* 4. Cara Menjalankan Lagukan */}
            <section className="card" style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
                    <Play size={19} color="#c084fc" />
                    <h2 style={{ fontSize: "1.1rem", fontWeight: 800 }}>4. Cara Menjalankan Lagukan</h2>
                </div>
                <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)" }}>
                    Gunakan skrip khusus Termux yang menjalankan Lagukan dalam mode proses tunggal hemat memori tanpa Docker:
                </p>
                <div className="cmd-box">
                    <code className="cmd-text">{startCmd}</code>
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => onCopyText(startCmd, "doc-start", "Perintah start Termux disalin!")}
                    >
                        {copiedKey === "doc-start" ? <Check size={14} /> : <Copy size={14} />}
                        Salin
                    </button>
                </div>
            </section>

            {/* 5. Cara Update Bot */}
            <section className="card" style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
                    <RefreshCw size={19} color="#c084fc" />
                    <h2 style={{ fontSize: "1.1rem", fontWeight: 800 }}>5. Cara Update Bot</h2>
                </div>
                <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)" }}>
                    Anda dapat menjalankan ulang perintah installer lalu memilih opsi <strong>[1] Update Lagukan</strong>, atau menjalankan
                    perintah update aman berikut (file <code>.env</code> Anda tidak akan terhapus):
                </p>
                <div className="cmd-box">
                    <code className="cmd-text">{updateCmd}</code>
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => onCopyText(updateCmd, "doc-upd", "Perintah update disalin!")}
                    >
                        {copiedKey === "doc-upd" ? <Check size={14} /> : <Copy size={14} />}
                        Salin
                    </button>
                </div>
            </section>

            {/* 6. Cara Mengatasi Error */}
            <section className="card" style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
                    <Wrench size={19} color="#c084fc" />
                    <h2 style={{ fontSize: "1.1rem", fontWeight: 800 }}>6. Cara Mengatasi Error Umum</h2>
                </div>
                <div style={{ display: "grid", gap: 10, fontSize: "0.86rem", color: "var(--text-secondary)" }}>
                    <div>
                        <strong style={{ color: "#fff" }}>• Slash command ditolak (Error 50001 Missing Access):</strong>
                        <p>
                            Pastikan bot diundang menggunakan kedua scope <code>bot</code> dan <code>applications.commands</code>. Bot akan
                            menampilkan tautan perbaikan otomatis di log Termux tanpa perlu meng-kick bot.
                        </p>
                    </div>
                    <div>
                        <strong style={{ color: "#fff" }}>• Input teks di channel Request Musik tidak merespons:</strong>
                        <p>
                            Aktifkan <strong>MESSAGE CONTENT INTENT</strong> di Discord Developer Portal → Bot, lalu restart Lagukan di
                            Termux.
                        </p>
                    </div>
                    <div>
                        <strong style={{ color: "#fff" }}>• Audio suara tidak keluar / koneksi Lavalink gagal di Termux:</strong>
                        <p>
                            Protokol enkripsi suara Discord DAVE membutuhkan server <strong>Lavalink v4.2.2+</strong>. Pada perangkat
                            Android Termux, gunakan host node Lavalink v4 eksternal pada variabel <code>LAVALINK_HOST</code>,{" "}
                            <code>LAVALINK_PORT</code>, dan <code>LAVALINK_PASSWORD</code> di <code>~/Lagukan/.env</code> (atau jalankan
                            Lavalink di dalam <code>proot-distro</code> Ubuntu).
                        </p>
                    </div>
                    <div>
                        <strong style={{ color: "#fff" }}>• Bot berhenti saat layar HP mati:</strong>
                        <p>
                            Jalankan <code>termux-wake-lock</code> dan nonaktifkan penghematan daya baterai (<em>Battery Optimization</em>)
                            untuk aplikasi Termux di pengaturan Android Anda.
                        </p>
                    </div>
                </div>
            </section>

            {/* 7. Cara Menghubungi Pemilik Project */}
            <section className="card">
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
                    <MessageCircle size={19} color="#c084fc" />
                    <h2 style={{ fontSize: "1.1rem", fontWeight: 800 }}>7. Cara Menghubungi Pemilik Project</h2>
                </div>
                <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)", marginBottom: 14 }}>
                    Butuh bantuan teknis, ingin melaporkan bug, atau mengajukan verifikasi fitur Premium server? Hubungi pemilik resmi
                    project Lagukan melalui kanal berikut:
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                    <a
                        className="btn btn-primary btn-sm"
                        href={health?.supportUrl || "https://discord.gg/kNdSkHchzH"}
                        target="_blank"
                        rel="noreferrer"
                    >
                        Discord Support Server <ExternalLink size={14} />
                    </a>
                    <a
                        className="btn btn-secondary btn-sm"
                        href={health?.repositoryUrl || "https://github.com/HOOOOOOQ/Lagukan"}
                        target="_blank"
                        rel="noreferrer"
                    >
                        GitHub HOOOOOOQ/Lagukan <ExternalLink size={14} />
                    </a>
                </div>
            </section>
        </div>
    );
}
