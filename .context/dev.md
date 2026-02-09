# dev.md — Development

## Install / Build / Run

```bash
cd /home/davidmarsh/code/discoclaw
pnpm i
pnpm build
pnpm dev
```

## Environment

- Copy `.env.example` -> `.env`
- Required:
  - `DISCORD_TOKEN`
  - `DISCORD_ALLOW_USER_IDS` (comma/space-separated Discord user IDs; fail-closed if empty)
- Useful:
  - `WORKSPACE_CWD=/home/davidmarsh/weston`
  - `CLAUDE_BIN=claude`
  - `CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS=1`
  - `CLAUDE_OUTPUT_FORMAT=text` (switch to `stream-json` once the event schema is solid)
- Group-scoped CWD (nanoclaw-style):
  - `USE_GROUP_DIR_CWD=1`
  - `GROUPS_DIR=/home/davidmarsh/code/discoclaw/groups`

## Notes
- The bot currently hardcodes model `opus` and tool set in `src/discord.ts` (intentionally explicit early on).
- If `pnpm dev` fails with “Missing DISCORD_TOKEN”, your `.env` isn’t loaded or the var is unset.

