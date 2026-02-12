# SIMPLE DNAM (Simple Discord-Native Assistant Memory)

## Summary
SIMPLE DNAM is a hybrid memory system for DiscoClaw:
- **Durable memory (per Discord user):** structured, low-churn, long-lived facts/preferences/projects with provenance.
- **Rolling memory (per sessionKey):** token-efficient lossy summary of recent conversation, refreshed periodically.

It keeps DiscoClaw “nanoclaw-style” (small, auditable, filesystem-first), uses **Haiku** for updates, avoids Discord-search-as-RAG, and provides optional transparency via a **single** Discord memory channel.

## Goals / Non-goals
Goals:
- Remember durable user preferences and long-term facts across channels/threads/DMs.
- Keep per-turn prompt size bounded and predictable.
- Be testable and robust: memory is best-effort, never blocks responding.
- Make memory inspectable and correctable by the user.

Non-goals (for now):
- Vector DB, embeddings, semantic search.
- Multi-channel D-NAMS infra (`#agent-state/#agent-logs/#scratchpad`).
- Automated “conflict resolution workflows” beyond deprecating old entries and optionally asking the user.
- Reliance on Discord’s message search as a retrieval primitive.

## Definitions
- **User key:** Discord user ID (`msg.author.id`). Durable memory is keyed by this.
- **Session key:** existing DiscoClaw `discordSessionKey(...)` (DM vs channel vs thread). Rolling summary is keyed by this.
- **Durable item:** a single structured memory entry (preference/fact/project/etc).
- **Source:** provenance pointer for a durable item (Discord channelId + messageId, or manual).

## Memory Layers in the Prompt (Order)
1. Context files (existing; Read tool)
2. Durable memory (retrieved subset, per-user)
3. Rolling summary (always injected, per-sessionKey; if present)
4. Recent conversation (existing sliding window; `DISCOCLAW_MESSAGE_HISTORY_BUDGET`)
5. Current user message
6. Discord actions section (existing, if enabled)

### Prompt Template (Concrete)
```
Context files (read with Read tool before responding, in order):
- /content/discord/base/core.md
- /content/discord/channels/<channel>.md

---
Durable memory (user-specific notes; may be empty):
- [preference] User prefers explicit for-loops over list comprehensions in Python. (src: discord:<channelId>/<messageId>, updated 2026-02-09)
- [project] Current project: discoclaw memory system, prioritize small auditable changes. (src: manual, updated 2026-02-09)

---
Conversation memory (rolling summary; may be empty):
User is implementing SIMPLE DNAM: durable per-user items + rolling per-session summaries. Discussion is focused on Haiku-based summarization and retrieval without Discord search.

---
Recent conversation:
[NimbleDave]: ...
[DiscoClaw]: ...

---
User message:
...

---
Discord Actions:
...
```

## Storage (Disk is Source of Truth)
All memory is stored on disk under the existing data dir (or an explicit configured dir).

### Rolling summaries (per sessionKey)
Path:
- `data/memory/rolling/<safe-session-key>.json`

Schema:
```json
{ "summary": "string", "updatedAt": 1739140000000 }
```

### Durable memory (per Discord user id)
Path:
- `data/memory/durable/<discord-user-id>.json`

Schema (versioned, merge-friendly):
```json
{
  "version": 1,
  "updatedAt": 1739140000000,
  "items": [
    {
      "id": "stable_string_id",
      "kind": "preference|fact|project|constraint|person|tool|workflow",
      "text": "human readable sentence",
      "tags": ["lowercase", "tokens"],
      "status": "active|deprecated",
      "source": { "type": "discord", "channelId": "123", "messageId": "456" },
      "createdAt": 1739130000000,
      "updatedAt": 1739140000000
    }
  ]
}
```

Notes:
- Each item has a stable `id` (e.g. `durable-<short-hash>`). IDs are derived from a hash of normalized `kind + text` at creation time, but once assigned they are permanent — even if the text is later updated. This lets Haiku reference existing items by ID for updates.
- `status=deprecated` keeps history without letting stale preferences dominate.

### Atomic writes
All writes are **tmp+rename** (use the existing `atomicWriteJson` pattern in `src/sessions.ts`).

## Durable Retrieval (GrepRAG-lite, No New Dependencies)
On each turn, select a small relevant subset of durable items to inject.

Inputs:
- Current user message text
- Optional: recent conversation (sliding window text) for better query terms

Scoring (simple, deterministic):
- Tokenize the query (lowercase words; drop short tokens; drop a small stoplist).
- For each durable item, tokenize `text + tags + kind`.
- Score = count of overlapping tokens, with small boosts:
  - +2 if `kind=project` and query includes project-ish terms (e.g. “repo”, “build”, “deploy”)
  - +1 if item updated recently (recency bump)
- Select top K under a char budget (defaults below).

Defaults:
- `K=12`
- `durableInjectMaxChars=2000` (hard cap)
- Only `status=active` items are injected by default.

## Haiku: Two Update Loops (Both Best-Effort)
All Haiku calls run with:
- `tools: []` (no tools)
- no runtime session id (or same policy as existing summary plan)
- strict timeouts
- failures do not affect responding (log + continue)

### A) Rolling summary update (per sessionKey)
Cadence:
- every `N` turns per sessionKey (e.g. 5), after the response is sent (like `CONVERSATION_MEMORY.md`)

Prompt (rolling):
- Update a running narrative summary.
- Keep under `rollingMaxChars`.
- Drop filler; keep decisions and current focus.

### B) Durable extraction/maintenance (per user id)
Cadence:
- every `M` turns per user id (e.g. 10), after the response is sent
- Requires a **separate `userTurnCounters` map** keyed by `msg.author.id`, incremented alongside the session-key rolling counter. This is distinct from the rolling summary turn counter because a single user may be active across multiple session keys.

Turn counter behavior on restart:
- Like the rolling summary counter, the durable turn counter is in-memory and resets on restart. First durable extraction after restart may come up to M turns later than ideal. This is acceptable — no data is lost, just slightly delayed extraction.

**Extraction prompt includes existing items.** The current active durable items (serialized as a compact list with IDs) are included in the Haiku prompt so it can:
- Reference existing items by `id` for updates (avoids near-duplicate creation from rephrasing)
- Make informed deprecation decisions
- Avoid re-extracting facts that already exist

Output requirement:
- Haiku must output **strict JSON only** (no prose), so the merge is deterministic and safe.

Proposed JSON output:
```json
{
  "upserts": [
    {
      "id": "durable-a1b2c3",
      "kind": "preference",
      "text": "User prefers explicit for-loops over list comprehensions in Python.",
      "tags": ["python", "style"],
      "source": { "type": "discord", "channelId": "123", "messageId": "456" }
    }
  ],
  "deprecations": [
    { "id": "durable-x9y8z7", "reason": "User explicitly changed preference." }
  ]
}
```

Upsert matching (in priority order):
1. If `id` is provided and matches an existing item: update that item.
2. If no `id` (or `id` not found): derive an ID from normalized `kind+text` and check for match.
3. If no match: insert as new item with a freshly derived ID.

Deprecation matching:
- If `id` is provided: deprecate only that exact item (preferred path, since Haiku sees existing IDs).
- Fallback (no `id`): match by `matchText` field against item text. To prevent overly broad matches, `matchText` must match at least 60% of the target item's text length. This guards against short substrings accidentally deprecating unrelated items.

Merge rules (code-enforced):
- Normalize `kind` and `text` (trim, collapse whitespace).
- `upserts`:
  - if matching active item exists: update text/tags/source/updatedAt (ID is preserved)
  - else: insert new active item with derived ID and createdAt/updatedAt
- `deprecations`:
  - mark matching active items as `status=deprecated` with `updatedAt` timestamp
- Cap total items:
  - if over cap, drop oldest deprecated first, then oldest active (only if necessary)

Safety:
- If JSON parse fails: ignore update and keep old durable memory unchanged.
- If Haiku output contains IDs that don't exist in the store: treat as new inserts (derive fresh ID).

## User Controls (Explicit, Minimal)
Handled by DiscoClaw before runtime invocation (fast, reliable).

Commands (suggested prefix `!memory`):
- `!memory show`
  - Show top injected durable items + rolling summary for this session.
- `!memory remember <text>`
  - Add a durable item with `kind=fact` (or infer kind minimally), `source=manual`.
- `!memory forget <substring>`
  - Deprecate matching durable items. Substring must match at least 60% of the target item's text length (same safety threshold as Haiku deprecations).
- `!memory reset rolling`
  - Clear rolling summary for this sessionKey.

All `!memory` commands run **inside the session-key queue** to prevent torn reads/writes if a Haiku extraction is in progress for the same user.

If commands are not desired, keep them behind an env flag.

## Optional Transparency (Single Discord Channel)
If `DISCOCLAW_MEMORY_CHANNEL_ID` is set:
- After updating rolling/durable memory, the bot writes a snapshot into that channel.
- Simplest: one message per user (pinned) that is edited in-place.

Snapshot format (human readable):
- "Durable memory (active)" list
- Rolling summary (for the session that triggered the update)
- `updatedAt` timestamps

Size limits: Discord messages cap at 2000 chars. If the snapshot exceeds this, truncate older/lower-scored durable items and append "(N more items on disk)". Do not split across multiple messages — the single-message-per-user invariant keeps the channel browsable.

This provides the main D-NAMS trust benefit without multi-channel infra.

## Configuration (Env Vars)
Existing (rolling summary plan):
- `DISCOCLAW_SUMMARY_ENABLED=1`
- `DISCOCLAW_SUMMARY_MODEL=haiku`
- `DISCOCLAW_SUMMARY_MAX_CHARS=2000`
- `DISCOCLAW_SUMMARY_EVERY_N_TURNS=5`
- `DISCOCLAW_SUMMARY_DATA_DIR=...` (or derived from `dataDir`)

New (SIMPLE DNAM durable memory):
- `DISCOCLAW_DURABLE_MEMORY_ENABLED=1`
- `DISCOCLAW_DURABLE_MODEL=haiku`
- `DISCOCLAW_DURABLE_EVERY_N_TURNS=10`
- `DISCOCLAW_DURABLE_DATA_DIR=...` (default `data/memory/durable`)
- `DISCOCLAW_DURABLE_INJECT_MAX_CHARS=2000`
- `DISCOCLAW_DURABLE_MAX_ITEMS=200`
- `DISCOCLAW_MEMORY_CHANNEL_ID=` (optional transparency mirror)
- `DISCOCLAW_MEMORY_COMMANDS_ENABLED=1`

## Failure Modes (Fail Closed / Best-Effort)
- If allowlist is empty/missing: DiscoClaw already fails closed; SIMPLE DNAM must not change that.
- If memory read fails: treat as empty and continue.
- If memory write fails: log warning and continue.
- If Haiku summarization fails: keep old memory, continue.
- If Haiku durable extraction fails (timeout, JSON parse error, network): keep old durable memory unchanged, log warning, continue. Turn counter still resets so extraction retries on next cycle.
- If memory channel mirror fails: ignore and continue.
- If process dies mid-Haiku-call: atomic write hasn't happened, so no data corruption. Turn counters (both rolling and durable) reset on restart — first extraction may be delayed up to M turns. The sliding window and persisted summaries/durable files cover the gap.

## Testing / Verification
Unit tests:
- JSON load/save (missing file => null/empty)
- Atomic write behavior (tmp+rename)
- Durable merge rules (dedupe, deprecate, caps)
- Retrieval scoring selects expected items
- Haiku output parsing failure leaves memory unchanged

Manual tests:
- Preference stated in one channel is recalled in another channel (same user id).
- After many turns, durable preference persists even if rolling summary changes.
- `!memory remember/forget/show` flows.

## Phased Plan (Small, Auditable Steps)
Phase 1: Rolling summaries (per sessionKey)
- Implement `CONVERSATION_MEMORY.md` as written.
- Prompt: insert "Conversation memory" section between context files and recent conversation.
- Update `.context/dev.md`: add summary env vars to the App table.
- Update `.context/discord.md`: expand "Conversation History" section to cover the summary layer.
- Update `.context/core.md`: add `data/memory/rolling/` to State Files section.

Phase 2: Durable memory (manual only)
- Add durable store keyed by Discord user ID.
- Add injection of relevant durable items (initially inject all active items under budget, or basic token overlap).
- Add `!memory show/remember/forget` (optional flag).
- Update `.context/dev.md`: add durable memory env vars to the App table.
- Update `.context/discord.md`: add "Durable Memory" section covering storage, retrieval, and user commands.
- Update `.context/core.md`: add `data/memory/durable/` to State Files section.

Phase 3: Haiku durable extraction
- Add `userTurnCounters` map keyed by `msg.author.id` (separate from session-key rolling counter).
- Add durable update loop (every M turns per user).
- Extraction prompt includes existing active items (with IDs) so Haiku can reference/update them.
- Strict JSON-only Haiku output + ID-based upsert/deprecation matching + deterministic merge rules.
- Hard caps and graceful failure behavior.

Phase 4: Optional transparency channel
- Add `DISCOCLAW_MEMORY_CHANNEL_ID`.
- Post/edit a per-user snapshot after updates.

Phase 5 (optional): Improve retrieval without vectors
- Expand scoring (tags, kind boosts, recency), still deterministic.
- Consider tiny local inverted index if needed, but keep it auditable and rebuildable.

## Documentation Updates (Alongside Each Phase)

Each phase includes its own doc updates (listed above), but there is also a runtime context update that should land with Phase 1 and expand in Phase 2.

### Runtime context: `content/discord/base/core.md`

This is the deployed file the bot reads at runtime (via Read tool), not a developer doc. It needs to tell the bot how to use the new prompt sections. Add a `## Memory` section:

**Phase 1 (rolling summary only):**
```markdown
## Memory
- The "Conversation memory" section (when present) is a compressed summary of earlier
  conversation in this channel/thread. Use it for continuity, but prefer the "Recent
  conversation" section when they conflict — recent messages are exact, the summary is lossy.
- Do not refer to the memory system unprompted.
```

**Phase 2+ (add durable memory paragraph):**
```markdown
- The "Durable memory" section contains long-term facts about the user (preferences,
  projects, constraints). Trust these entries — they persist across channels and sessions.
- If the user corrects something that contradicts a durable memory entry, acknowledge the
  correction. It will be updated automatically on the next extraction cycle.
- If the user asks what you remember, cite specific durable items.
```

### Developer context updates summary

| File | Phase | What to add |
|------|-------|-------------|
| `.context/dev.md` | 1, 2 | New env vars in the App table |
| `.context/discord.md` | 1, 2 | Expand "Conversation History" into "Conversation History & Memory" covering both layers |
| `.context/core.md` | 1, 2 | `data/memory/rolling/` and `data/memory/durable/` in State Files |
| `.env.example` | 1, 2 | New env vars with inline comments (already in plan) |
| `content/discord/base/core.md` | 1, 2 | Runtime `## Memory` instructions (deployed, not in repo) |

