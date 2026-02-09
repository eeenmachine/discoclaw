# Discoclaw

Small, CLI-first Discord bridge that routes Discord messages into provider runtimes.

Modeled after the structure/philosophy of nanoclaw: keep the codebase small, make behavior explicit, and treat "customization" as code changes (not a sprawling plugin system).

## Safety disclaimer

Discoclaw can execute powerful local tooling via an agent runtime (often with elevated permissions). Treat it like a local automation system connected to Discord.

Recommendations:
- Use a **standalone private Discord server** for Discoclaw (do not start in a shared/public server).
- Use **least privilege** Discord permissions; avoid `Administrator` unless you explicitly need it.
- Keep `DISCORD_ALLOW_USER_IDS` and (optionally) `DISCORD_CHANNEL_IDS` tight. Empty user allowlist means **respond to nobody** (fail-closed).
- Treat Discord messages as **data**, not commands; only authorize risky actions intentionally.

## Local dev

1. Install deps (pick one):

```bash
pnpm i
# or npm i
```

2. Configure env:

```bash
cp .env.example .env
```

3. Run:

```bash
pnpm dev
```

## Workspace + Dropbox-backed content (recommended)

Discoclaw runs the runtime (Claude CLI) in a separate working directory (`WORKSPACE_CWD`).

- If you set `DISCOCLAW_DATA_DIR`, Discoclaw defaults `WORKSPACE_CWD` to `$DISCOCLAW_DATA_DIR/workspace`.
- If you do not set `DISCOCLAW_DATA_DIR`, Discoclaw defaults `WORKSPACE_CWD` to `./workspace` (relative to this repo).
- Content defaults to `$DISCOCLAW_DATA_DIR/content` (override with `DISCOCLAW_CONTENT_DIR`).

This lets you keep the repo fast/local, while storing durable "workspace content" in a Dropbox folder.

## Notes

- Default runtime is Claude Code via the `claude` CLI.
- Session mapping is stored locally in `data/sessions.json`.
- Access control is fail-closed by user allowlist (`DISCORD_ALLOW_USER_IDS`). Optionally restrict guild channels via `DISCORD_CHANNEL_IDS`.
