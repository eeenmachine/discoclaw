Here is a Product Requirements Document (PRD) for the **Discord-Native Agentic Memory System (D-NAMS)**.

This document operationalizes the research regarding "Filesystem-based" memory architectures, "GrepRAG" lexical retrieval, and lifecycle management, adapting them specifically for the Discord platform.

***

# Product Requirements Document: Discord-Native Agentic Memory System (D-NAMS)

## 1. Executive Summary
**Product Name:** D-NAMS (Discord-Native Agentic Memory System)
**Objective:** To enable a personal AI assistant to maintain long-term state, recall past interactions, and evolve its behavior over time using Discord’s native infrastructure (channels, messages, search) as the storage and retrieval substrate.
**Core Philosophy:** "Memory as a Filesystem." We treat Discord channels as directories and messages as atomic files. This avoids the opacity of vector databases in favor of a human-readable, transparent log that leverages Discord's robust lexical search.

---

## 2. User Stories
*   **As a user,** I want my agent to remember my coding preferences (e.g., "I prefer Python over Java") so I don't have to repeat them in every session.
*   **As a user,** I want to see exactly *what* the agent remembers about a project so I can correct hallucinations or outdated facts.
*   **As a developer,** I want the agent to cite the specific Discord message where a fact was learned to verify its accuracy (Just-In-Time Verification).
*   **As a system,** I want to "forget" or "archive" outdated instructions (e.g., a completed project) to prevent context pollution.

---

## 3. System Architecture
The system utilizes a **Hybrid Memory Architecture**, splitting memory into **Episodic** (Logs) and **Semantic** (State).

### 3.1. Infrastructure (Discord Components)
The system requires a dedicated private category in the user's Discord server containing:
1.  **`#agent-state` (Semantic Memory):** A read-only channel (for the user) containing "Pinned State" messages. This acts as the `AGENTS.md` or `README` for the agent.
2.  **`#agent-logs` (Episodic Memory):** A high-volume channel where the agent logs granular events, decisions, and tool outputs.
3.  **`#scratchpad` (Working Memory):** A channel for the agent to "think out loud" or store temporary artifacts before finalizing a memory.

---

## 4. Functional Requirements

### 4.1. Memory Ingestion (The "Write" Path)
The agent must structure data to make it searchable by Discord's lexical index.
*   **FR-1.1 Atomic Note Creation:** Memories must be stored as individual messages using Markdown. Following the Zettelkasten principle, each memory should be "atomic" (one idea per message).
*   **FR-1.2 Metadata Tagging:** Every memory message must include YAML frontmatter or hashtags for filtering.
    *   *Required Metadata:* `#fact`, `#preference`, `#project:[name]`, `timestamp`.
*   **FR-1.3 Citation Linking:** When creating a memory derived from a user conversation, the agent must include a link to the original Discord message URL.

**Message Format Example:**
```markdown
**Memory Type:** #UserPreference
**Topic:** Coding Style
**Fact:** User strictly forbids the use of list comprehensions in Python; prefers explicit for-loops for readability.
**Source:** https://discord.com/channels/.../123456
**Status:** Active
```

### 4.2. Memory Retrieval (The "Read" Path)
Leveraging "GrepRAG" principles, the agent will use Discord's search API as a retrieval tool.
*   **FR-2.1 Keyword Generation:** The agent shall generate 3-5 specific search queries based on the user's prompt (e.g., searching for "Python style" or "loop preference").
*   **FR-2.2 Recency Bias:** The agent must prioritize search results from the `#agent-state` channel over `#agent-logs`.
*   **FR-2.3 Verification:** Before using a retrieved memory, the agent must check if a newer message in `#agent-state` explicitly deprecates it (e.g., "UPDATE: User now allows list comprehensions").

### 4.3. State Management (The Lifecycle)
To prevent "context rot", memory must evolve.
*   **FR-3.1 The "Pinned State" Mechanism:** The agent maintains a single, pinned message in `#agent-state` summarizing critical active context (e.g., "Current Project: Website Redesign"). This message is edited, not just appended to.
*   **FR-3.2 Compaction/Summarization:** Every 50 messages (configurable), the agent must read the recent conversation history, summarize key outcomes into a single Markdown block, post it to `#agent-logs`, and conceptually "discard" the raw tokens.
*   **FR-3.3 Conflict Resolution:** If the agent finds contradictory memories (e.g., "User likes React" vs. "User likes Vue"), it must ask the user for clarification and mark the old memory as `Status: Deprecated`.

---

## 5. Tooling Specifications (Agent Skills)
The agent requires specific "skills" (functions) to interact with Discord as a database.

| Function Name | Description | Discord API Mapping |
| :--- | :--- | :--- |
| `search_memory(query)` | Search the `#agent-logs` and `#agent-state` channels. | `search_messages` (GET) |
| `store_fact(content, tags)` | Write a new structured message to `#agent-logs`. | `create_message` (POST) |
| `update_state(key, value)` | Edit the pinned "World View" message in `#agent-state`. | `edit_message` (PATCH) |
| `read_thread(thread_id)` | Read full context of a specific past conversation. | `get_channel_messages` (GET) |

---

## 6. Non-Functional Requirements
*   **NFR-1 Transparency:** All memory operations must be visible. The user can browse `#agent-logs` to see exactly what the AI knows.
*   **NFR-2 Latency:** Retrieval (Search API call) should not exceed 2 seconds. Discord's lexical search is generally faster than vector DBs for this scale.
*   **NFR-3 Durability:** Data persists as long as the Discord server exists. No external database dependencies (e.g., Pinecone/Weaviate) are required, reducing operational complexity.

---

## 7. Risks & Mitigation
| Risk | Mitigation Strategy |
| :--- | :--- |
| **Context Pollution:** Retrieving too many irrelevant "old" memories. | Implement **Strict Filtering**: Only retrieve from `#agent-state` for high-level facts. Use `#agent-logs` only for deep dives. |
| **Hallucination:** Agent invents facts not in memory. | **Citation Enforcement**: The agent must output the Discord Message Link of the memory it used to generate the answer. |
| **Stale Data:** Old preferences overriding new ones. | **Timestamp Weighting**: In retrieval sorting, weight recent messages significantly higher. Explicitly mark old memories as `[ARCHIVED]`. |

---

## 8. Success Metrics
*   **Retrieval Precision:** Percentage of times the agent retrieves the correct "preference" file when asked a relevant question.
*   **Self-Correction Rate:** Frequency with which the agent updates the `#agent-state` pinned message after a change in project requirements.
*   **User Trust:** Measured by how often the user has to repeat instructions (lower is better).