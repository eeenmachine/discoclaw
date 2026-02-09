# workflows.md — Workflows & Checklists

## Pre-Commit Checklist
- `pnpm build` is green
- No secrets in git (`.env` not added, tokens not pasted)
- `git status --short` is clean or intentional
- Commit message matches the change (one concern per commit)

## Typical Dev Loop
```bash
pnpm dev
# make changes
pnpm build
git status --short
git commit -am \"...\"  # or stage selectively
```

## When Adding New Behavior
- Prefer a small “Phase 1” implementation that can be run safely in a private Discord channel.
- Add guardrails first (allowlist, timeouts, queueing) before adding features (streaming, cron, commands).

