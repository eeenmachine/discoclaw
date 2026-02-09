# bot-setup.md — Discord Bot Setup (New Server)

Purpose: help a new user create and invite a Discoclaw bot to their Discord server, then configure `.env` safely.

## Create The Bot (Discord Developer Portal)

1. Developer Portal: create a new application (name it e.g. `discoclaw`).
2. Bot page:
   - Add bot user.
   - Enable **Privileged Gateway Intent**: **Message Content Intent**.
   - Copy the bot token (this is `DISCORD_TOKEN`). Do not commit it.

## Invite The Bot To A Server

1. OAuth2 -> URL Generator:
   - Scopes: `bot`
   - Bot permissions (minimal):
     - View Channels
     - Send Messages
     - Send Messages in Threads
     - Read Message History
2. Generate the URL and invite to the target server.

## Configure Discoclaw (`.env`)

1. `cp .env.example .env`
2. Set:
   - `DISCORD_TOKEN=...`
   - `DISCORD_ALLOW_USER_IDS=...` (fail-closed if empty)
   - `DISCORD_CHANNEL_IDS=...` (recommended; keep minimal)
   - `DISCOCLAW_DATA_DIR=...` (Dropbox-backed data root; content defaults to `$DISCOCLAW_DATA_DIR/content`)
3. Validate:
   - `pnpm dev`
   - DM the bot (should respond only if allowlisted).
   - Post in an allowlisted channel (should respond).
   - Post in a non-allowlisted channel (should not respond).

## Getting IDs

Discord client: Settings -> Advanced -> Developer Mode, then right-click a user/channel -> Copy ID.

