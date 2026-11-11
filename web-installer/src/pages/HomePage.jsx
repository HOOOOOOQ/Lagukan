import React from "react";
import {
    Terminal,
    BookOpen,
    ShieldCheck,
    Music2,
    Sparkles,
    Award,
    Radio,
    Gamepad2,
    Copy,
    Check,
    RefreshCw,
    LayoutDashboard,
    Smartphone,
} from "lucide-react";

const BOT_FEATURES = [
    {
        icon: Music2,
        title: "Multi-Source Music Engine",
        desc: "Putar lagu dari YouTube, YT Music, metadata Spotify, SoundCloud, Direct Audio, Radio Mode, Auto DJ, & Sleep Timer.",
    },
    {
        icon: Sparkles,
        title: "Smart Now Playing 11 Tombol",
        desc: "Dashboard interaktif real-time lengkap dengan progress bar, Album, Volume, Lyrics, Loop, Shuffle, & Favorite.",
    },
    {
        icon: Award,
        title: "Profil 666!cek & Listener Level",
        desc: "Kartu profil musik personal dengan 8 jenjang level XP anti-farming, riwayat dengar nyata, Playlist, & Music Wrapped.",
    },
    {
        icon: Radio,
        title: "DJ Role ID & Voice Request",
        desc: "Channel request lagu langsung tanpa mengetik /play serta proteksi DJ Mode ketat berbasis Role ID server.",
    },
    {
        icon: Gamepad2,
        title: "Music Party & Mini Games",
        desc: "Sesi dengar bareng (Vote Skip & Party Host), tebak cuplikan lagu /guessthesong, dan adu lagu /musicbattle.",
    },
    {
        icon: ShieldCheck,
        title: "Cloud Database Pusat Terisolasi",
        desc: "Tanpa perlu membuat akun MongoDB sendiri! Data setiap instalasi dipisahkan aman berdasarkan Installation ID.",
    },
];

export default function HomePage({ health, loadingHealth, onRefreshHealth, onNavigate, onCopyText, copiedKey }) {
    const installCmd =
        health?.installCommand || `curl -fsSL ${typeof window !== "undefined" ? window.location.origin : ""}/install.sh | bash`;

    const serviceOk = Boolean(health?.ok && health?.mongodbService?.connected);

    return (
        <div className="container page-anim">
            {/* Hero Section */}
            <section className="hero-box">
                <div className="eyebrow-badge">
                    <Smartphone size={14} />
                    OFFICIAL ANDROID TERMUX WEB INSTALLER
                </div>

                <h1 className="hero-title">
                    <span className="gradient-text">LAGUKAN INSTALLER</span>
                </h1>

                <p className="hero-tagline">Your Music Bot, One Step Away.</p>

                <p className="hero-desc">
                    Pasang dan jalankan Discord Music Bot <strong>Lagukan</strong> langsung dari HP Android melalui <strong>Termux</strong>{" "}
                    hanya dengan satu perintah. Terhubung otomatis ke layanan Cloud Database pusat yang aman tanpa perlu mengatur MongoDB
                    URI sendiri.
                </p>

                <div className="cta-row">
                    <button type="button" className="btn btn-primary" onClick={() => onNavigate("install")}>
                        <Terminal size={18} />
                        Install Lagukan
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => onNavigate("docs")}>
                        <BookOpen size={18} />
                        Dokumentasi
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => onNavigate("dashboard")}>
                        <LayoutDashboard size={18} />
                        Dashboard Pengguna
                    </button>
                </div>
            </section>

            {/* Quick One-Line Termux Command */}
            <section className="card" style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <div>
                        <span className="badge badge-purple">Perintah Cepat Termux</span>
                        <h2 style={{ fontSize: "1.06rem", marginTop: 6 }}>Salin & Jalankan di Aplikasi Termux Android</h2>
                    </div>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => onNavigate("install")}>
                        Buka Panduan Tahap demi Tahap →
                    </button>
                </div>

                <div className="cmd-box">
                    <code className="cmd-text">{installCmd}</code>
                    <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => onCopyText(installCmd, "home-cmd", "Perintah instalasi Termux berhasil disalin!")}
                    >
                        {copiedKey === "home-cmd" ? <Check size={15} /> : <Copy size={15} />}
                        {copiedKey === "home-cmd" ? "Tersalin" : "Salin"}
                    </button>
                </div>
            </section>

            {/* Live Service Status */}
            <div className="section-heading">
                <h2>Status Layanan Instalasi</h2>
                <button type="button" className="btn btn-ghost btn-sm" onClick={onRefreshHealth} disabled={loadingHealth}>
                    <RefreshCw size={14} />
                    {loadingHealth ? "Memeriksa..." : "Segarkan Status"}
                </button>
            </div>

            <section className="grid-3">
                <div className="card">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <span style={{ color: "var(--text-secondary)", fontSize: "0.84rem", fontWeight: 600 }}>API Layanan Installer</span>
                        <span className={`badge ${health?.ok ? "badge-ok" : "badge-warn"}`}>{health?.ok ? "Aktif" : "Memuat"}</span>
                    </div>
                    <div style={{ fontSize: "1.15rem", fontWeight: 800 }}>{health?.ok ? "HTTPS Gateway Siap" : "Menghubungkan..."}</div>
                    <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>
                        Versi Bot Resmi: <strong>v{health?.lagukanVersion || "3.1.0"}</strong> • Rate-limit & proteksi aktif
                    </p>
                </div>

                <div className="card">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <span style={{ color: "var(--text-secondary)", fontSize: "0.84rem", fontWeight: 600 }}>Database Pusat Lagukan</span>
                        <span className={`badge ${serviceOk ? "badge-ok" : "badge-warn"}`}>{serviceOk ? "Terhubung" : "Siaga"}</span>
                    </div>
                    <div style={{ fontSize: "1.05rem", fontWeight: 800 }}>
                        {health?.mongodbService?.statusText || "Memeriksa koneksi..."}
                    </div>
                    <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>
                        Latency: <strong>{health?.mongodbService?.latencyMs ?? "—"} ms</strong> • Kredensial tersembunyi di server
                    </p>
                </div>

                <div className="card">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <span style={{ color: "var(--text-secondary)", fontSize: "0.84rem", fontWeight: 600 }}>Isolasi Data Pengguna</span>
                        <span className="badge badge-purple">Terlindungi</span>
                    </div>
                    <div style={{ fontSize: "1.05rem", fontWeight: 800 }}>Per-Installation ID</div>
                    <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>
                        Total instalasi terdaftar: <strong>{health?.stats?.totalInstallations ?? 0}</strong> perangkat
                    </p>
                </div>
            </section>

            {/* Bot Features Grid */}
            <div className="section-heading">
                <h2>Fitur Unggulan Bot Musik Lagukan</h2>
            </div>

            <section className="grid-3">
                {BOT_FEATURES.map((feat) => {
                    const IconComp = feat.icon;
                    return (
                        <div className="card" key={feat.title}>
                            <div
                                style={{
                                    width: 40,
                                    height: 40,
                                    borderRadius: 11,
                                    background: "rgba(139, 92, 246, 0.16)",
                                    border: "1px solid rgba(168, 85, 247, 0.35)",
                                    display: "grid",
                                    placeItems: "center",
                                    color: "var(--purple-soft)",
                                    marginBottom: 12,
                                }}
                            >
                                <IconComp size={20} />
                            </div>
                            <h3 style={{ fontSize: "1rem", fontWeight: 800, marginBottom: 6 }}>{feat.title}</h3>
                            <p style={{ fontSize: "0.86rem", color: "var(--text-secondary)" }}>{feat.desc}</p>
                        </div>
                    );
                })}
            </section>
        </div>
    );
}
