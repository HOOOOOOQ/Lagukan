import React, { useState } from "react";
import {
    Copy,
    Check,
    CheckCircle2,
    Circle,
    KeyRound,
    Shield,
    Wifi,
    Terminal,
    Eye,
    EyeOff,
    RefreshCw,
    AlertTriangle,
    Play,
    Cpu,
} from "lucide-react";
import { registerNewInstallation, verifyDiscordTokenSecure, testAuthenticatedCloudPing, markInstallationStage } from "../api";

export const STAGE_LABELS = [
    { key: "env_check", label: "1. Cek Lingkungan Termux" },
    { key: "deps_check", label: "2. Node.js, Git & FFmpeg" },
    { key: "repo_clone", label: "3. Clone Repo Lagukan" },
    { key: "npm_deps", label: "4. Install Dependencies" },
    { key: "config_setup", label: "5. Konfigurasi Cloud .env" },
    { key: "token_verify", label: "6. Validasi Discord Token" },
    { key: "api_test", label: "7. Uji Koneksi Cloud API" },
    { key: "bot_ready", label: "8. Siap Menjalankan Bot" },
];

export default function InstallPage({
    health,
    activeInstallation,
    provisionedKey,
    onProvisionSuccess,
    onRefreshSession,
    onNavigate,
    onCopyText,
    copiedKey,
    notify,
}) {
    const [deviceLabel, setDeviceLabel] = useState("Termux Android");
    const [provisioning, setProvisioning] = useState(false);

    const [tokenInput, setTokenInput] = useState("");
    const [showToken, setShowToken] = useState(false);
    const [verifyingToken, setVerifyingToken] = useState(false);
    const [tokenResult, setTokenResult] = useState(null);

    const [testingApi, setTestingApi] = useState(false);
    const [apiTestResult, setApiTestResult] = useState(null);

    const originUrl = typeof window !== "undefined" ? window.location.origin : "";
    const oneLineCommand = health?.installCommand || `curl -fsSL ${originUrl}/install.sh | bash`;
    const reqCheckCommand = "pkg update -y && pkg upgrade -y && pkg install -y nodejs-lts git ffmpeg curl && node -v && git --version";
    const javaOptionalCommand = "pkg install -y openjdk-17";
    const cloneManualCommand =
        '[ -d "$HOME/Lagukan" ] && echo "Folder ~/Lagukan sudah ada (gunakan menu update installer)" || git clone https://github.com/HOOOOOOQ/Lagukan.git "$HOME/Lagukan"';
    const npmInstallCommand = "cd ~/Lagukan && npm install --no-audit --no-fund && npm run validate:commands";
    const runBotCommand = "cd ~/Lagukan && npm run start:termux";
    const runTmuxCommand = 'pkg install -y tmux && tmux new -s lagukan "cd ~/Lagukan && npm run start:termux"';

    const completedStages = activeInstallation?.stagesCompleted || [];
    const progressPercent = Math.round((completedStages.length / STAGE_LABELS.length) * 100);

    const handleCreateInstallation = async (e) => {
        e.preventDefault();
        setProvisioning(true);
        try {
            const res = await registerNewInstallation({
                label: deviceLabel || "Termux Android",
                platform: "android-termux",
            });
            if (res.ok && res.data?.installation) {
                onProvisionSuccess(res.data.installation, res.data.apiKey);
                notify("success", `Installation ID ${res.data.installation.installationId} berhasil dibuat!`);
            } else {
                notify("error", res.data?.error || "Gagal membuat sesi instalasi.");
            }
        } catch {
            notify("error", "Gagal menghubungi server installer.");
        } finally {
            setProvisioning(false);
        }
    };

    const handleVerifyToken = async (e) => {
        e.preventDefault();
        if (!tokenInput.trim()) {
            notify("error", "Masukkan Discord Bot Token terlebih dahulu.");
            return;
        }
        setVerifyingToken(true);
        setTokenResult(null);
        try {
            const res = await verifyDiscordTokenSecure(tokenInput);
            setTokenResult(res.data);
            if (res.ok && res.data?.valid) {
                notify("success", "Discord Bot Token valid!");
                onRefreshSession();
            } else {
                notify("error", res.data?.error || "Discord Bot Token tidak valid.");
            }
        } catch {
            notify("error", "Gagal memvalidasi token.");
        } finally {
            setVerifyingToken(false);
        }
    };

    const handleTestApiConnection = async () => {
        setTestingApi(true);
        setApiTestResult(null);
        try {
            if (activeInstallation) {
                const res = await testAuthenticatedCloudPing();
                setApiTestResult(res.data);
                if (res.ok) {
                    notify("success", `Koneksi Cloud API sukses (${res.data.latencyMs} ms)!`);
                    onRefreshSession();
                } else {
                    notify("error", res.data?.error || "Pengujian koneksi API gagal.");
                }
            } else {
                const start = Date.now();
                const res = await fetch("/api/v1/health");
                const json = await res.json();
                const ms = Date.now() - start;
                setApiTestResult({
                    ok: Boolean(json?.ok),
                    latencyMs: ms,
                    mongodbService: json?.mongodbService?.statusText || "Operational",
                    note: "Buat Installation ID pada Langkah 1 untuk menguji koneksi tenant terautentikasi.",
                });
                if (json?.ok) {
                    notify("success", `Endpoint API publik aktif (${ms} ms)!`);
                }
            }
        } catch {
            notify("error", "Tidak dapat menjangkau server API.");
        } finally {
            setTestingApi(false);
        }
    };

    const handleManualStageCheck = async (stageKey) => {
        if (!activeInstallation) {
            notify("error", "Buat Installation ID terlebih dahulu pada Langkah 1 untuk menyimpan progres tahapan.");
            return;
        }
        const res = await markInstallationStage(stageKey);
        if (res.ok) {
            onRefreshSession();
            notify("success", "Status tahapan diperbarui.");
        }
    };

    return (
        <div className="container page-anim">
            {/* Page Header & Stage Progress Tracker */}
            <section className="card" style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                    <div>
                        <span className="badge badge-purple">Panduan & Wizard Instalasi Termux</span>
                        <h1 style={{ fontSize: "1.45rem", fontWeight: 900, marginTop: 6 }}>Instalasi Lagukan di Termux Android</h1>
                        <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)" }}>
                            Ikuti langkah otomatis di bawah ini. Seluruh penyimpanan database terhubung aman ke Cloud pusat milik Lagukan
                            tanpa perlu mengisi MongoDB URI.
                        </p>
                    </div>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={onRefreshSession}>
                        <RefreshCw size={14} />
                        Sinkronkan Status
                    </button>
                </div>

                <div style={{ marginTop: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", fontWeight: 700 }}>
                        <span>
                            Progres Tahapan Instalasi{" "}
                            {activeInstallation ? `(${activeInstallation.installationId})` : "(Belum ada sesi aktif)"}
                        </span>
                        <span style={{ color: "var(--purple-soft)" }}>
                            {completedStages.length}/{STAGE_LABELS.length} Tahap ({progressPercent}%)
                        </span>
                    </div>
                    <div className="progress-wrap">
                        <div className="progress-fill" style={{ width: `${Math.max(progressPercent, 4)}%` }} />
                    </div>

                    <div className="stages-grid">
                        {STAGE_LABELS.map((st) => {
                            const done = completedStages.includes(st.key);
                            return (
                                <button
                                    type="button"
                                    key={st.key}
                                    onClick={() => !done && handleManualStageCheck(st.key)}
                                    className={`stage-item ${done ? "done" : ""}`}
                                    style={{ cursor: activeInstallation && !done ? "pointer" : "default", textAlign: "left" }}
                                    title={done ? "Tahap selesai" : "Klik untuk menandai selesai jika dijalankan manual"}
                                >
                                    {done ? (
                                        <CheckCircle2 size={16} color="#4ade80" style={{ flexShrink: 0 }} />
                                    ) : (
                                        <Circle size={16} color="#7e799c" style={{ flexShrink: 0 }} />
                                    )}
                                    <span>{st.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </section>

            {/* STEP 1: Provision Installation ID */}
            <section className="card" style={{ marginBottom: 18 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <span className="badge badge-purple">Langkah 1</span>
                    <h2 style={{ fontSize: "1.1rem", fontWeight: 800 }}>Buat Identitas Instalasi Terisolasi (Installation ID)</h2>
                </div>
                <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)", marginBottom: 14 }}>
                    Buat <strong>Installation ID</strong> agar data server Discord, playlist, favorit, dan level profil pada bot Anda
                    terpisah 100% dari pengguna lain di database pusat, sekaligus mengaktifkan akses ke <strong>Dashboard Pengguna</strong>.
                </p>

                {!activeInstallation ? (
                    <form onSubmit={handleCreateInstallation} style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                        <input
                            type="text"
                            className="text-input"
                            style={{ flex: "1 1 240px" }}
                            maxLength={50}
                            value={deviceLabel}
                            onChange={(e) => setDeviceLabel(e.target.value)}
                            placeholder="Nama perangkat (contoh: Redmi Note Termux)"
                        />
                        <button type="submit" className="btn btn-primary" disabled={provisioning}>
                            <KeyRound size={17} />
                            {provisioning ? "Membuat Sesi..." : "Buat Installation ID Baru"}
                        </button>
                    </form>
                ) : (
                    <div className="alert-box alert-info" style={{ flexDirection: "column" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", width: "100%", flexWrap: "wrap", gap: 8 }}>
                            <strong>Sesi Instalasi Aktif: {activeInstallation.installationId}</strong>
                            <span className="badge badge-ok">Tersambung ke Dashboard</span>
                        </div>

                        <div className="cmd-box" style={{ width: "100%" }}>
                            <code className="cmd-text">{activeInstallation.installationId}</code>
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() =>
                                    onCopyText(activeInstallation.installationId, "inst-id", "Installation ID berhasil disalin!")
                                }
                            >
                                {copiedKey === "inst-id" ? <Check size={14} /> : <Copy size={14} />}
                                Salin ID
                            </button>
                        </div>

                        {provisionedKey && (
                            <div style={{ width: "100%", marginTop: 8 }}>
                                <div style={{ fontSize: "0.8rem", color: "#fde68a", fontWeight: 700 }}>
                                    Simpan Access Key berikut di tempat aman (hanya ditampilkan satu kali untuk login Dashboard & Termux):
                                </div>
                                <div className="cmd-box" style={{ width: "100%" }}>
                                    <code className="cmd-text">{provisionedKey}</code>
                                    <button
                                        type="button"
                                        className="btn btn-primary btn-sm"
                                        onClick={() => onCopyText(provisionedKey, "inst-key", "Installation Access Key berhasil disalin!")}
                                    >
                                        {copiedKey === "inst-key" ? <Check size={14} /> : <Copy size={14} />}
                                        Salin Key
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </section>

            {/* STEP 2: One-Line Automatic Termux Installer */}
            <section className="card" style={{ marginBottom: 18 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <span className="badge badge-purple">Langkah 2 (Direkomendasikan)</span>
                    <h2 style={{ fontSize: "1.1rem", fontWeight: 800 }}>Jalankan Satu Perintah Instalasi Otomatis di Termux</h2>
                </div>
                <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)" }}>
                    Buka aplikasi <strong>Termux</strong> di HP Android Anda, tempel perintah berikut, lalu tekan <strong>Enter</strong>.
                    Script otomatis memeriksa paket sistem, meng-clone repository resmi, menginstal dependencies, menanyakan Discord Bot
                    Token secara tersembunyi, dan menguji koneksi API.
                </p>

                <div className="cmd-box">
                    <code className="cmd-text">{oneLineCommand}</code>
                    <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => onCopyText(oneLineCommand, "install-one", "Perintah instalasi disalin ke clipboard!")}
                    >
                        {copiedKey === "install-one" ? <Check size={15} /> : <Copy size={15} />}
                        {copiedKey === "install-one" ? "Tersalin" : "Salin Perintah"}
                    </button>
                </div>

                <div className="alert-box alert-info">
                    <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div>
                        <strong>Perlindungan Folder Pengguna:</strong> Apabila folder <code>~/Lagukan</code> sudah ada di Termux Anda,
                        installer <strong>tidak pernah menimpa atau menghapus file secara otomatis</strong>, melainkan menampilkan pilihan{" "}
                        <em>Update Aman</em> atau <em>Backup Folder Lama</em>.
                    </div>
                </div>
            </section>

            {/* STEP 3: System Requirements & Manual Step Reference */}
            <section className="card" style={{ marginBottom: 18 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <span className="badge badge-purple">Langkah 3</span>
                    <h2 style={{ fontSize: "1.1rem", fontWeight: 800 }}>
                        Pengecekan Kebutuhan Sistem (Node.js, Git, FFmpeg, & Java Opsional)
                    </h2>
                </div>
                <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)", marginBottom: 10 }}>
                    Installer otomatis sudah menangani instalasi paket di bawah ini. Jika Anda ingin memeriksa atau menjalankannya secara
                    manual di Termux:
                </p>

                <div className="grid-2" style={{ marginBottom: 12 }}>
                    <div
                        style={{
                            padding: 13,
                            borderRadius: 11,
                            background: "rgba(255,255,255,0.03)",
                            border: "1px solid var(--border-subtle)",
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: "0.9rem" }}>
                            <Cpu size={16} color="#c084fc" /> Paket Wajib Bot
                        </div>
                        <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", marginTop: 4 }}>
                            • <strong>Node.js v18+</strong> (<code>nodejs-lts</code>)<br />• <strong>Git</strong> & <strong>Curl</strong>
                            <br />• <strong>FFmpeg</strong> (utilitas pendukung audio)
                        </p>
                    </div>

                    <div
                        style={{
                            padding: 13,
                            borderRadius: 11,
                            background: "rgba(255,255,255,0.03)",
                            border: "1px solid var(--border-subtle)",
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: "0.9rem" }}>
                            <Terminal size={16} color="#c084fc" /> Paket Opsional (Java)
                        </div>
                        <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", marginTop: 4 }}>
                            • <strong>OpenJDK 17+</strong> hanya diperlukan jika Anda menjalankan server <code>Lavalink.jar</code> lokal di
                            Ubuntu <code>proot-distro</code>. Untuk Termux murni, gunakan host Lavalink v4 eksternal.
                        </p>
                    </div>
                </div>

                <label className="field-label">Perintah Cek & Install Paket Wajib Termux:</label>
                <div className="cmd-box">
                    <code className="cmd-text">{reqCheckCommand}</code>
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => onCopyText(reqCheckCommand, "req-cmd", "Perintah paket sistem disalin!")}
                    >
                        {copiedKey === "req-cmd" ? <Check size={14} /> : <Copy size={14} />}
                        Salin
                    </button>
                </div>

                <label className="field-label" style={{ marginTop: 12 }}>
                    Opsional — Install Java OpenJDK 17 (hanya bila diperlukan):
                </label>
                <div className="cmd-box">
                    <code className="cmd-text">{javaOptionalCommand}</code>
                    <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => onCopyText(javaOptionalCommand, "java-cmd", "Perintah instalasi Java disalin!")}
                    >
                        {copiedKey === "java-cmd" ? <Check size={14} /> : <Copy size={14} />}
                        Salin
                    </button>
                </div>

                <label className="field-label" style={{ marginTop: 12 }}>
                    Clone Repository Aman & Instalasi Dependencies Manual:
                </label>
                <div className="cmd-box">
                    <code className="cmd-text">{cloneManualCommand}</code>
                    <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => onCopyText(cloneManualCommand, "clone-cmd", "Perintah clone aman disalin!")}
                    >
                        {copiedKey === "clone-cmd" ? <Check size={14} /> : <Copy size={14} />}
                        Salin
                    </button>
                </div>
                <div className="cmd-box">
                    <code className="cmd-text">{npmInstallCommand}</code>
                    <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => onCopyText(npmInstallCommand, "npm-cmd", "Perintah npm install disalin!")}
                    >
                        {copiedKey === "npm-cmd" ? <Check size={14} /> : <Copy size={14} />}
                        Salin
                    </button>
                </div>
            </section>

            {/* STEP 4: Secure Discord Bot Token Validator + API Connection Tester */}
            <div className="grid-2" style={{ marginBottom: 18 }}>
                <section className="card">
                    <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
                        <Shield size={18} color="#c084fc" />
                        <h2 style={{ fontSize: "1.05rem", fontWeight: 800 }}>Langkah 4 • Validasi Discord Bot Token</h2>
                    </div>
                    <p style={{ fontSize: "0.84rem", color: "var(--text-secondary)", marginBottom: 12 }}>
                        Uji apakah format & Application ID token Discord Bot Anda valid sebelum dipasang di Termux. Token dikirim melalui
                        HTTPS POST, <strong>tidak pernah masuk URL, log, ataupun disimpan di database</strong>.
                    </p>

                    <form onSubmit={handleVerifyToken}>
                        <label className="field-label" htmlFor="discord-token-input">
                            Discord Bot Token
                        </label>
                        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                            <input
                                id="discord-token-input"
                                type={showToken ? "text" : "password"}
                                autoComplete="off"
                                spellCheck={false}
                                className="text-input"
                                value={tokenInput}
                                onChange={(e) => setTokenInput(e.target.value)}
                                placeholder="Tempel Bot Token dari Discord Developer Portal..."
                            />
                            <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => setShowToken((v) => !v)}
                                title={showToken ? "Sembunyikan Token" : "Tampilkan Token"}
                            >
                                {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>

                        <button type="submit" className="btn btn-primary btn-sm" style={{ width: "100%" }} disabled={verifyingToken}>
                            {verifyingToken ? "Memeriksa Token..." : "Validasi Discord Token"}
                        </button>
                    </form>

                    {tokenResult && (
                        <div className={`alert-box ${tokenResult.valid ? "alert-ok" : "alert-err"}`}>
                            <div>
                                <strong>{tokenResult.valid ? "✅ Token Valid" : "❌ Token Tidak Valid"}</strong>
                                <div style={{ marginTop: 3 }}>{tokenResult.message || tokenResult.error}</div>
                                {tokenResult.bot?.id && (
                                    <div style={{ marginTop: 4, fontSize: "0.8rem" }}>
                                        Bot Application ID: <code>{tokenResult.bot.id}</code>
                                        {tokenResult.bot.username ? ` (@${tokenResult.bot.username})` : ""}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </section>

                <section className="card">
                    <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
                        <Wifi size={18} color="#c084fc" />
                        <h2 style={{ fontSize: "1.05rem", fontWeight: 800 }}>Langkah 5 • Pengujian Koneksi Cloud API</h2>
                    </div>
                    <p style={{ fontSize: "0.84rem", color: "var(--text-secondary)", marginBottom: 12 }}>
                        Pastikan perangkat Anda dapat berkomunikasi dengan <strong>Lagukan Cloud Database Gateway</strong> dan isolasi
                        tenant <code>installationId</code> berjalan optimal.
                    </p>

                    <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ width: "100%" }}
                        onClick={handleTestApiConnection}
                        disabled={testingApi}
                    >
                        <Wifi size={16} />
                        {testingApi ? "Menguji Koneksi..." : "Uji Koneksi API Sekarang"}
                    </button>

                    {apiTestResult && (
                        <div className={`alert-box ${apiTestResult.ok ? "alert-ok" : "alert-err"}`}>
                            <div>
                                <strong>{apiTestResult.ok ? "✅ Koneksi API Berhasil" : "❌ Koneksi API Bermasalah"}</strong>
                                <div style={{ marginTop: 4, fontSize: "0.82rem" }}>
                                    • Latency Respons: <strong>{apiTestResult.latencyMs ?? 0} ms</strong>
                                    <br />• Layanan Database Pusat: <strong>{apiTestResult.mongodbService}</strong>
                                    {apiTestResult.installationId && (
                                        <>
                                            <br />• Tenant Terautentikasi: <code>{apiTestResult.installationId}</code>
                                        </>
                                    )}
                                    {apiTestResult.note && (
                                        <>
                                            <br />• Info: {apiTestResult.note}
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </section>
            </div>

            {/* STEP 6: Instructions to Run the Bot */}
            <section className="card">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className="badge badge-ok">Langkah 6 • Menjalankan Bot</span>
                        <h2 style={{ fontSize: "1.1rem", fontWeight: 800 }}>Nyalakan Lagukan di Termux</h2>
                    </div>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => onNavigate("dashboard")}>
                        Pantau Status di Dashboard →
                    </button>
                </div>

                <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)", marginTop: 8 }}>
                    Setelah instalasi selesai, jalankan mode khusus Termux (<em>Standalone Single-Process Mode</em> tanpa Docker):
                </p>

                <div className="cmd-box">
                    <code className="cmd-text">{runBotCommand}</code>
                    <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => onCopyText(runBotCommand, "run-bot", "Perintah menjalankan bot disalin!")}
                    >
                        {copiedKey === "run-bot" ? <Check size={14} /> : <Play size={14} />}
                        {copiedKey === "run-bot" ? "Tersalin" : "Salin"}
                    </button>
                </div>

                <p style={{ fontSize: "0.84rem", color: "var(--text-muted)", marginTop: 12 }}>
                    Tips agar bot tetap menyala di latar belakang saat layar HP ditutup (jalankan <code>termux-wake-lock</code> +{" "}
                    <code>tmux</code>):
                </p>
                <div className="cmd-box">
                    <code className="cmd-text">{runTmuxCommand}</code>
                    <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => onCopyText(runTmuxCommand, "run-tmux", "Perintah tmux background disalin!")}
                    >
                        {copiedKey === "run-tmux" ? <Check size={14} /> : <Copy size={14} />}
                        Salin
                    </button>
                </div>
            </section>
        </div>
    );
}
