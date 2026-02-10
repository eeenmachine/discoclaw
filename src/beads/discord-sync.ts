import fs from 'node:fs/promises';
import { ChannelType } from 'discord.js';
import type { Client, ForumChannel } from 'discord.js';
import type { BeadData, TagMap } from './types.js';
import { STATUS_EMOJI } from './types.js';

// ---------------------------------------------------------------------------
// Thread name builder
// ---------------------------------------------------------------------------

const THREAD_NAME_MAX = 100;

/** Strip the project prefix from a bead ID: `ws-001` → `001`. */
function shortBeadId(id: string): string {
  const idx = id.indexOf('-');
  return idx >= 0 ? id.slice(idx + 1) : id;
}

/** Build a thread name: `{emoji} [{shortId}] {title}`, capped at 100 chars. */
export function buildThreadName(beadId: string, title: string, status: string): string {
  const emoji = STATUS_EMOJI[status] ?? STATUS_EMOJI.open;
  const prefix = `${emoji} [${shortBeadId(beadId)}] `;
  const maxTitle = THREAD_NAME_MAX - prefix.length;
  const trimmedTitle = title.length > maxTitle ? title.slice(0, maxTitle - 1) + '\u2026' : title;
  return `${prefix}${trimmedTitle}`;
}

// ---------------------------------------------------------------------------
// Forum channel resolution
// ---------------------------------------------------------------------------

/** Resolve a forum channel by name or ID, same pattern as cron forum-sync.ts. */
export function resolveBeadsForum(client: Client, nameOrId: string): ForumChannel | null {
  const byId = client.channels.cache.get(nameOrId);
  if (byId && byId.type === ChannelType.GuildForum) return byId as ForumChannel;

  for (const guild of client.guilds.cache.values()) {
    const ch = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildForum && c.name === nameOrId,
    );
    if (ch) return ch as ForumChannel;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Thread ID extraction
// ---------------------------------------------------------------------------

/**
 * Extract the Discord thread ID from a bead's external_ref field.
 * Supports formats:
 *   - `discord:<threadId>`
 *   - raw numeric ID
 */
export function getThreadIdFromBead(bead: BeadData): string | null {
  const ref = (bead.external_ref ?? '').trim();
  if (!ref) return null;
  if (ref.startsWith('discord:')) return ref.slice('discord:'.length).trim() || null;
  // Numeric ID.
  if (/^\d+$/.test(ref)) return ref;
  return null;
}

// ---------------------------------------------------------------------------
// Tag map loading
// ---------------------------------------------------------------------------

/** Load a tag-map.json file: `{ "tag-name": "discord-tag-id", ... }`. */
export async function loadTagMap(filePath: string): Promise<TagMap> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as TagMap;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Thread lifecycle operations
// ---------------------------------------------------------------------------

/** Create a new forum thread for a bead. Returns the thread ID. */
export async function createBeadThread(
  forum: ForumChannel,
  bead: BeadData,
  tagMap: TagMap,
  mentionUserId?: string,
): Promise<string> {
  const name = buildThreadName(bead.id, bead.title, bead.status);

  // Resolve forum tag IDs from bead labels.
  const appliedTagIds: string[] = [];
  for (const label of bead.labels ?? []) {
    // Try the label directly, then strip common prefixes (tag:, label:).
    const cleaned = label.replace(/^(tag|label):/, '');
    const tagId = tagMap[cleaned] ?? tagMap[label];
    if (tagId) appliedTagIds.push(tagId);
  }

  const descLines: string[] = [];
  if (bead.description) descLines.push(bead.description);
  descLines.push('');
  descLines.push(`**ID:** \`${bead.id}\``);
  descLines.push(`**Priority:** P${bead.priority ?? 2}`);
  descLines.push(`**Status:** ${bead.status}`);
  if (bead.owner) descLines.push(`**Owner:** ${bead.owner}`);
  if (mentionUserId) descLines.push(`\n<@${mentionUserId}>`);

  const message = descLines.join('\n').slice(0, 2000);

  const thread = await forum.threads.create({
    name,
    message: { content: message },
    appliedTags: appliedTagIds.slice(0, 5), // Discord limit: 5 tags
  });

  return thread.id;
}

/** Post a close summary, rename with checkmark, and archive the thread. */
export async function closeBeadThread(
  client: Client,
  threadId: string,
  bead: BeadData,
): Promise<void> {
  const thread = client.channels.cache.get(threadId);
  if (!thread || !thread.isThread()) return;

  const closedName = buildThreadName(bead.id, bead.title, 'closed');

  const reason = bead.close_reason || 'Closed';

  try {
    await thread.send(`**Bead Closed**\n${reason}`);
  } catch {
    // Ignore send failures (thread may already be archived).
  }

  try {
    await thread.setName(closedName);
  } catch {
    // Ignore rename failures.
  }

  try {
    await thread.setArchived(true);
  } catch {
    // Ignore archive failures.
  }
}

/** Update a thread's name to reflect current bead state. */
export async function updateBeadThreadName(
  client: Client,
  threadId: string,
  bead: BeadData,
): Promise<void> {
  const thread = client.channels.cache.get(threadId);
  if (!thread || !thread.isThread()) return;

  const newName = buildThreadName(bead.id, bead.title, bead.status);
  const current = thread.name;
  if (current === newName) return;

  await thread.setName(newName);
}

/** Unarchive a thread if it's currently archived. */
export async function ensureUnarchived(client: Client, threadId: string): Promise<void> {
  const thread = client.channels.cache.get(threadId);
  if (!thread || !thread.isThread()) return;
  if (thread.archived) {
    await thread.setArchived(false);
  }
}
