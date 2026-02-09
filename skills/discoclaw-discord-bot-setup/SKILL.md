---
name: discoclaw-discord-bot-setup
description: Create and invite a Discoclaw Discord bot to a server, configure required intents/permissions, and generate/verify local .env settings for Discoclaw. Use when setting up Discoclaw for a new user/server, rotating bot tokens, debugging why the bot cannot read messages (Message Content Intent), or when generating an invite URL for a given client ID.
---

# Discoclaw Discord Bot Setup

Keep this workflow safe and minimal: no secrets in git, fail-closed allowlists, and smallest required Discord permissions.

Safety disclaimer:
- Recommended: create a **standalone private Discord server** for Discoclaw.
- Prefer **least privilege** permissions; avoid `Administrator` unless you explicitly need it.
- Keep `DISCORD_ALLOW_USER_IDS` and `DISCORD_CHANNEL_IDS` tight.

## Create Bot (Developer Portal)

1. Create application -> add bot.
2. Enable **Message Content Intent** (required for `GatewayIntentBits.MessageContent` to work in guilds).
3. Copy token:
   - Paste it into `DISCORD_TOKEN` in `.env` immediately (never commit).
   - Clipboard tip: don’t copy the Application/Client ID until after you’ve pasted the token, or you may overwrite it.
   - If the token is lost: reset it in the Developer Portal.
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

Permission options (recommended to pick explicitly):
- Minimal (reply + read + reply in threads):
  - `pnpm discord:invite-url -- --client-id <CLIENT_ID> --profile minimal`
- Threads (create/archive/delete threads):
  - `pnpm discord:invite-url -- --client-id <CLIENT_ID> --profile threads`
- Moderator (manage channels/threads/messages/webhooks; not full admin):
  - `pnpm discord:invite-url -- --client-id <CLIENT_ID> --profile moderator`
- Admin (Administrator permission; high risk):
  - `pnpm discord:invite-url -- --client-id <CLIENT_ID> --profile admin`

Profile ramifications:
- `minimal`: least privilege; good for public/shared servers; more likely to hit “I can’t do X” for admin tasks.
- `threads`: adds thread creation/management; higher risk than minimal; still not server admin.
- `moderator`: broad ops; meaningful blast radius; still safer than full admin.
- `admin`: least operational friction; highest blast radius if token/runtime compromised.

If you want slash commands, add the scope:
```bash
pnpm discord:invite-url -- --client-id <CLIENT_ID> --profile minimal --app-commands 1
```

Note: Discord does not expose the same full-text “search like the client” via the public bot API; if you want search, you generally need to log/index messages yourself.

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
