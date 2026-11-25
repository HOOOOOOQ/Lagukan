const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { generateTermuxInstallScript } = require("../web-installer/server/installScriptGen.js");

test("default brand and explicit bot name override remain distinct", () => {
    const root = path.resolve(__dirname, "..");
    const configPath = path.join(root, "src/settings/config.js");
    function getBotName(value) {
        const env = { ...process.env };
        if (value === undefined) delete env.BOT_NAME;
        else env.BOT_NAME = value;
        // Use a temporary working directory so a local .env cannot affect the result.
        const result = spawnSync(process.execPath, ["-e", `process.stdout.write(require(${JSON.stringify(configPath)}).botName)`], {
            env,
            cwd: require("node:os").tmpdir(),
            encoding: "utf8",
        });
        assert.equal(result.status, 0, result.stderr);
        return result.stdout;
    }
    assert.equal(getBotName(), "666 MUSIC");
    assert.equal(getBotName("Custom Bot"), "Custom Bot");
});

test("installer branding retains legacy connection and storage identifiers", () => {
    const script = generateTermuxInstallScript({ baseUrl: "https://example.com" });
    assert.match(script, /BOT_NAME="666 MUSIC"/);
    assert.match(script, /\$HOME\/Lagukan/);
    assert.match(script, /X-Lagukan-Installation-Id/);
    assert.match(script, /LAGUKAN_API_KEY=/);
    assert.match(script, /LAVALINK_NAME=Lagukan/);
});
