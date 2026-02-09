# bot-setup.md — Discord Bot Setup (New Server)

Purpose: help a new user create and invite a Discoclaw bot to their Discord server, then configure `.env` safely.

## Safety disclaimer (read first)

Discoclaw can execute powerful local tooling via an agent runtime connected to Discord. Treat it like production automation.

Recommended starting point:
- Use a **standalone private Discord server** for Discoclaw.
- Prefer **least privilege** bot permissions (avoid `Administrator` unless explicitly needed).
- Keep `DISCORD_ALLOW_USER_IDS` and `DISCORD_CHANNEL_IDS` tight (fail-closed if user allowlist is empty).

## Create The Bot (Discord Developer Portal)

1. Developer Portal: create a new application (name it e.g. `discoclaw`).
2. Bot page:
   - Add bot user.
   - Enable **Privileged Gateway Intent**: **Message Content Intent**.
   - Copy the bot token and paste it into `.env` immediately (this is `DISCORD_TOKEN`). Do not commit it.
     - Clipboard tip: don’t copy the Application ID until after you’ve pasted the token, or you may overwrite it.
     - If you lose it: reset the token in the Developer Portal.

## Invite The Bot To A Server

1. OAuth2 -> URL Generator:
   - Scopes: `bot`
   - Bot permissions (minimal):
     - View Channels
     - Send Messages
     - Read Message History
     - Send Messages in Threads
2. Generate the URL and invite to the target server.

Notes:
- For slash commands: add scope `applications.commands`.
- For thread creation/deletion: add `Create Public Threads`, `Create Private Threads`, `Manage Threads`.
- Prefer least privilege; `Administrator` is convenient but high risk.
- Minimal “works in threads” for threads the bot can see; private threads may require being added or extra perms.

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
