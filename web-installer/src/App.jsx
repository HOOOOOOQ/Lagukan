import React, { useEffect, useState, useCallback } from "react";
import { Home, Terminal, LayoutDashboard, BookOpen, Music, CheckCircle2, AlertCircle } from "lucide-react";
import { fetchServiceHealth, fetchAuthenticatedInstallation } from "./api";
import HomePage from "./pages/HomePage";
import InstallPage from "./pages/InstallPage";
import DashboardPage from "./pages/DashboardPage";
import DocsPage from "./pages/DocsPage";

function pathToTab(pathname) {
    const p = String(pathname || "/").toLowerCase();
    if (p.startsWith("/install")) return "install";
    if (p.startsWith("/dashboard")) return "dashboard";
    if (p.startsWith("/docs")) return "docs";
    return "home";
}

function tabToPath(tab) {
    if (tab === "install") return "/install";
    if (tab === "dashboard") return "/dashboard";
    if (tab === "docs") return "/docs";
    return "/";
}

export default function App() {
    const [activeTab, setActiveTab] = useState(() => (typeof window !== "undefined" ? pathToTab(window.location.pathname) : "home"));
    const [health, setHealth] = useState(null);
    const [loadingHealth, setLoadingHealth] = useState(false);

    const [activeInstallation, setActiveInstallation] = useState(null);
    const [dashMongoService, setDashMongoService] = useState(null);
    const [provisionedKey, setProvisionedKey] = useState("");

    const [copiedKey, setCopiedKey] = useState("");
    const [toasts, setToasts] = useState([]);

    const notify = useCallback((type, text) => {
        const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        setToasts((prev) => [...prev.slice(-2), { id, type, text }]);
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 3800);
    }, []);

    const navigate = useCallback((tab) => {
        setActiveTab(tab);
        if (typeof window !== "undefined") {
            const targetPath = tabToPath(tab);
            if (window.location.pathname !== targetPath) {
                window.history.pushState({}, "", targetPath);
            }
            window.scrollTo({ top: 0, behavior: "smooth" });
        }
    }, []);

    useEffect(() => {
        const onPop = () => setActiveTab(pathToTab(window.location.pathname));
        window.addEventListener("popstate", onPop);
        return () => window.removeEventListener("popstate", onPop);
    }, []);

    const loadHealth = useCallback(async () => {
        setLoadingHealth(true);
        try {
            const res = await fetchServiceHealth();
            if (res.ok && res.data) {
                setHealth(res.data);
            }
        } catch {
            // Keep existing state if offline
        } finally {
            setLoadingHealth(false);
        }
    }, []);

    const loadSession = useCallback(async () => {
        try {
            const res = await fetchAuthenticatedInstallation();
            if (res.ok && res.data?.installation) {
                setActiveInstallation(res.data.installation);
                setDashMongoService(res.data.mongodbService || null);
            }
        } catch {
            // Unauthenticated visitor — normal
        }
    }, []);

    useEffect(() => {
        void loadHealth();
        void loadSession();
    }, [loadHealth, loadSession]);

    const handleCopyText = useCallback(
        async (text, key, successMsg = "Berhasil disalin!") => {
            try {
                if (navigator?.clipboard?.writeText) {
                    await navigator.clipboard.writeText(text);
                } else {
                    const ta = document.createElement("textarea");
                    ta.value = text;
                    ta.style.position = "fixed";
                    ta.style.opacity = "0";
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand("copy");
                    document.body.removeChild(ta);
                }
                setCopiedKey(key);
                notify("success", successMsg);
                setTimeout(() => {
                    setCopiedKey((cur) => (cur === key ? "" : cur));
                }, 2200);
            } catch {
                notify("error", "Gagal menyalin otomatis. Silakan salin teks secara manual.");
            }
        },
        [notify],
    );

    const handleProvisionSuccess = (inst, oneTimeKey) => {
        setActiveInstallation(inst);
        setProvisionedKey(oneTimeKey || "");
        void loadHealth();
    };

    const handleLoginSuccess = (inst, mongoSvc) => {
        setActiveInstallation(inst);
        setDashMongoService(mongoSvc || null);
    };

    const handleLogoutSuccess = () => {
        setActiveInstallation(null);
        setProvisionedKey("");
    };

    const navItems = [
        { key: "home", label: "Beranda", icon: Home },
        { key: "install", label: "Install", icon: Terminal },
        { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
        { key: "docs", label: "Dokumentasi", icon: BookOpen },
    ];

    const isServiceHealthy = Boolean(health?.ok && health?.mongodbService?.connected);

    return (
        <div className="app-shell">
            {/* Toast Notifications */}
            <div className="toast-stack" aria-live="polite">
                {toasts.map((t) => (
                    <div key={t.id} className={`toast-item ${t.type}`}>
                        {t.type === "success" ? (
                            <CheckCircle2 size={18} color="#4ade80" style={{ flexShrink: 0 }} />
                        ) : (
                            <AlertCircle size={18} color="#f87171" style={{ flexShrink: 0 }} />
                        )}
                        <span>{t.text}</span>
                    </div>
                ))}
            </div>

            {/* Sticky Top Header */}
            <header className="top-header">
                <div className="container nav-inner">
                    <button type="button" className="brand-btn" onClick={() => navigate("home")}>
                        <div className="brand-logo">
                            <Music size={21} color="#c084fc" />
                        </div>
                        <div>
                            <span className="brand-title">LAGUKAN INSTALLER</span>
                            <span className="brand-sub">Your Music Bot, One Step Away.</span>
                        </div>
                    </button>

                    <nav className="desktop-nav" aria-label="Navigasi Utama">
                        {navItems.map((item) => {
                            const Icon = item.icon;
                            return (
                                <button
                                    type="button"
                                    key={item.key}
                                    className={`nav-pill ${activeTab === item.key ? "active" : ""}`}
                                    onClick={() => navigate(item.key)}
                                >
                                    <Icon size={16} />
                                    {item.label}
                                </button>
                            );
                        })}
                    </nav>

                    <div className="status-chip">
                        <span className={`pulse-dot ${isServiceHealthy ? "" : "warn"}`} />
                        <span>{isServiceHealthy ? "Layanan Online" : "Menyambung..."}</span>
                    </div>
                </div>
            </header>

            {/* Active Page Content */}
            <main style={{ flex: 1 }}>
                {activeTab === "home" && (
                    <HomePage
                        health={health}
                        loadingHealth={loadingHealth}
                        onRefreshHealth={loadHealth}
                        onNavigate={navigate}
                        onCopyText={handleCopyText}
                        copiedKey={copiedKey}
                    />
                )}

                {activeTab === "install" && (
                    <InstallPage
                        health={health}
                        activeInstallation={activeInstallation}
                        provisionedKey={provisionedKey}
                        onProvisionSuccess={handleProvisionSuccess}
                        onRefreshSession={loadSession}
                        onNavigate={navigate}
                        onCopyText={handleCopyText}
                        copiedKey={copiedKey}
                        notify={notify}
                    />
                )}

                {activeTab === "dashboard" && (
                    <DashboardPage
                        activeInstallation={activeInstallation}
                        mongodbService={dashMongoService || health?.mongodbService}
                        onLoginSuccess={handleLoginSuccess}
                        onLogoutSuccess={handleLogoutSuccess}
                        onRefreshSession={loadSession}
                        onNavigate={navigate}
                        onCopyText={handleCopyText}
                        copiedKey={copiedKey}
                        notify={notify}
                    />
                )}

                {activeTab === "docs" && (
                    <DocsPage health={health} onCopyText={handleCopyText} copiedKey={copiedKey} onNavigate={navigate} />
                )}
            </main>

            {/* Footer */}
            <footer className="site-footer">
                <div className="container">
                    <strong>LAGUKAN INSTALLER</strong> — Your Music Bot, One Step Away. • Repository Resmi:{" "}
                    <a href="https://github.com/HOOOOOOQ/Lagukan" target="_blank" rel="noreferrer">
                        HOOOOOOQ/Lagukan
                    </a>
                </div>
            </footer>

            {/* Mobile Bottom Tab Bar */}
            <nav className="mobile-bottom-nav" aria-label="Navigasi Mobile">
                {navItems.map((item) => {
                    const Icon = item.icon;
                    return (
                        <button
                            type="button"
                            key={item.key}
                            className={`mobile-tab ${activeTab === item.key ? "active" : ""}`}
                            onClick={() => navigate(item.key)}
                        >
                            <Icon size={19} />
                            <span>{item.label}</span>
                        </button>
                    );
                })}
            </nav>
        </div>
    );
}
