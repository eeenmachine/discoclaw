---
name: discoclaw-discord-bot-setup
description: Create and invite a Discoclaw Discord bot to a server, configure required intents/permissions, and generate/verify local .env settings for Discoclaw. Use when setting up Discoclaw for a new user/server, rotating bot tokens, debugging why the bot cannot read messages (Message Content Intent), or when generating an invite URL for a given client ID.
---

# Discoclaw Discord Bot Setup

Keep this workflow safe and minimal: no secrets in git, fail-closed allowlists, and smallest required Discord permissions.

## Create Bot (Developer Portal)

1. Create application -> add bot.
2. Enable **Message Content Intent** (required for `GatewayIntentBits.MessageContent` to work in guilds).
3. Copy token:
   - Put it in `DISCORD_TOKEN` in `.env` (never commit).
   - If rotating token: stop any running services first to avoid reconnect flapping.

## Invite Bot To Server

Preferred: use Discord Portal OAuth2 URL Generator.

Scopes:
- `bot`

Minimal bot permissions:
- View Channels
- Send Messages
- Send Messages in Threads
- Read Message History

Optionally generate an invite URL via repo script:

```bash
pnpm discord:invite-url -- --client-id <CLIENT_ID>
pnpm discord:invite-url -- --client-id <CLIENT_ID> --guild-id <GUILD_ID> --disable-guild-select 1
```

## Configure Discoclaw `.env`

1. `cp .env.example .env`
2. Set:
- `DISCORD_TOKEN=...`
- `DISCORD_ALLOW_USER_IDS=...` (required; empty means respond to nobody)
- `DISCORD_CHANNEL_IDS=...` (recommended for servers; keep minimal)
- `DISCOCLAW_DATA_DIR=...` (optional; content defaults under this)

Validation:
- `pnpm dev`
- Confirm it responds only in allowlisted contexts.

## Common Failures

- Bot responds to nobody:
  - `DISCORD_ALLOW_USER_IDS` is empty or malformed.
- Bot can’t see message content in servers:
  - Message Content Intent not enabled in Developer Portal.
  - Or bot lacks permission to view/read the channel.

