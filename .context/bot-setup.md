# bot-setup.md — Discord Bot Setup (Agent Context)

> For the full human-facing setup guide, see `docs/discord-bot-setup.md`. This file is a brief reference for Claude when helping with bot setup tasks.

## Quick reference

1. **Developer Portal** → create application → Bot → enable **Message Content Intent** → copy token to `.env` (`DISCORD_TOKEN`).
2. **OAuth2 → URL Generator** → scope `bot` → pick permissions (see permission profiles in `docs/discord-bot-setup.md`) → invite to server.
3. **Configure `.env`**: `DISCORD_TOKEN`, `DISCORD_ALLOW_USER_IDS` (fail-closed if empty), `DISCORD_CHANNEL_IDS` (recommended).
4. **Validate**: `pnpm dev`, DM the bot, post in allowed/disallowed channels.

## Getting IDs

Discord client: Settings → Advanced → Developer Mode, then right-click a user/channel → Copy ID.

## Common issues

- **Bot ignores guild messages**: Message Content Intent not enabled in Developer Portal.
- **"Missing Permissions"**: Bot role is below the target role in Server Settings → Roles. Drag it higher.
- **Private threads**: Bot must be explicitly added to private threads regardless of permissions.
