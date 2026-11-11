const { EmbedBuilder } = require("discord.js");
const { createPage } = require("../../../functions/createPage.js");
const { fetchNodeCapabilities, scoreNodeHealth } = require("../../../functions/nodeHealthManager.js");
const lodash = require("lodash");
const Logger = require("../../../utils/logger");

module.exports = {
    name: "lavalink",
    aliases: ["node"],
    description: "View Lagukan Lavalink status",
    category: "dev",
    permissions: {
        bot: [],
        user: [],
    },
    settings: {
        voice: false,
        player: false,
        current: false,
    },
    devOnly: true,
    run: async (client, message) => {
        const ms = (await import("pretty-ms")).default;
        const embed = new EmbedBuilder().setColor(client.config.embedColor);

        try {
            const nodes = client.rainlink.nodes.all();

            if (!nodes || nodes.length === 0) {
                embed.setDescription(`No lavalink nodes found.`);

                return message.reply({ embeds: [embed] });
            }

            const nodeInfoList = await Promise.all(
                nodes.map(async (node) => {
                    const online = node.online ? "Online" : "Offline";
                    const { players, playingPlayers: playing, uptime, memory, cpu } = node.stats;
                    const formattedUptime = ms(uptime || 0, { compact: true });
                    const caps = await fetchNodeCapabilities(node).catch(() => null);
                    const score = scoreNodeHealth(node);

                    const nodeMeta = {
                        name: node.options.name,
                        host: node.options.host,
                        port: node.options.port,
                        auth: "[REDACTED]",
                        secure: node.options.secure,
                        driver: node.options.driver,
                        version: caps?.version || "unknown",
                        sources: caps?.sourceManagers?.length ? caps.sourceManagers.join(", ") : "unknown",
                        plugins: caps?.plugins?.length ? caps.plugins.map((p) => `${p.name}@${p.version}`).join(", ") : "none",
                        healthScore: Number.isFinite(score) ? score.toFixed(1) : "offline",
                    };

                    const memoryInfo = {
                        used: (memory.used / 1024 / 1024).toFixed(2),
                        free: (memory.free / 1024 / 1024).toFixed(2),
                        allocated: (memory.allocated / 1024 / 1024).toFixed(2),
                        reservable: (memory.reservable / 1024 / 1024).toFixed(2),
                    };

                    const cpuInfo = {
                        cores: cpu.cores,
                        systemLoad: (cpu.systemLoad * 100).toFixed(2),
                        lavalinkLoad: (cpu.lavalinkLoad * 100).toFixed(2),
                    };

                    return formatNodeInfo(nodeMeta, online, players, playing, formattedUptime, memoryInfo, cpuInfo);
                }),
            );

            const pages = lodash.chunk(nodeInfoList, 1).map((s) => s.join(""));

            return createPage(client, message, embed, pages);
        } catch (error) {
            Logger.error("Failed to fetch Lavalink node information:", error);
            embed.setDescription(`An error occurred while fetching the Lavalink node information.`);

            return message.reply({ embeds: [embed] });
        }
    },
};

function formatNodeInfo(nodeInfo, online, players, playing, formattedUptime, memoryInfo, cpuInfo) {
    return `\`\`\`yaml
- General Info
  - Name: ${nodeInfo.name}
  - Host: ${nodeInfo.host}
  - Port: ${nodeInfo.port}
  - Auth: ${nodeInfo.auth}
  - Secure: ${nodeInfo.secure}
  - Driver: ${nodeInfo.driver}
  - Version: ${nodeInfo.version}
  - Sources: ${nodeInfo.sources}
  - Plugins: ${nodeInfo.plugins}

- Status Info
  - Connection: ${online}
  - Health Score: ${nodeInfo.healthScore}
  - Players: ${players}
  - Playing: ${playing}
  - Uptime: ${formattedUptime}

- Memory Info
  - Used: ${memoryInfo.used}MB
  - Free: ${memoryInfo.free}MB
  - Allocated: ${memoryInfo.allocated}MB
  - Reservable: ${memoryInfo.reservable}MB

- CPU Info
  - Cores: ${cpuInfo.cores}
  - System Load: ${cpuInfo.systemLoad}%
  - Lavalink Load: ${cpuInfo.lavalinkLoad}%
\`\`\``;
}

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
