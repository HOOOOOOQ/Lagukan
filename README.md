<p align="center">
<img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&height=200&section=header&text=LAGUKAN&fontSize=80&fontAlignY=35&animation=twinkling&fontColor=gradient"/>
</p>

<h1 align="center">Lagukan Music Bot</h1>

<p align="center">
  Shard-ready Discord music bot powered by Rainlink, Lavalink, and Discord.js v14.
</p>

<p align="center">

[![Version][version-shield]][version-url] [![MIT License][license-shield]][license-url] [![Contributors][contributors-shield]][contributors-url] [![Stargazers][stars-shield]][stars-url] [![Forks][forks-shield]][forks-url] [![Watchers][watchers-shield]][watchers-url] [![Issues][issues-shield]][issues-url] [![Node Version][node-shield]](#-requirements) [![Discord.js][discordjs-shield]](https://discord.js.org/#/docs/discord.js/main/general/welcome) [![Rainlink][rainlink-shield]](https://www.npmjs.com/package/rainlink)

</p>

## `🧭` Table of Contents

- [Quick Start](#-quick-start)
- [Main Features](#-main-features)
- [Requirements](#-requirements)
- [Command Overview](#-command-overview)
- [Environment Variables](#-environment-variables)
- [Configuration Notes](#-configuration-notes)
- [Installation (Local)](#-installation-local)
- [Installation (Docker)](#-installation-docker)
- [Permissions Needed](#-permissions-needed)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)
- [Contributors](#-contributors)
- [Support the Project](#-support-the-project)
- [License](#-license)

## `⚡` Quick Start

1. Clone and install:

```bash
git clone https://github.com/HOOOOOOQ/Lagukan.git
cd Lagukan
npm install
```

2. Create env file:

```bash
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

3. Fill all required keys in `.env` (`TOKEN`, `MONGO_URI`, Lavalink connection values, etc).
4. Add your dev ID in `src/settings/config.js`.
5. Start MongoDB + Lavalink.
6. Run **Lagukan Music Bot**:

```bash
npm start
```

## `📢` Main Features

- ☑️ Discord.js v14 + `discord-hybrid-sharding` architecture (auto shard/cluster mode)
- ☑️ Rainlink Lavalink client with configurable drivers (`v3` / `v4`) and voice plugin enabled
- ☑️ Full slash command music suite: play, queue, skip, loop, filter, seek, volume, etc.
- ☑️ Interactive now-playing controller with buttons (pause/resume, volume, loop, shuffle, previous, skip, stop)
- ☑️ Queue pagination with button-based navigation
- ☑️ 24/7 mode (`/247`) with reconnect persistence per guild
- ☑️ Autoplay toggle (`/autoplay`) with YouTube-only fallback behavior
- ☑️ Per-user ban system and maintenance mode (dev prefix commands)
- ☑️ MongoDB-backed guild/user state with periodic sync
- ☑️ Lyrics lookup for current song (`/lyric`)
- ☑️ Voice Channel Activity Logger (`Joined` & `Leaving` directly in active Voice Channel Text Chat) with per-guild settings (`/voicelog`)
- ☑️ Server Tag Logger (`LAGUKAN • SERVER TAG LOGGER`) in Bahasa Indonesia with MongoDB statistics (`/setlogs`, `/ceklogs`, `/resetlogs`, `/tagstats`)
- ☑️ Server Tag Auto Role (`LAGUKAN SERVER TAG AUTO ROLE`) — automatic per-guild role assignment & removal matched by official Discord Server Tag identity (`identity_guild_id`) with interactive dropdown panel (`/settagrole`, `/cektagrole`, `/resettagrole`, `/synctagrole`)
- ☑️ Custom Role System (`LAGUKAN CUSTOM ROLE SYSTEM`) — modern interactive dashboard (`/customrole` & `/customrole-config`) exclusive to Server Boosters & Admin-approved Roles, supporting custom role name, Color Picker + HEX + presets, 2/3-color & official Discord Holographic gradients with live visual PNG preview, and phone gallery attachment Role Icons (`ROLE_ICONS`)
- ☑️ **666 Text Assistant** (`666 help`) — 100% local rule-based Discord text assistant (zero external AI APIs or API keys) integrated directly with Rainlink + Lavalink music playback (`666 play <song>`, `666 pause`, `666 resume`, `666 skip`, `666 stop`, `666 volume 50`, `666 queue`, `666 sekarang putar apa`), varied natural Indonesian conversation (`666 halo`, `666 siapa kamu`, etc.), and 60 local stories across 6 categories (`666 dongengin aku`, `666 cerita horor`, `666 cerita romantis`, `666 cerita lucu`, `666 cerita fantasi`, `666 buat cerita pendek`)
- ☑️ Termux Android Standalone Mode (`npm run start:termux`) & Web Installer (`web-installer/`)
- ☑️ Auto-leave timeout when inactive/alone (configurable)

## `📌` Requirements

- Node.js **18+ (LTS)** ([Download / Docs](https://nodejs.org/en/download))
- MongoDB **5+** ([MongoDB Community Download](https://www.mongodb.com/try/download/community))
- Lavalink server ([Lavalink Docs](https://lavalink.dev/getting-started/))
- Java **17+ (LTS)** ([OpenJDK Downloads](https://adoptium.net/temurin/releases/?version=17)) (if you run your own Lavalink)
- Discord bot token ([Discord Developer Portal Guide](https://discordjs.guide/preparations/setting-up-a-bot-application.html))

## `🎛️` Command Overview

| Group | Commands |
| --- | --- |
| General | `/help`, `/ping`, `/tagstats` |
| Music | `/play`, `/queue`, `/skip`, `/previous`, `/pause`, `/resume`, `/stop`, `/seek`, `/remove`, `/clear`, `/shuffle`, `/loop`, `/filter`, `/volume`, `/join`, `/leave`, `/lyric` |
| Settings | `/247`, `/autoplay`, `/voicelog`, `/setlogs`, `/ceklogs`, `/resetlogs`, `/settagrole`, `/cektagrole`, `/resettagrole`, `/synctagrole`, `/customrole`, `/customrole-config` |

### Prefix Commands (Developer / Ops)

- `ban`, `unban`, `maintenance`, `lavalink`, `eval`, `restart`
- Loaded from `src/commands/message/dev`
- Intended for developer/admin use only (requires your Discord user ID in `dev` array in `src/settings/config.js`)

## `🔧` Environment Variables

Create a `.env` file from `.env.example`.

### General

| Key                  | Default   | Purpose                                   |
| -------------------- | --------- | ----------------------------------------- |
| `BOT_NAME`           | `Lagukan` | Discord bot name                          |
| `TOKEN`              | -         | Discord bot token                         |
| `PREFIX`             | `!`       | Prefix for dev message commands           |
| `EMBED_COLOR`        | `5865F2`  | Embed hex color (without `#`)             |
| `LEAVE_TIMEOUT`      | `60000`   | Inactivity timeout before leaving VC (ms) |
| `DEFAULT_VOLUME`     | `100`     | Initial player volume                     |
| `MIN_VOLUME`         | `1`       | Minimum volume                            |
| `MAX_VOLUME`         | `100`     | Maximum volume                            |
| `MONGO_URI`          | -         | MongoDB connection string                 |
| `SUPPORT_SERVER_URL` | -         | Support button URL                        |
| `DEBUG`              | `false`   | Enable debug logs when `true`             |

### Voice Activity Logger

| Key                 | Default        | Purpose                                                                            |
| ------------------- | -------------- | ---------------------------------------------------------------------------------- |
| `VOICE_LOG_ENABLED` | `true`         | Enable/disable Voice Activity Logger in active Voice Channel Chat (`true`/`false`) |
| `TIMEZONE`          | `Asia/Jakarta` | Timezone for voice log timestamps (e.g. WIB)                                       |

### Server Tag Logger

| Key | Default | Purpose |
| --- | --- | --- |
| `SERVER_MEMBERS_INTENT` | `true` | Enables `GuildMembers` Gateway intent for real-time `User.primaryGuild` Server Tag detection via `/setlogs` |

### Lavalink Connection

| Key                 | Default             | Purpose                                   |
| ------------------- | ------------------- | ----------------------------------------- |
| `LAVALINK_NAME`     | `Lagukan`           | Node name                                 |
| `LAVALINK_HOST`     | `localhost`         | Lavalink host                             |
| `LAVALINK_PORT`     | `2333`              | Lavalink port                             |
| `LAVALINK_PASSWORD` | `youshallnotpass`   | Lavalink password                         |
| `LAVALINK_SECURE`   | `false`             | Use secure connection (`true` / `false`)  |
| `LAVALINK_DRIVER`   | `lavalink/v4/koinu` | Rainlink driver for your Lavalink version |

### Rainlink Search

| Key                      | Default        | Purpose                           |
| ------------------------ | -------------- | --------------------------------- |
| `LAVALINK_SOURCE`        | `sp`           | Source ID used for `/play` search |
| `DEFAULT_SEARCH_ENGINE`  | `youtubeMusic` | Primary search engine             |
| `SEARCH_FALLBACK_ENGINE` | `youtube`      | Fallback search engine            |

> Notes:
>
> - Spotify/Apple/Deezer/Others source support depends on your Lavalink plugins and Lavalink server configuration.

## `⚙️` Configuration Notes

### 1) Developer IDs

Edit `src/settings/config.js`:

```js
dev: ["123456789012345678"],
```

These IDs can access developer-only flows and bypass maintenance lock.

### 2) Emoji Mapping

Customize player and pagination emojis in `src/settings/emoji.js`.

### 3) Lavalink Source IDs

`LAVALINK_SOURCE` should match source IDs enabled in Lavalink.

Examples:

- `yt` -> YouTube search (`ytsearch`)
- `ytm` -> YouTube Music search (`ytmsearch`)
- `sc` -> SoundCloud search (`scsearch`)
- `sp` -> Spotify search (`spsearch`) when plugin/source is enabled
- `am` -> Apple Music search (`amsearch`) when plugin/source is enabled
- `dz` -> Deezer search (`dzsearch`) when plugin/source is enabled

> Use only IDs supported by your Lavalink server/plugins.
>
> LavaSrc reference (supported URLs & queries): [https://github.com/topi314/LavaSrc?tab=readme-ov-file#supported-urls-and-queries](https://github.com/topi314/LavaSrc?tab=readme-ov-file#supported-urls-and-queries)

## `🚀` Installation (Local)

1. Clone repository:

```bash
git clone https://github.com/HOOOOOOQ/Lagukan.git
cd Lagukan
```

2. Install dependencies:

```bash
npm install
```

3. Configure environment:

```bash
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

4. Fill all required keys in `.env`
5. Configure developer IDs in `src/settings/config.js`
6. Start Lavalink + MongoDB
7. Start **Lagukan Music Bot**:

```bash
npm start
```

## `🐳` Installation (Docker)

This repository includes:

- `Dockerfile` for the Lagukan bot image
- `docker-compose.yml` for Lagukan bot + MongoDB

### Important

- Lavalink is **external** in current compose setup.
- Set `LAVALINK_HOST` to your Lavalink host (`host.docker.internal` is used as compose default).

### Run

```bash
docker compose up -d --build
```

### Stop

```bash
docker compose down
```

## `🔐` Permissions Needed

At minimum, ensure **Lagukan** can:

- `ViewChannel`
- `SendMessages`
- `EmbedLinks`
- `ReadMessageHistory`
- `Connect`
- `Speak`

For stage channels, also allow:

- `RequestToSpeak`
- `PrioritySpeaker`

## `🧪` Troubleshooting

- **Bot offline**: verify `TOKEN` and intents in Discord Developer Portal
- **No music playback**: verify Lavalink host/port/password/driver and Java/Lavalink logs
- **Autoplay not working**: autoplay currently depends on YouTube track context
- **Leaves VC too quickly**: increase `LEAVE_TIMEOUT` or enable `/247`
- **No DB persistence**: verify `MONGO_URI` connectivity
- **Missing debug output**: set `DEBUG=true`

## 💖 Support the Project

If you find **Lagukan Music Bot** useful, consider starring the repository and supporting continued development:

<p align="center">
  <a href="https://github.com/HOOOOOOQ/Lagukan">
    <img src="https://img.shields.io/badge/GitHub-Star_Repository-181717?style=for-the-badge&logo=github" alt="Star Repository"/>
  </a>
  <a href="https://github.com/sponsors/HOOOOOOQ">
    <img src="https://img.shields.io/badge/GitHub_Sponsors-Support-ea4aaa?style=for-the-badge&logo=github-sponsors" alt="GitHub Sponsors"/>
  </a>
</p>

## `🤝` Contributing

Contributions are welcome.

- Read [CONTRIBUTING.md](CONTRIBUTING.md) for contribution flow and standards.
- Open an issue before major changes.
- Keep pull requests focused and clearly described.

## `👥` Contributors

<a href="https://github.com/HOOOOOOQ/Lagukan/graphs/contributors">
  <img src="https://contributors-img.web.app/image?repo=HOOOOOOQ/Lagukan" />
</a>

## `🔐` License

This project is licensed under the [MIT License](https://github.com/HOOOOOOQ/Lagukan/blob/main/LICENSE).

---

<p align="center">
  <b>Lagukan Music Bot</b><br/>
  <sub>Lagukan Music Bot • Built for Excellence</sub>
</p>

<p align="center">
<img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&height=100&section=footer"/>
</p>

[version-shield]: https://img.shields.io/github/package-json/v/HOOOOOOQ/Lagukan?style=for-the-badge
[contributors-shield]: https://img.shields.io/github/contributors/HOOOOOOQ/Lagukan.svg?style=for-the-badge
[contributors-url]: https://github.com/HOOOOOOQ/Lagukan/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/HOOOOOOQ/Lagukan.svg?style=for-the-badge
[forks-url]: https://github.com/HOOOOOOQ/Lagukan/network/members
[watchers-shield]: https://img.shields.io/github/watchers/HOOOOOOQ/Lagukan?style=for-the-badge
[watchers-url]: https://github.com/HOOOOOOQ/Lagukan
[stars-shield]: https://img.shields.io/github/stars/HOOOOOOQ/Lagukan.svg?style=for-the-badge
[stars-url]: https://github.com/HOOOOOOQ/Lagukan/stargazers
[issues-shield]: https://img.shields.io/github/issues/HOOOOOOQ/Lagukan.svg?style=for-the-badge
[issues-url]: https://github.com/HOOOOOOQ/Lagukan/issues
[license-shield]: https://img.shields.io/github/license/HOOOOOOQ/Lagukan.svg?style=for-the-badge
[license-url]: https://github.com/HOOOOOOQ/Lagukan/blob/main/LICENSE
[version-url]: https://github.com/HOOOOOOQ/Lagukan/blob/main/package.json
[node-shield]: https://img.shields.io/badge/Node-18%2B-43853d?logo=node.js&logoColor=white&style=for-the-badge
[discordjs-shield]: https://img.shields.io/badge/discord.js-v14-5865F2?logo=discord&logoColor=white&style=for-the-badge
[rainlink-shield]: https://img.shields.io/badge/Lavalink%20Client-Rainlink-00bcd4?style=for-the-badge
