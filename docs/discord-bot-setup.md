# Discoclaw Discord Bot Setup

This walks you through creating a fresh Discord bot for Discoclaw and configuring the repo to use it.

## 1) Create The Bot

1. Go to the Discord Developer Portal and create a new application.
2. Open the application -> **Bot** -> **Add Bot**.
3. Turn on:
   - **Message Content Intent** (required for reading message content in guild channels)
4. Copy the bot token (you will put this in `.env` as `DISCORD_TOKEN`).

## 2) Invite The Bot To Your Server

Use the Developer Portal:

1. OAuth2 -> URL Generator
2. Scopes:
   - `bot`
3. Bot permissions (minimal recommended):
   - View Channels
   - Send Messages
   - Send Messages in Threads
   - Read Message History
4. Open the generated URL, pick your server, and authorize.

## 3) Get User/Channel IDs

1. Discord client -> Settings -> Advanced -> enable **Developer Mode**
2. Right-click:
   - your user -> Copy ID (use this in `DISCORD_ALLOW_USER_IDS`)
   - a channel -> Copy ID (use this in `DISCORD_CHANNEL_IDS`)

## 4) Configure Discoclaw

```bash
cp .env.example .env
pnpm i
```

Edit `.env`:
- `DISCORD_TOKEN=...`
- `DISCORD_ALLOW_USER_IDS=...` (required; if empty, the bot responds to nobody)
- `DISCORD_CHANNEL_IDS=...` (recommended for servers)
- `DISCOCLAW_DATA_DIR=...` (optional; defaults workspace/content under this folder)

Run:

```bash
pnpm dev
```

## 5) Validate

- DM the bot: it should respond only if your user ID is allowlisted.
- Post in an allowlisted channel: it should respond.
- Post in a non-allowlisted channel: it should not respond.
- Create a new channel and post once: Discoclaw should auto-create a stub context file under `content/discord/channels/` and add it to `content/discord/DISCORD.md`.

