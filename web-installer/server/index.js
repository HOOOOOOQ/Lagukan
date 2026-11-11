const { createInstallerApp } = require("./app");
const { ensureCentralDatabaseConnection } = require("./centralDb");
const { redactSecretsFromText } = require("./security");

const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";

async function startServer() {
    const dbState = await ensureCentralDatabaseConnection();
    const app = createInstallerApp();

    const server = app.listen(PORT, HOST, () => {
        console.log(
            `[LAGUKAN INSTALLER] Server listening on http://${HOST}:${PORT} | Central DB Mode: ${dbState.mode} (connected=${dbState.connected})`,
        );
    });

    server.on("error", (err) => {
        console.error("[LAGUKAN INSTALLER] Server error:", redactSecretsFromText(err?.message || err));
        process.exit(1);
    });
}

startServer();
