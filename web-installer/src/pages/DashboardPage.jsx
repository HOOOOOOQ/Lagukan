import React, { useState } from "react";
import {
    Lock,
    LogOut,
    RefreshCw,
    Copy,
    Check,
    KeyRound,
    Activity,
    Database,
    Clock,
    Tag,
    CheckCircle2,
    Circle,
    ShieldCheck,
    RotateCcw,
} from "lucide-react";
import { loginDashboard, logoutDashboard, rotateInstallationAccessKey } from "../api";
import { STAGE_LABELS } from "./InstallPage";

function formatDateTime(iso) {
    if (!iso) return "Belum tercatat";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "Belum tercatat";
    return d.toLocaleString("id-ID", {
        dateStyle: "medium",
        timeStyle: "short",
    });
}

function getBotConnectionBadge(status) {
    if (status === "online") return { label: "Online & Aktif", cls: "badge-ok" };
    if (status === "configured_standby") return { label: "Terkonfigurasi (Siap Dijalankan)", cls: "badge-purple" };
    if (status === "offline") return { label: "Offline (Heartbeat Terhenti)", cls: "badge-warn" };
    return { label: "Menunggu Setup Termux", cls: "badge-muted" };
}

export default function DashboardPage({
    activeInstallation,
    mongodbService,
    onLoginSuccess,
    onLogoutSuccess,
    onRefreshSession,
    onNavigate,
    onCopyText,
    copiedKey,
    notify,
}) {
    const [loginId, setLoginId] = useState("");
    const [loginKey, setLoginKey] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [rotating, setRotating] = useState(false);
    const [freshRotatedKey, setFreshRotatedKey] = useState("");

    const updateCommand = "cd ~/Lagukan && git pull --ff-only origin main && npm install --no-audit --no-fund && npm run validate:commands";
    const restartCommand = "cd ~/Lagukan && npm run start:termux";
    const restartTmuxCommand =
        'tmux kill-session -t lagukan 2>/dev/null || true; tmux new -d -s lagukan "cd ~/Lagukan && npm run start:termux"';

    const handleLogin = async (e) => {
        e.preventDefault();
        if (!loginId.trim() || !loginKey.trim()) {
            notify("error", "Masukkan Installation ID dan Access Key Anda.");
            return;
        }
        setSubmitting(true);
        try {
            const res = await loginDashboard(loginId.trim(), loginKey.trim());
            if (res.ok && res.data?.installation) {
                setLoginKey("");
                onLoginSuccess(res.data.installation, res.data.mongodbService);
                notify("success", "Berhasil masuk ke Dashboard Instalasi!");
            } else {
                notify("error", res.data?.error || "Login gagal. Periksa Installation ID dan Access Key Anda.");
            }
        } catch {
            notify("error", "Gagal menghubungi server autentikasi.");
        } finally {
            setSubmitting(false);
        }
    };

    const handleLogout = async () => {
        await logoutDashboard();
        setFreshRotatedKey("");
        onLogoutSuccess();
        notify("success", "Anda telah keluar dari sesi Dashboard.");
    };

    const handleRotateKey = async () => {
        setRotating(true);
        try {
            const res = await rotateInstallationAccessKey();
            if (res.ok && res.data?.apiKey) {
                setFreshRotatedKey(res.data.apiKey);
                onRefreshSession();
                notify("success", "Access Key baru berhasil dibuat! Segera perbarui file .env di Termux Anda.");
            } else {
                notify("error", res.data?.error || "Gagal memperbarui Access Key.");
            }
        } catch {
            notify("error", "Terjadi kesalahan saat merotasi key.");
        } finally {
            setRotating(false);
        }
    };

    if (!activeInstallation) {
        return (
            <div className="container page-anim">
                <section className="card" style={{ maxWidth: 520, margin: "18px auto" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                        <div className="brand-logo" style={{ width: 38, height: 38 }}>
                            <Lock size={18} color="#c084fc" />
                        </div>
                        <div>
                            <h1 style={{ fontSize: "1.25rem", fontWeight: 900 }}>Autentikasi Dashboard Pengguna</h1>
                            <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
                                Terlindungi isolasi sesi HttpOnly • Akses silang antarinstalasi diblokir
                            </p>
                        </div>
                    </div>

                    <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)", marginBottom: 16 }}>
                        Masuk menggunakan <strong>Installation ID</strong> dan <strong>Access Key</strong> yang Anda peroleh saat
                        menjalankan installer di Termux atau halaman Install.
                    </p>

                    <form onSubmit={handleLogin}>
                        <div style={{ marginBottom: 12 }}>
                            <label className="field-label" htmlFor="dash-inst-id">
                                Installation ID
                            </label>
                            <input
                                id="dash-inst-id"
                                type="text"
                                className="text-input"
                                value={loginId}
                                onChange={(e) => setLoginId(e.target.value)}
                                placeholder="lgk_inst_..."
                                autoComplete="username"
                            />
                        </div>

                        <div style={{ marginBottom: 16 }}>
                            <label className="field-label" htmlFor="dash-access-key">
                                Installation Access Key
                            </label>
                            <input
                                id="dash-access-key"
                                type="password"
                                className="text-input"
                                value={loginKey}
                                onChange={(e) => setLoginKey(e.target.value)}
                                placeholder="lgk_sk_..."
                                autoComplete="current-password"
                            />
                        </div>

                        <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={submitting}>
                            {submitting ? "Memverifikasi..." : "Masuk ke Dashboard"}
                        </button>
                    </form>

                    <div style={{ marginTop: 16, textAlign: "center", fontSize: "0.84rem", color: "var(--text-muted)" }}>
                        Belum memiliki Installation ID?{" "}
                        <button
                            type="button"
                            onClick={() => onNavigate("install")}
                            style={{
                                background: "none",
                                border: "none",
                                color: "var(--purple-soft)",
                                fontWeight: 700,
                                cursor: "pointer",
                            }}
                        >
                            Mulai Instalasi Baru →
                        </button>
                    </div>
                </section>
            </div>
        );
    }

    const botBadge = getBotConnectionBadge(activeInstallation.botConnectionStatus);
    const completedStages = activeInstallation.stagesCompleted || [];
    const progressPercent = Math.round((completedStages.length / STAGE_LABELS.length) * 100);

    return (
        <div className="container page-anim">
            {/* Top Bar */}
            <section className="card" style={{ marginBottom: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                    <div>
                        <span className="badge badge-purple">Dashboard Terautentikasi</span>
                        <h1 style={{ fontSize: "1.4rem", fontWeight: 900, marginTop: 6 }}>
                            Instalasi: {activeInstallation.label || "Android Termux"}
                        </h1>
                        <p style={{ fontSize: "0.84rem", color: "var(--text-muted)" }}>
                            Seluruh rahasia (Discord Token & kredensial database pusat) disembunyikan sepenuhnya demi keamanan.
                        </p>
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={onRefreshSession}>
                            <RefreshCw size={14} />
                            Segarkan
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={handleRotateKey} disabled={rotating}>
                            <KeyRound size={14} />
                            {rotating ? "Merotasi..." : "Rotasi Access Key"}
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={handleLogout}>
                            <LogOut size={14} />
                            Keluar
                        </button>
                    </div>
                </div>

                {freshRotatedKey && (
                    <div className="alert-box alert-info" style={{ flexDirection: "column", marginTop: 14 }}>
                        <strong>
                            Access Key Baru Berhasil Dibuat (hanya tampil satu kali — perbarui LAGUKAN_API_KEY di ~/Lagukan/.env):
                        </strong>
                        <div className="cmd-box" style={{ width: "100%" }}>
                            <code className="cmd-text">{freshRotatedKey}</code>
                            <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={() => onCopyText(freshRotatedKey, "rot-key", "Access Key baru disalin!")}
                            >
                                {copiedKey === "rot-key" ? <Check size={14} /> : <Copy size={14} />}
                                Salin Key Baru
                            </button>
                        </div>
                    </div>
                )}
            </section>

            {/* 6 Core Telemetry Cards */}
            <section className="grid-3" style={{ marginBottom: 20 }}>
                <div className="card">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <span style={{ fontSize: "0.82rem", color: "var(--text-secondary)", fontWeight: 600 }}>Status Instalasi</span>
                        <span
                            className={`badge ${
                                activeInstallation.installationStatus === "active" || activeInstallation.installationStatus === "configured"
                                    ? "badge-ok"
                                    : "badge-purple"
                            }`}
                        >
                            {String(activeInstallation.installationStatus || "pending").toUpperCase()}
                        </span>
                    </div>
                    <div style={{ fontSize: "1.18rem", fontWeight: 800 }}>
                        {completedStages.length}/{STAGE_LABELS.length} Tahap Selesai
                    </div>
                    <div className="progress-wrap">
                        <div className="progress-fill" style={{ width: `${Math.max(progressPercent, 5)}%` }} />
                    </div>
                </div>

                <div className="card">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <span style={{ fontSize: "0.82rem", color: "var(--text-secondary)", fontWeight: 600 }}>Installation ID</span>
                        <ShieldCheck size={16} color="#c084fc" />
                    </div>
                    <div style={{ fontSize: "0.92rem", fontWeight: 800, wordBreak: "break-all" }}>{activeInstallation.installationId}</div>
                    <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ marginTop: 10 }}
                        onClick={() => onCopyText(activeInstallation.installationId, "dash-id", "Installation ID berhasil disalin!")}
                    >
                        {copiedKey === "dash-id" ? <Check size={14} /> : <Copy size={14} />}
                        Salin Installation ID
                    </button>
                </div>

                <div className="card">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <span style={{ fontSize: "0.82rem", color: "var(--text-secondary)", fontWeight: 600 }}>Status Koneksi Bot</span>
                        <span className={`badge ${botBadge.cls}`}>{botBadge.label}</span>
                    </div>
                    <div style={{ fontSize: "1.08rem", fontWeight: 800, display: "flex", alignItems: "center", gap: 7 }}>
                        <Activity size={17} color="#a855f7" />
                        {activeInstallation.botUsername
                            ? `@${activeInstallation.botUsername}`
                            : activeInstallation.botApplicationId
                              ? `App ID: ${activeInstallation.botApplicationId}`
                              : "Menunggu Bot Login"}
                    </div>
                    <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 5 }}>
                        Server Aktif: <strong>{activeInstallation.guildCount ?? 0}</strong> • Heartbeat:{" "}
                        {formatDateTime(activeInstallation.lastHeartbeatAt)}
                    </p>
                </div>

                <div className="card">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <span style={{ fontSize: "0.82rem", color: "var(--text-secondary)", fontWeight: 600 }}>Status Layanan MongoDB</span>
                        <span className={`badge ${mongodbService?.connected ? "badge-ok" : "badge-warn"}`}>
                            {mongodbService?.connected ? "Aktif" : "Gangguan"}
                        </span>
                    </div>
                    <div style={{ fontSize: "1rem", fontWeight: 800, display: "flex", alignItems: "center", gap: 7 }}>
                        <Database size={17} color="#4ade80" />
                        {mongodbService?.statusText || "Central Cloud Gateway"}
                    </div>
                    <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 5 }}>
                        Aktivitas DB Terakhir: {formatDateTime(activeInstallation.lastDbActivityAt)}
                    </p>
                </div>

                <div className="card">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <span style={{ fontSize: "0.82rem", color: "var(--text-secondary)", fontWeight: 600 }}>Versi Lagukan</span>
                        <Tag size={16} color="#c084fc" />
                    </div>
                    <div style={{ fontSize: "1.18rem", fontWeight: 800 }}>v{activeInstallation.lagukanVersion || "3.1.0"}</div>
                    <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 5 }}>
                        Platform: {activeInstallation.platform || "android-termux"}{" "}
                        {activeInstallation.nodeVersion ? `• Node ${activeInstallation.nodeVersion}` : ""}
                    </p>
                </div>

                <div className="card">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <span style={{ fontSize: "0.82rem", color: "var(--text-secondary)", fontWeight: 600 }}>Waktu Instalasi</span>
                        <Clock size={16} color="#c084fc" />
                    </div>
                    <div style={{ fontSize: "1.02rem", fontWeight: 800 }}>{formatDateTime(activeInstallation.installedAt)}</div>
                    <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 5 }}>
                        Isolasi Tenant: Aktif penuh pada 21 koleksi skema
                    </p>
                </div>
            </section>

            {/* Stage Checklist */}
            <section className="card" style={{ marginBottom: 20 }}>
                <h2 style={{ fontSize: "1.05rem", fontWeight: 800 }}>Rincian Tahapan Instalasi</h2>
                <div className="stages-grid">
                    {STAGE_LABELS.map((st) => {
                        const done = completedStages.includes(st.key);
                        return (
                            <div key={st.key} className={`stage-item ${done ? "done" : ""}`}>
                                {done ? (
                                    <CheckCircle2 size={16} color="#4ade80" style={{ flexShrink: 0 }} />
                                ) : (
                                    <Circle size={16} color="#7e799c" style={{ flexShrink: 0 }} />
                                )}
                                <span>{st.label}</span>
                            </div>
                        );
                    })}
                </div>
            </section>

            {/* Update Guide & Restart Guide */}
            <div className="grid-2">
                <section className="card">
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <RefreshCw size={18} color="#c084fc" />
                        <h2 style={{ fontSize: "1.06rem", fontWeight: 800 }}>Panduan Update Bot</h2>
                    </div>
                    <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                        Perbarui Lagukan ke rilis terbaru dari GitHub tanpa menghapus file <code>.env</code> maupun data pengguna:
                    </p>
                    <div className="cmd-box">
                        <code className="cmd-text">{updateCommand}</code>
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => onCopyText(updateCommand, "upd-cmd", "Perintah update bot disalin!")}
                        >
                            {copiedKey === "upd-cmd" ? <Check size={14} /> : <Copy size={14} />}
                            Salin
                        </button>
                    </div>
                </section>

                <section className="card">
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <RotateCcw size={18} color="#c084fc" />
                        <h2 style={{ fontSize: "1.06rem", fontWeight: 800 }}>Panduan Menjalankan Ulang Bot</h2>
                    </div>
                    <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                        Hentikan proses lama dengan <code>Ctrl + C</code>, lalu nyalakan ulang Lagukan:
                    </p>
                    <div className="cmd-box">
                        <code className="cmd-text">{restartCommand}</code>
                        <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => onCopyText(restartCommand, "res-cmd", "Perintah restart bot disalin!")}
                        >
                            {copiedKey === "res-cmd" ? <Check size={14} /> : <Copy size={14} />}
                            Salin
                        </button>
                    </div>
                    <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 10 }}>
                        Atau mulai ulang sesi latar belakang <code>tmux</code>:
                    </p>
                    <div className="cmd-box">
                        <code className="cmd-text">{restartTmuxCommand}</code>
                        <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => onCopyText(restartTmuxCommand, "tmux-res", "Perintah restart tmux disalin!")}
                        >
                            {copiedKey === "tmux-res" ? <Check size={14} /> : <Copy size={14} />}
                            Salin
                        </button>
                    </div>
                </section>
            </div>
        </div>
    );
}
