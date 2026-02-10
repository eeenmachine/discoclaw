import { describe, expect, it, vi } from 'vitest';
import { ChannelType } from 'discord.js';
import { parseDiscordActions, executeDiscordActions } from './actions.js';

// ---------------------------------------------------------------------------
// parseDiscordActions
// ---------------------------------------------------------------------------

describe('parseDiscordActions', () => {
  it('extracts a single action and strips it from text', () => {
    const input = 'Here is the list:\n<discord-action>{"type":"channelList"}</discord-action>\nDone.';
    const { cleanText, actions } = parseDiscordActions(input);
    expect(actions).toEqual([{ type: 'channelList' }]);
    expect(cleanText).toBe('Here is the list:\n\nDone.');
  });

  it('extracts multiple actions', () => {
    const input =
      '<discord-action>{"type":"channelCreate","name":"status","parent":"Dev"}</discord-action>' +
      '<discord-action>{"type":"channelList"}</discord-action>';
    const { actions } = parseDiscordActions(input);
    expect(actions).toHaveLength(2);
    expect(actions[0]).toEqual({ type: 'channelCreate', name: 'status', parent: 'Dev' });
    expect(actions[1]).toEqual({ type: 'channelList' });
  });

  it('skips malformed JSON gracefully', () => {
    const input = '<discord-action>{bad json}</discord-action>Some text';
    const { cleanText, actions } = parseDiscordActions(input);
    expect(actions).toHaveLength(0);
    expect(cleanText).toBe('Some text');
  });

  it('skips unknown action types', () => {
    const input = '<discord-action>{"type":"channelDelete","id":"123"}</discord-action>';
    const { actions } = parseDiscordActions(input);
    expect(actions).toHaveLength(0);
  });

  it('returns original text when no actions present', () => {
    const input = 'Just a normal message.';
    const { cleanText, actions } = parseDiscordActions(input);
    expect(actions).toHaveLength(0);
    expect(cleanText).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// executeDiscordActions — mocked guild
// ---------------------------------------------------------------------------

function makeMockGuild(channels: Array<{ id: string; name: string; type: ChannelType; parentName?: string }>) {
  const cache = new Map<string, any>();
  for (const ch of channels) {
    cache.set(ch.id, {
      id: ch.id,
      name: ch.name,
      type: ch.type,
      parent: ch.parentName ? { name: ch.parentName } : null,
    });
  }

  return {
    channels: {
      cache: {
        find: (fn: (ch: any) => boolean) => {
          for (const ch of cache.values()) {
            if (fn(ch)) return ch;
          }
          return undefined;
        },
        values: () => cache.values(),
        get size() { return cache.size; },
      },
      create: vi.fn(async (opts: any) => ({
        name: opts.name,
        id: 'new-id',
      })),
    },
  } as any;
}

describe('executeDiscordActions', () => {
  it('channelCreate succeeds with parent category', async () => {
    const guild = makeMockGuild([
      { id: 'cat1', name: 'Dev', type: ChannelType.GuildCategory },
    ]);

    const results = await executeDiscordActions(
      [{ type: 'channelCreate', name: 'status', parent: 'Dev', topic: 'Status updates' }],
      guild,
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ ok: true, summary: 'Created #status under Dev' });
    expect(guild.channels.create).toHaveBeenCalledWith({
      name: 'status',
      type: ChannelType.GuildText,
      parent: 'cat1',
      topic: 'Status updates',
    });
  });

  it('channelCreate fails when parent category not found', async () => {
    const guild = makeMockGuild([]);

    const results = await executeDiscordActions(
      [{ type: 'channelCreate', name: 'status', parent: 'NonExistent' }],
      guild,
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ ok: false, error: 'Category "NonExistent" not found' });
  });

  it('channelCreate without parent', async () => {
    const guild = makeMockGuild([]);

    const results = await executeDiscordActions(
      [{ type: 'channelCreate', name: 'general' }],
      guild,
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ ok: true, summary: 'Created #general' });
    expect(guild.channels.create).toHaveBeenCalledWith({
      name: 'general',
      type: ChannelType.GuildText,
      parent: undefined,
      topic: undefined,
    });
  });

  it('channelList groups by category', async () => {
    const guild = makeMockGuild([
      { id: 'cat1', name: 'Dev', type: ChannelType.GuildCategory },
      { id: 'ch1', name: 'general', type: ChannelType.GuildText, parentName: 'Dev' },
      { id: 'ch2', name: 'random', type: ChannelType.GuildText },
    ]);

    const results = await executeDiscordActions([{ type: 'channelList' }], guild);

    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    const summary = (results[0] as { ok: true; summary: string }).summary;
    expect(summary).toContain('#random');
    expect(summary).toContain('Dev: #general');
  });

  it('handles API errors gracefully', async () => {
    const guild = makeMockGuild([]);
    guild.channels.create = vi.fn(async () => {
      throw new Error('Missing Permissions');
    });

    const results = await executeDiscordActions(
      [{ type: 'channelCreate', name: 'test' }],
      guild,
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ ok: false, error: 'Missing Permissions' });
  });

  it('one failure does not block subsequent actions', async () => {
    const guild = makeMockGuild([
      { id: 'ch1', name: 'general', type: ChannelType.GuildText },
    ]);
    guild.channels.create = vi.fn(async () => {
      throw new Error('Missing Permissions');
    });

    const results = await executeDiscordActions(
      [
        { type: 'channelCreate', name: 'test' },
        { type: 'channelList' },
      ],
      guild,
    );

    expect(results).toHaveLength(2);
    expect(results[0].ok).toBe(false);
    expect(results[1].ok).toBe(true);
  });
});
