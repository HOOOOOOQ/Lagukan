async function requestJson(url, options = {}) {
    const res = await fetch(url, {
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {}),
        },
        ...options,
    });

    let data = null;
    try {
        data = await res.json();
    } catch {
        data = { ok: false, error: `Respons server tidak valid (HTTP ${res.status})` };
    }

    if (!res.ok && data?.ok === undefined) {
        data.ok = false;
    }

    return { status: res.status, ok: Boolean(res.ok && data?.ok !== false), data };
}

export function fetchServiceHealth() {
    return requestJson("/api/v1/health", { method: "GET" });
}

export function registerNewInstallation(payload = {}) {
    return requestJson("/api/v1/installations/register", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}

export function verifyDiscordTokenSecure(token) {
    return requestJson("/api/v1/verify-token", {
        method: "POST",
        body: JSON.stringify({ token }),
    });
}

export function loginDashboard(installationId, accessKey) {
    return requestJson("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ installationId, accessKey }),
    });
}

export function logoutDashboard() {
    return requestJson("/api/v1/auth/logout", {
        method: "POST",
        body: JSON.stringify({}),
    });
}

export function fetchAuthenticatedInstallation() {
    return requestJson("/api/v1/auth/me", { method: "GET" });
}

export function testAuthenticatedCloudPing() {
    return requestJson("/api/v1/db/ping", {
        method: "POST",
        body: JSON.stringify({ version: "3.1.0", source: "web-installer" }),
    });
}

export function markInstallationStage(stage) {
    return requestJson("/api/v1/installations/stage", {
        method: "POST",
        body: JSON.stringify({ stage }),
    });
}

export function rotateInstallationAccessKey() {
    return requestJson("/api/v1/installations/rotate-key", {
        method: "POST",
        body: JSON.stringify({}),
    });
}
