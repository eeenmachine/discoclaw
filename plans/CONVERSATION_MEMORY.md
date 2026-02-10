# Token-Efficient Conversation Memory for Discoclaw

## Context

Discoclaw now has a basic sliding window (message history fetch, `DISCOCLAW_MESSAGE_HISTORY_BUDGET`). But the window only covers the last ~10 messages. For a personal assistant that spans months of diverse topics, we need longer-term memory without burning through token budget.

This plan implements **rolling conversation summaries** using Claude Haiku — the most impactful and practical next layer. It complements the existing sliding window by compressing older conversation history into a persistent, budget-capped summary that is prepended to each prompt.

### Strategy coverage

| Strategy | Status | Notes |
|----------|--------|-------|
| Sliding Window | Done | `src/discord/message-history.ts` |
| **+ Summary** | **This plan** | Rolling Haiku-generated summaries |
| Prompt Caching | Free | Prompt structure already static-first; Anthropic caches automatically |
| Observation Masking | Covered | Bot responses already stripped of tool XML; summary compresses naturally |
| RAG (vector search) | Future | Needs vector store dependency; out of scope here |

## Prompt structure after this change

```
Context files (read with Read tool before responding, in order):
- /content/discord/base/core.md
- /content/discord/channels/general.md

---
Conversation memory:
User discussed creating a #dev-status channel under the Dev category.
Bot confirmed and created it. User also mentioned wanting to set up
CI notifications in that channel later this week.

---
Recent conversation:
[NimbleDave]: can you set up the CI notifications now?
[Discoclaw]: Sure, which CI provider are you using?
[NimbleDave]: github actions

---
User message:
github actions

---
Discord Actions:
...
```

Three layers of context give Claude both immediacy and long-term recall:
1. **Context files** — personality, channel rules, static knowledge (read via tool)
2. **Conversation memory** — compressed history from all past turns (updated every N turns by Haiku)
3. **Recent conversation** — exact messages from the last few turns (sliding window)
4. **Current message** — what to respond to now

## Files

### New: `src/discord/summarizer.ts` (~100 lines)

Core module for loading, saving, and generating conversation summaries.

```typescript
import type { RuntimeAdapter } from '../runtime/types.js';

export type ConversationSummary = {
  summary: string;
  updatedAt: number; // ms since epoch
};

/** Load existing summary from disk. Returns null if missing. */
export async function loadSummary(
  dir: string,
  sessionKey: string,
): Promise<ConversationSummary | null>;

/** Atomic-write summary to disk. */
export async function saveSummary(
  dir: string,
  sessionKey: string,
  data: ConversationSummary,
): Promise<void>;

/** Invoke Haiku to generate an updated summary. */
export async function generateSummary(
  runtime: RuntimeAdapter,
  opts: {
    previousSummary: string | null;
    recentExchange: string;
    model: string;
    cwd: string;
    maxChars: number;
    timeoutMs?: number;
  },
): Promise<string>;
```

**Storage:** `{summaryDataDir}/{safe-session-key}.json` — same filesystem-safe naming as `groupDirNameFromSessionKey()` in `src/discord.ts`.

**Atomic writes:** Same tmp+rename pattern as `src/sessions.ts`.

**`generateSummary` implementation:**
- Invokes the existing `RuntimeAdapter` with `model: 'haiku'`, `tools: []` (no tools), no `sessionId`
- Collects `text_delta`/`text_final` events into a string
- Returns the summary text
- Wrapped in try/catch — returns previous summary unchanged on failure

**Summarization prompt:**
```
You are a conversation summarizer for a Discord assistant called Discoclaw.
Update the running summary with key information from the recent exchange.

Previous summary:
{previousSummary or "(new conversation)"}

Recent exchange:
{recentExchange}

Rules:
- Preserve important facts, decisions, action items, and user preferences
- Drop greetings, acknowledgments, "sounds good", and filler
- Keep under {maxChars} characters
- Write in present tense, third person
- Focus on what was discussed and decided, not how
```

### New: `src/discord/summarizer.test.ts`

Tests:
- `loadSummary` returns null for missing file, parses valid JSON
- `saveSummary` creates file atomically, overwrites existing
- `generateSummary` collects runtime text output into summary string
- `generateSummary` returns previous summary on runtime error (graceful degradation)
- Summary file uses safe session key naming

### Modify: `src/discord.ts`

**Add to `BotParams`:**
```typescript
summaryEnabled: boolean;
summaryModel: string;
summaryMaxChars: number;
summaryEveryNTurns: number;
summaryDataDir: string;
```

**Module-level turn counter** (in-memory, resets on restart — that's fine):
```typescript
const turnCounters = new Map<string, number>();
```

**In the handler** (inside the queue callback):

1. **Before prompt construction** — load existing summary:
```typescript
let summarySection = '';
if (params.summaryEnabled) {
  const existing = await loadSummary(params.summaryDataDir, sessionKey);
  if (existing) summarySection = existing.summary;
}
```

2. **In the prompt template** — insert between context files and recent conversation:
```typescript
(summarySection
  ? `\n\n---\nConversation memory:\n${summarySection}\n`
  : '') +
```

3. **After response is sent** — check turn counter, maybe re-summarize:
```typescript
if (params.summaryEnabled) {
  const count = (turnCounters.get(sessionKey) ?? 0) + 1;
  turnCounters.set(sessionKey, count);

  if (count >= params.summaryEveryNTurns) {
    turnCounters.set(sessionKey, 0);
    try {
      const existingSummary = summarySection || null;
      // Build the exchange text: recent history + current turn
      const exchange =
        (historySection ? historySection + '\n' : '') +
        `[${msg.author.displayName || msg.author.username}]: ${msg.content}\n` +
        `[Discoclaw]: ${(processedText || '').slice(0, 500)}`;

      const newSummary = await generateSummary(params.runtime, {
        previousSummary: existingSummary,
        recentExchange: exchange,
        model: params.summaryModel,
        cwd: params.workspaceCwd,
        maxChars: params.summaryMaxChars,
        timeoutMs: 30_000,
      });
      await saveSummary(params.summaryDataDir, sessionKey, {
        summary: newSummary,
        updatedAt: Date.now(),
      });
    } catch (err) {
      params.log?.warn({ err, sessionKey }, 'discord:summary generation failed');
    }
  }
}
```

The summarization runs inside the queue callback **after** the response is already sent to Discord, so the user sees their response immediately. The queue blocks the next message for that session key during summarization (~2-5s), which is acceptable since it only happens every N turns.

### Modify: `src/index.ts`

New env var parsing:
```typescript
const summaryEnabled = (process.env.DISCOCLAW_SUMMARY_ENABLED ?? '1') === '1';
const summaryModel = (process.env.DISCOCLAW_SUMMARY_MODEL ?? 'haiku').trim() || 'haiku';
const summaryMaxChars = Math.max(0, Number(process.env.DISCOCLAW_SUMMARY_MAX_CHARS ?? '2000'));
const summaryEveryNTurns = Math.max(1, Number(process.env.DISCOCLAW_SUMMARY_EVERY_N_TURNS ?? '5'));
const summaryDataDir = (process.env.DISCOCLAW_SUMMARY_DATA_DIR ?? '').trim()
  || (dataDir ? path.join(dataDir, 'summaries') : path.join(__dirname, '..', 'data', 'summaries'));
```

Pass to `startDiscordBot()`.

### Modify: `.env.example`

```env
# Conversation summaries — rolling Haiku-generated memory of past conversations.
DISCOCLAW_SUMMARY_ENABLED=1
DISCOCLAW_SUMMARY_MODEL=haiku
# Max chars for the summary text (Haiku will compress to fit).
DISCOCLAW_SUMMARY_MAX_CHARS=2000
# Re-summarize every N messages per session.
DISCOCLAW_SUMMARY_EVERY_N_TURNS=5
```

### Modify: `.context/dev.md`

Add summary env vars to the App table.

### Modify: `.context/discord.md`

Expand the "Conversation History" section to cover the summary layer.

## Design details

**Why Haiku via CLI (not direct API)?** Reuses the existing `RuntimeAdapter` — just `invoke({ model: 'haiku', tools: [] })`. No new dependencies. CLI overhead (~3-5s) is acceptable because summarization is background and only happens every N turns. Direct API integration is a future optimization if needed.

**Turn counter is in-memory.** Resets on restart — means first summary after restart might come 5 turns after the last one instead of exactly on schedule. This is fine; the sliding window covers the gap.

**Summary is per session key.** Same granularity as the existing session system: per-channel for guilds, per-user for DMs, per-thread for threads.

**Bot response truncation in exchange.** The bot's response is sliced to 500 chars in the exchange text sent to Haiku. Full bot responses can be very long (code blocks, lists) and we only need the gist for the summary.

**Graceful degradation.** If summary load/save/generate fails at any point, log a warning and continue. The sliding window still provides recent context. Summary is strictly best-effort.

## Verification

1. `pnpm build` — green
2. `pnpm test` — new + existing tests pass
3. Manual test: multi-turn conversation in Discord over 6+ messages — after 5 turns, summary file should appear in `data/summaries/`
4. Manual test: reference something from >10 messages ago — bot should recall it from the summary
5. Manual test: `DISCOCLAW_SUMMARY_ENABLED=0` — disables summaries, sliding window still works
6. Manual test: kill and restart the bot mid-conversation — summary persists, context is maintained
