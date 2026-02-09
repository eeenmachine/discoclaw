# Context Modules

This directory contains modular context files loaded on-demand based on the task at hand.

## Loading Patterns

| When doing... | Read this first |
|---------------|-----------------|
| **Core repo context** | `core.md` |
| **Development / build / test** | `dev.md` |
| **Discord behavior + routing** | `discord.md` |
| **Runtime adapters (Claude CLI, OpenAI/Gemini later)** | `runtime.md` |
| **Ops / systemd service** | `ops.md` |
| **Security / injection / secrets** | `security.md` |
| **Session wrap-up** | `workflows.md` |

## Context Hygiene (Strict)
- Read the minimum necessary modules for the task.
- Do not load modules “just in case.”
- Keep `AGENTS.md` small; put details here.

## Quick Reference
- **core.md** — Repo identity, goals, state files, conventions
- **dev.md** — Commands, env, local dev loops, build/test
- **discord.md** — Allowlist gating, session keys, threading rules, output constraints
- **runtime.md** — Runtime adapter interface, Claude CLI flags, capability routing
- **ops.md** — systemd service notes, logs, restart workflow
- **security.md** — Secrets hygiene, injection defense, safe shelling
- **workflows.md** — Commit/push discipline, checklists

