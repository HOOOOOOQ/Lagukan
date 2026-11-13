const { Client, Collection, GatewayIntentBits, Partials } = require("discord.js");
const { ClusterClient, getInfo } = require("discord-hybrid-sharding");
const { Rainlink, Library } = require("rainlink");
const config = require("../settings/config.js");
const { initializeNodeHealthManager } = require("../functions/nodeHealthManager.js");
const Logger = require("../utils/logger");

class LagukanClient extends Client {
    constructor(customOptions = {}) {
        const intents = [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildVoiceStates,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
        ];

        let shardInfo = null;
        if (!customOptions.standalone) {
            try {
                shardInfo = getInfo();
            } catch {
                shardInfo = null;
            }
        }

        const clientOptions = {
            failIfNotExists: true,
            allowedMentions: {
                parse: ["roles", "users"],
                repliedUser: false,
            },
            intents,
            partials: [Partials.User, Partials.Message, Partials.Channel],
        };

        if (shardInfo) {
            clientOptions.shards = shardInfo.SHARD_LIST;
            clientOptions.shardCount = shardInfo.TOTAL_SHARDS;
        }

        super(clientOptions);

        this.config = customOptions.config ? { ...config, ...customOptions.config } : config;
        this.guildData = require("../databases/schema/guild.js");
        this.userData = require("../databases/schema/user.js");
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
        this.profile666StatsData = require("../databases/schema/profile666Stats.js");
        this.userGuildAchievementData = require("../databases/schema/userGuildAchievement.js");
        this.musicSession666Data = require("../databases/schema/musicSession666.js");
        this.profileNotificationConfigData = require("../databases/schema/profileNotificationConfig.js");
        this.messageClaimLockData = require("../databases/schema/messageClaimLock.js");
        this.botGuildPresenceData = require("../databases/schema/botGuildPresence.js");
        this.auto247ConfigData = require("../databases/schema/auto247Config.js");

        this.messageContentFallback = false;
        this.prefix = new Collection();
        this.aliases = new Collection();
        this.slash = new Collection();
        this.data = new Map();
        this._processedInteractionIds = new Set();
        this._processedMessageIds = new Set();

        this.rainlink = new Rainlink({
            nodes: this.config.rainlinkNodes,
            library: new Library.DiscordJS(this),
            plugins: this.config.rainlinkPlugins,
            options: this.config.rainlinkOptions,
        });

        initializeNodeHealthManager(this);

        if (customOptions.token) {
            this.token = customOptions.token;
        } else if (!this.token) {
            this.token = this.config.token;
        }

        if (!this._handlersInitialized) {
            this._handlersInitialized = true;
            ["anticrash", "database", "events", "commands", "rainlink"].forEach((handler) => {
                require(`../handlers/${handler}`)(this);
            });
        }

        this.cluster = shardInfo ? new ClusterClient(this) : null;
    }

    async _fallbackWithoutMessageContentIntent(loginToken) {
        if (this.messageContentFallback || !this.options.intents.has(GatewayIntentBits.MessageContent)) {
            return null;
        }

        this.messageContentFallback = true;
        Logger.warn(
            "MESSAGE CONTENT INTENT belum diaktifkan di Discord Developer Portal! Menyambung ulang otomatis untuk Slash Command & pemutar musik.",
        );

        this.options.intents.remove(GatewayIntentBits.MessageContent);
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
                if (event?.code === 4014 && !this.messageContentFallback && this.options.intents.has(GatewayIntentBits.MessageContent)) {
                    this._fallbackWithoutMessageContentIntent(loginToken).catch((retryErr) => {
                        Logger.error(
                            "Disallowed Intents detected! Please check MESSAGE CONTENT INTENT in Discord Developer Portal.",
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

            if (errMsg.includes("Used disallowed intents") && this.options.intents.has(GatewayIntentBits.MessageContent)) {
                try {
                    return await this._fallbackWithoutMessageContentIntent(loginToken);
                } catch (retryError) {
                    Logger.error("Failed to login to Discord:", retryError);
                    throw retryError;
                }
            }

            if (errMsg.includes("Used disallowed intents")) {
                Logger.error("Disallowed Intents detected! Please verify required intents in Discord Developer Portal.");
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
