import type { Client, AnyThreadChannel } from 'discord.js';
import type { LoggerLike } from '../discord/action-types.js';

export type BeadsForumGuardOptions = {
  client: Client;
  forumId: string;
  log?: LoggerLike;
};

function isBotOwned(thread: AnyThreadChannel): boolean {
  const botUserId = thread.client?.user?.id ?? '';
  return botUserId !== '' && thread.ownerId === botUserId;
}

async function rejectManualThread(
  thread: AnyThreadChannel,
  log?: LoggerLike,
): Promise<void> {
  log?.info({ threadId: thread.id, name: thread.name, ownerId: thread.ownerId }, 'beads:forum rejected manual thread');
  try {
    await thread.send(
      'Beads (tasks) must be created using bot commands or the `bd` CLI, not by manually creating forum threads.\n\n'
      + 'Ask the bot to create a bead for you, or run `bd create` from the terminal.\n\n'
      + 'This thread will be archived.',
    );
  } catch { /* ignore */ }
  try {
    await thread.setArchived(true);
  } catch { /* ignore */ }
}

export function initBeadsForumGuard(opts: BeadsForumGuardOptions): void {
  const { client, forumId, log } = opts;

  client.on('threadCreate', async (thread: AnyThreadChannel) => {
    try {
      if (thread.parentId !== forumId) return;
      if (isBotOwned(thread)) return;
      await rejectManualThread(thread, log);
    } catch (err) {
      log?.error({ err, threadId: thread.id }, 'beads:forum threadCreate guard failed');
    }
  });

  client.on('threadUpdate', async (_oldThread: AnyThreadChannel, newThread: AnyThreadChannel) => {
    try {
      if (newThread.parentId !== forumId) return;
      // Only act on unarchive transitions.
      if (newThread.archived) return;
      if (isBotOwned(newThread)) return;
      await rejectManualThread(newThread, log);
    } catch (err) {
      log?.error({ err, threadId: newThread.id }, 'beads:forum threadUpdate guard failed');
    }
  });
}
