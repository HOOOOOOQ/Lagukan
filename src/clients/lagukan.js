const { Client, Collection, GatewayIntentBits, Partials } = require("discord.js");
const { ClusterClient, getInfo } = require("discord-hybrid-sharding");
const { Rainlink, Library } = require("rainlink");
const config = require("../settings/config.js");
const { attachAutoRoleGatewayListener } = require("../functions/serverTagAutoRole.js");
const { initializeNodeHealthManager } = require("../functions/nodeHealthManager.js");
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

        let shardInfo = null;
        try {
            shardInfo = getInfo();
        } catch {
            shardInfo = null;
        }

        const clientOptions = {
            failIfNotExists: true,
            allowedMentions: {
                parse: ["roles", "users", "everyone"],
                repliedUser: false,
            },
            intents,
            partials: [Partials.User, Partials.GuildMember, Partials.Message, Partials.Channel, Partials.Reaction],
        };

        if (shardInfo) {
            clientOptions.shards = shardInfo.SHARD_LIST;
            clientOptions.shardCount = shardInfo.TOTAL_SHARDS;
        }

        super(clientOptions);

        this.config = config;
        this.guildData = require("../databases/schema/guild.js");
        this.userData = require("../databases/schema/user.js");
        this.serverTagConfigData = require("../databases/schema/serverTagConfig.js");
        this.serverTagMemberData = require("../databases/schema/serverTagMember.js");
        this.serverTagAutoRoleData = require("../databases/schema/serverTagAutoRole.js");
        this.customRoleData = require("../databases/schema/customRole.js");
        this.customRoleConfigData = require("../databases/schema/customRoleConfig.js");
        this.playlistData = require("../databases/schema/playlist.js");
        this.userMusicProfileData = require("../databases/schema/userMusicProfile.js");
        this.listeningHistoryData = require("../databases/schema/listeningHistory.js");
        this.favoriteTrackData = require("../databases/schema/favoriteTrack.js");
        this.userPlaylistData = require("../databases/schema/userPlaylist.js");
        this.musicStatisticsData = require("../databases/schema/musicStatistics.js");
        this.musicWrappedData = require("../databases/schema/musicWrapped.js");
        this.musicLeaderboardData = require("../databases/schema/musicLeaderboard.js");
        this.musicRequestConfigData = require("../databases/schema/musicRequestConfig.js");
        this.djConfigData = require("../databases/schema/djConfig.js");
        this.musicPartyData = require("../databases/schema/musicParty.js");
        this.guessTheSongData = require("../databases/schema/guessTheSong.js");
        this.musicBattleData = require("../databases/schema/musicBattle.js");
        this.premiumConfigData = require("../databases/schema/premiumConfig.js");
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

        initializeNodeHealthManager(this);

        if (!this.token) this.token = this.config.token;

        ["anticrash", "database", "events", "commands", "rainlink"].forEach((handler) => {
            require(`../handlers/${handler}`)(this);
        });

        attachAutoRoleGatewayListener(this);

        this.cluster = shardInfo ? new ClusterClient(this) : null;
    }

    async _fallbackWithoutGuildMembersIntent(loginToken) {
        if (this.serverMembersIntentFallback || !this.options.intents.has(GatewayIntentBits.GuildMembers)) {
            return null;
        }

        this.serverMembersIntentFallback = true;
        Logger.warn(
            "SERVER MEMBERS INTENT belum diaktifkan di Discord Developer Portal! Menyambung ulang otomatis dalam mode kompatibilitas (aktifkan SERVER MEMBERS INTENT agar deteksi Server Tag berjalan real-time).",
        );

        this.options.intents.remove(GatewayIntentBits.GuildMembers);
        await this.ws.destroy().catch(() => {});
        this.ws.destroyed = false;
        this.ws._ws = null;
        this.ws.shards.clear();
        this.token = loginToken;

        return super.login(loginToken);
    }

    async connect() {
        const loginToken = this.token || this.config.token;

        if (!this._intentFallbackListenerAttached) {
            this._intentFallbackListenerAttached = true;

            this.on("shardDisconnect", (event) => {
                if (event?.code === 4014 && !this.serverMembersIntentFallback && this.options.intents.has(GatewayIntentBits.GuildMembers)) {
                    this._fallbackWithoutGuildMembersIntent(loginToken).catch((retryErr) => {
                        Logger.error(
                            "Disallowed Intents detected! Please enable MESSAGE CONTENT INTENT and SERVER MEMBERS INTENT in Discord Developer Portal.",
                            retryErr,
                        );
                    });
                }
            });
        }

        try {
            return await super.login(loginToken);
        } catch (error) {
            const errMsg = String(error?.message || error);

            if (errMsg.includes("Used disallowed intents") && this.options.intents.has(GatewayIntentBits.GuildMembers)) {
                try {
                    return await this._fallbackWithoutGuildMembersIntent(loginToken);
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
