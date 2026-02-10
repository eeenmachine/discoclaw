import { describe, expect, it, vi } from 'vitest';
import { ChannelType } from 'discord.js';
import { ensureSystemScaffold } from './system-bootstrap.js';

function makeMockGuild(channels: Array<{ id: string; name: string; type: ChannelType; parentId?: string | null }>) {
  const cache = new Map<string, any>();
  for (const ch of channels) {
    cache.set(ch.id, {
      id: ch.id,
      name: ch.name,
      type: ch.type,
      parentId: ch.parentId ?? null,
      setParent: vi.fn(async function (this: any, pid: string) { this.parentId = pid; }),
      edit: vi.fn(async function (this: any, opts: any) { if ('parent' in opts) this.parentId = opts.parent; }),
    });
  }

  let seq = 0;
  const create = vi.fn(async (opts: any) => {
    const id = `new-${++seq}`;
    const ch: any = {
      id,
      name: opts.name,
      type: opts.type,
      parentId: opts.parent ?? null,
      setParent: vi.fn(async function (this: any, pid: string) { this.parentId = pid; }),
      edit: vi.fn(async function (this: any, o: any) { if ('parent' in o) this.parentId = o.parent; }),
    };
    cache.set(id, ch);
    return ch;
  });

  return {
    id: 'guild-1',
    channels: {
      cache: {
        find: (fn: (ch: any) => boolean) => {
          for (const ch of cache.values()) {
            if (fn(ch)) return ch;
          }
          return undefined;
        },
        values: () => cache.values(),
        get: (id: string) => cache.get(id),
      },
      create,
      fetch: vi.fn(async (id: string) => cache.get(id) ?? null),
    },
    __cache: cache,
    __create: create,
  } as any;
}

describe('ensureSystemScaffold', () => {
  it('creates System category, status text channel, and crons forum', async () => {
    const guild = makeMockGuild([]);
    const res = await ensureSystemScaffold({ guild, ensureBeads: false });
    expect(res).not.toBeNull();
    expect(res?.systemCategoryId).toBeTruthy();
    expect(res?.statusChannelId).toBeTruthy();
    expect(res?.cronsForumId).toBeTruthy();
    expect(res?.beadsForumId).toBeUndefined();

    // 3 creates: category + status + crons
    expect(guild.__create).toHaveBeenCalledTimes(3);
  });

  it('moves existing channels/forums under System', async () => {
    const guild = makeMockGuild([
      { id: 'cat-other', name: 'Other', type: ChannelType.GuildCategory },
      { id: 'status-1', name: 'status', type: ChannelType.GuildText, parentId: 'cat-other' },
      { id: 'crons-1', name: 'crons', type: ChannelType.GuildForum, parentId: null },
    ]);

    const res = await ensureSystemScaffold({ guild, ensureBeads: false });
    expect(res?.systemCategoryId).toBeTruthy();
    expect(res?.statusChannelId).toBe('status-1');
    expect(res?.cronsForumId).toBe('crons-1');

    const statusCh = (guild.__cache as Map<string, any>).get('status-1');
    const cronsCh = (guild.__cache as Map<string, any>).get('crons-1');
    expect(statusCh.parentId).toBe(res?.systemCategoryId);
    expect(cronsCh.parentId).toBe(res?.systemCategoryId);
  });

  it('creates beads forum only when ensureBeads is true', async () => {
    const guild = makeMockGuild([]);
    const res = await ensureSystemScaffold({ guild, ensureBeads: true });
    expect(res?.beadsForumId).toBeTruthy();
    // 4 creates: category + status + crons + beads
    expect(guild.__create).toHaveBeenCalledTimes(4);
  });
});

