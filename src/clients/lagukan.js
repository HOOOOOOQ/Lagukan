const { Client, Collection, GatewayIntentBits, Partials } = require("discord.js");
const { ClusterClient, getInfo } = require("discord-hybrid-sharding");
const { Rainlink, Library } = require("rainlink");
const config = require("../settings/config.js");
const Logger = require("../utils/logger");

class LagukanClient extends Client {
    constructor() {
        const intents = [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildVoiceStates,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
        ];

        if (config.serverMembersIntent !== false) {
            intents.push(GatewayIntentBits.GuildMembers);
        }

        super({
            shards: getInfo().SHARD_LIST,
            shardCount: getInfo().TOTAL_SHARDS,
            failIfNotExists: true,
            allowedMentions: {
                parse: ["roles", "users", "everyone"],
                repliedUser: false,
            },
            intents,
            partials: [Partials.User, Partials.GuildMember, Partials.Message, Partials.Channel, Partials.Reaction],
        });

        this.config = config;
        this.guildData = require("../databases/schema/guild.js");
        this.userData = require("../databases/schema/user.js");
        this.serverTagConfigData = require("../databases/schema/serverTagConfig.js");
        this.serverTagMemberData = require("../databases/schema/serverTagMember.js");
        this.serverMembersIntentFallback = false;
        this.prefix = new Collection();
        this.aliases = new Collection();
        this.slash = new Collection();
        this.data = new Map();

        this.rainlink = new Rainlink({
            nodes: this.config.rainlinkNodes,
            library: new Library.DiscordJS(this),
            plugins: this.config.rainlinkPlugins,
            options: this.config.rainlinkOptions,
        });

        if (!this.token) this.token = this.config.token;

        ["anticrash", "database", "events", "commands", "rainlink"].forEach((handler) => {
            require(`../handlers/${handler}`)(this);
        });

        this.cluster = new ClusterClient(this);
    }

    async connect() {
        const loginToken = this.token || this.config.token;

        try {
            return await super.login(loginToken);
        } catch (error) {
            const errMsg = String(error?.message || error);

            if (errMsg.includes("Used disallowed intents") && this.options.intents.has(GatewayIntentBits.GuildMembers)) {
                Logger.warn(
                    "SERVER MEMBERS INTENT belum diaktifkan di Discord Developer Portal! Login ulang dalam mode kompatibilitas (aktifkan SERVER MEMBERS INTENT agar deteksi Server Tag berjalan real-time).",
                );

                this.options.intents.remove(GatewayIntentBits.GuildMembers);
                this.serverMembersIntentFallback = true;
                this.ws.destroyed = false;
                this.ws._ws = null;
                this.ws.shards.clear();
                this.token = loginToken;

                try {
                    return await super.login(loginToken);
                } catch (retryError) {
                    if (String(retryError?.message || retryError).includes("Used disallowed intents")) {
                        Logger.error(
                            "Disallowed Intents detected! Please enable MESSAGE CONTENT INTENT and SERVER MEMBERS INTENT in Discord Developer Portal.",
                        );
                    } else {
                        Logger.error("Failed to login to Discord:", retryError);
                    }

                    throw retryError;
                }
            }

            if (errMsg.includes("Used disallowed intents")) {
                Logger.error(
                    "Disallowed Intents detected! Please enable MESSAGE CONTENT INTENT (and required intents) in Discord Developer Portal.",
                );
            } else {
                Logger.error("Failed to login to Discord:", error);
            }

            throw error;
        }
    }
}

module.exports = LagukanClient;

/**
 * Project: Lagukan Music Bot
 * Repository: https://github.com/HOOOOOOQ/Lagukan
 */
