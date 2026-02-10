# runtime.md — Runtimes & Adapters

## Runtime Adapter Interface
- The Discord layer consumes a provider-agnostic event stream (`EngineEvent`).
- Each runtime adapter implements `RuntimeAdapter.invoke()` and declares capabilities.

See: `src/runtime/types.ts`

## Claude Code CLI Runtime (Current)
- Adapter: `src/runtime/claude-code-cli.ts`
- Invocation shape (full):
  ```
  claude -p --model <id|alias>
    [--dangerously-skip-permissions]          # when CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS=1
    [--strict-mcp-config]                     # when CLAUDE_STRICT_MCP_CONFIG=1
    [--debug-file <path>]                     # when CLAUDE_DEBUG_FILE is set
    [--session-id <uuid>]                     # when sessions are enabled
    [--add-dir <dir> ...]                     # group CWD mode
    [--output-format text|stream-json]        # always passed
    [--include-partial-messages]              # when format is stream-json
    [--tools <comma-list>]                    # configurable tool surface
    -- <prompt>                               # POSIX terminator before prompt
  ```
- The `--` terminator prevents variadic flags (e.g. `--tools`, `--add-dir`) from consuming the positional prompt argument.
- Output modes:
  - `CLAUDE_OUTPUT_FORMAT=stream-json` (preferred; Discoclaw parses JSONL and streams text)
  - `CLAUDE_OUTPUT_FORMAT=text` (fallback if your local CLI doesn't support stream-json)

## Tool Surface
- Today Discoclaw passes a basic tool list and relies on `--dangerously-skip-permissions` in production.
- If/when we add OpenAI/Gemini adapters:
  - Start with **analysis-only** routes (no tools).
  - Add a tool layer only if we explicitly decide we need full parity.
