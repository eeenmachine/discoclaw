# runtime.md — Runtimes & Adapters

## Runtime Adapter Interface
- The Discord layer consumes a provider-agnostic event stream (`EngineEvent`).
- Each runtime adapter implements `RuntimeAdapter.invoke()` and declares capabilities.

See: `src/runtime/types.ts`

## Claude Code CLI Runtime (Current)
- Adapter: `src/runtime/claude-code-cli.ts`
- Invocation shape (simplified):
  - `claude -p --model <id|alias> [--session-id <uuid>] [--tools ...] [--add-dir ...] <prompt>`
- Output modes:
  - `CLAUDE_OUTPUT_FORMAT=text` (stable)
  - `CLAUDE_OUTPUT_FORMAT=stream-json` (best-effort parsing right now; tighten once we confirm event schema)

## Tool Surface
- Today Discoclaw passes a basic tool list and relies on `--dangerously-skip-permissions` in production.
- If/when we add OpenAI/Gemini adapters:
  - Start with **analysis-only** routes (no tools).
  - Add a tool layer only if we explicitly decide we need full parity.

