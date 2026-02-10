import type { Client } from 'discord.js';
import type { TagMap, BeadData } from './types.js';
import type { LoggerLike } from '../discord/action-types.js';
import { bdList, bdUpdate } from './bd-cli.js';
import {
  resolveBeadsForum,
  createBeadThread,
  closeBeadThread,
  updateBeadThreadName,
  getThreadIdFromBead,
  buildThreadName,
} from './discord-sync.js';

export type BeadSyncOptions = {
  client: Client;
  forumId: string;
  tagMap: TagMap;
  beadsCwd: string;
  log?: LoggerLike;
};

export type BeadSyncResult = {
  threadsCreated: number;
  emojisUpdated: number;
  threadsArchived: number;
};

/**
 * 4-phase safety-net sync between beads DB and Discord forum threads.
 *
 * Phase 1: Create threads for beads missing external_ref.
 * Phase 2: Fix label mismatches (e.g., blocked label on open beads).
 * Phase 3: Sync emoji/names for existing threads.
 * Phase 4: Archive threads for closed beads.
 */
export async function runBeadSync(opts: BeadSyncOptions): Promise<BeadSyncResult> {
  const { client, forumId, tagMap, beadsCwd, log } = opts;

  const forum = resolveBeadsForum(client, forumId);
  if (!forum) {
    log?.warn({ forumId }, 'bead-sync: forum not found');
    return { threadsCreated: 0, emojisUpdated: 0, threadsArchived: 0 };
  }

  let threadsCreated = 0;
  let emojisUpdated = 0;
  let threadsArchived = 0;

  // Load all beads (including closed for Phase 4).
  const allBeads = await bdList({ status: 'all' }, beadsCwd);

  // Phase 1: Create threads for beads missing external_ref.
  const missingRef = allBeads.filter((b) => !getThreadIdFromBead(b) && b.status !== 'closed' && b.status !== 'done' && b.status !== 'tombstone');
  for (const bead of missingRef) {
    try {
      const threadId = await createBeadThread(forum, bead, tagMap);
      // Link back via external_ref.
      try {
        await bdUpdate(bead.id, { externalRef: `discord:${threadId}` }, beadsCwd);
      } catch (err) {
        log?.warn({ err, beadId: bead.id }, 'bead-sync:phase1 external-ref update failed');
      }
      threadsCreated++;
      log?.info({ beadId: bead.id, threadId }, 'bead-sync:phase1 thread created');
    } catch (err) {
      log?.warn({ err, beadId: bead.id }, 'bead-sync:phase1 failed');
    }
  }

  // Phase 2: Fix label mismatches — skip for now (labels are informational).

  // Phase 3: Sync emoji/names for existing threads.
  const withRef = allBeads.filter((b) => getThreadIdFromBead(b) && b.status !== 'closed' && b.status !== 'done' && b.status !== 'tombstone');
  for (const bead of withRef) {
    const threadId = getThreadIdFromBead(bead)!;
    const thread = client.channels.cache.get(threadId);
    if (!thread || !thread.isThread()) continue;

    const expectedName = buildThreadName(bead.id, bead.title, bead.status);
    if (thread.name !== expectedName) {
      try {
        await updateBeadThreadName(client, threadId, bead);
        emojisUpdated++;
        log?.info({ beadId: bead.id, threadId }, 'bead-sync:phase3 name updated');
      } catch (err) {
        log?.warn({ err, beadId: bead.id, threadId }, 'bead-sync:phase3 failed');
      }
    }
  }

  // Phase 4: Archive threads for closed beads.
  const closedBeads = allBeads.filter((b) => (b.status === 'closed' || b.status === 'done') && getThreadIdFromBead(b));
  for (const bead of closedBeads) {
    const threadId = getThreadIdFromBead(bead)!;
    const thread = client.channels.cache.get(threadId);
    if (!thread || !thread.isThread()) continue;
    if (thread.archived) continue;

    try {
      await closeBeadThread(client, threadId, bead);
      threadsArchived++;
      log?.info({ beadId: bead.id, threadId }, 'bead-sync:phase4 archived');
    } catch (err) {
      log?.warn({ err, beadId: bead.id, threadId }, 'bead-sync:phase4 failed');
    }
  }

  log?.info({ threadsCreated, emojisUpdated, threadsArchived }, 'bead-sync: complete');
  return { threadsCreated, emojisUpdated, threadsArchived };
}
