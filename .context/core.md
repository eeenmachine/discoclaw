# core.md — Discoclaw Core Context

## Identity
- **Name:** Discoclaw
- **Role:** Minimal Discord bridge that routes messages to AI runtimes (Claude Code first; OpenAI/Gemini adapters later).
- **Philosophy:** Keep it small, explicit, auditable. See `docs/philosophy.md`.

## Trust Boundary
- We assume Claude Code runs with `--dangerously-skip-permissions` in production.
- The **Discord allowlist** is the primary security boundary (`DISCORD_ALLOW_USER_IDS`).
- Default policy is **fail closed**: empty allowlist means respond to nobody.

## Repo Layout
- `src/index.ts` — entrypoint
- `src/discord.ts` — Discord bot + routing + per-session queue
- `src/runtime/` — runtime adapters (Claude CLI now; OpenAI/Gemini later)
- `src/sessions.ts` — sessionKey -> UUID mapping (stored in `data/sessions.json`)
- `groups/` — optional per-session working directories (nanoclaw-style). Enabled by `USE_GROUP_DIR_CWD=1`.
- `systemd/discoclaw.service` — service unit template

## State Files
- `data/sessions.json` (gitignored) — sessionKey -> UUID mapping
- `groups/<sessionKey>/CLAUDE.md` — bootstrapped per-group instructions when group cwd is enabled

## External Workspace (Important)
- By default the runtime working directory is `WORKSPACE_CWD=/home/davidmarsh/weston`.
- Discoclaw should treat `/home/davidmarsh/weston` as an external workspace; do not make unrelated edits there while developing Discoclaw.

