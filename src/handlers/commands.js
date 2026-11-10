const { readdirSync } = require("node:fs");
const path = require("node:path");
const Logger = require("../utils/logger");

module.exports = (client) => {
    try {
        const data = [];
        const interactionRoot = path.join(__dirname, "../commands/interaction");

        readdirSync(interactionRoot).forEach((dir) => {
            const dirPath = path.join(interactionRoot, dir);
            const commands = readdirSync(dirPath).filter((file) => file.endsWith(".js"));

            for (const file of commands) {
                const pull = require(path.join(dirPath, file));

                if (pull.name) {
                    client.slash.set(pull.name, pull);
                    data.push(pull);
                } else {
                    continue;
                }
            }
        });

        const syncGuildCommands = async (guild) => {
            if (!guild?.commands?.set) return false;

            try {
                await guild.commands.set(data);
                return true;
            } catch (err) {
                const code = err?.code;
                if (code === 50001) {
                    const inviteFixUrl = client.user?.id
                        ? `https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`
                        : "Discord Developer Portal -> OAuth2 -> URL Generator (bot + applications.commands)";
                    Logger.warn(
                        `Slash command ditolak di server "${guild.name}" (${guild.id}) karena scope "applications.commands" belum diizinkan. Buka link berikut untuk mengaktifkannya tanpa kick bot: ${inviteFixUrl}`,
                    );
                } else {
                    Logger.error(`Gagal mendaftarkan slash command di server "${guild.name}" (${guild.id}):`, err);
                }
                return false;
            }
        };

        client.on("clientReady", async () => {
            try {
                const guilds = [...client.guilds.cache.values()];
                let syncedGuilds = 0;

                for (const guild of guilds) {
                    const ok = await syncGuildCommands(guild);
                    if (ok) syncedGuilds += 1;
                }

                // Clear global commands on cluster 0 when guild sync is active to avoid duplicate command entries,
                // or fall back to global registration if bot is not in any guild yet.
                const isPrimaryCluster = !client.cluster || client.cluster.id === 0;
                if (isPrimaryCluster && client.application?.commands?.set) {
                    if (guilds.length > 0 && syncedGuilds > 0) {
                        await client.application.commands.set([]).catch(() => {});
                    } else if (guilds.length === 0) {
                        await client.application.commands.set(data);
                    }
                }

                Logger.info(`${client.slash.size} Slash commands loaded & synced instantly to ${syncedGuilds}/${guilds.length} server`);
            } catch (syncError) {
                Logger.error("Failed to register slash commands with Discord API:", syncError);
            }
        });

        // Automatically sync all slash commands instantly whenever Lagukan joins a new server
        client.on("guildCreate", async (guild) => {
            const ok = await syncGuildCommands(guild);
            if (ok) {
                Logger.info(`${client.slash.size} Slash commands synced instantly to new server "${guild.name}" (${guild.id})`);
            }
        });
    } catch (error) {
        Logger.error("Failed to load slash commands:", error);
    }

    try {
        const messageRoot = path.join(__dirname, "../commands/message");

        readdirSync(messageRoot).forEach((dir) => {
            const dirPath = path.join(messageRoot, dir);
            const commands = readdirSync(dirPath).filter((file) => file.endsWith(".js"));

            for (const file of commands) {
                const command = require(path.join(dirPath, file));

                if (command.name) {
                    client.prefix.set(command.name, command);
                } else {
                    continue;
                }

                if (command.aliases && Array.isArray(command.aliases)) {
                    command.aliases.map((alias) => client.aliases.set(alias, command.name));
                }
            }
        });

        Logger.info(`${client.prefix.size} Prefix commands loaded`);
    } catch (error) {
        Logger.error("Failed to load prefix commands:", error);
    }
};

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
