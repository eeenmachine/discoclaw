import { describe, expect, it, vi } from 'vitest';
import { ChannelType } from 'discord.js';
import { executeGuildAction } from './actions-guild.js';
import type { ActionContext } from './actions.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockMember(overrides: Partial<any> = {}) {
  const roles = new Map<string, any>();
  for (const r of (overrides.roles ?? [])) {
    roles.set(r.id, r);
  }

  return {
    id: overrides.id ?? 'user1',
    displayName: overrides.displayName ?? 'TestUser',
    user: {
      username: overrides.username ?? 'testuser',
      bot: overrides.bot ?? false,
    },
    joinedAt: overrides.joinedAt ?? new Date('2024-01-01T00:00:00Z'),
    roles: {
      cache: {
        filter: (fn: any) => {
          const filtered = [...roles.values()].filter(fn);
          return { map: (mapFn: any) => filtered.map(mapFn) };
        },
        values: () => roles.values(),
      },
      add: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    },
    timeout: vi.fn(async () => {}),
    kick: vi.fn(async () => {}),
    ban: vi.fn(async () => {}),
  };
}

function makeCtx(overrides: Partial<any> = {}): ActionContext {
  const channels = new Map<string, any>();
  for (const ch of (overrides.channels ?? [])) {
    channels.set(ch.id, ch);
  }

  const roles = new Map<string, any>();
  for (const r of (overrides.roles ?? [])) {
    roles.set(r.id, r);
  }

  const members = new Map<string, any>();
  for (const m of (overrides.members ?? [])) {
    members.set(m.id, m);
  }

  return {
    guild: {
      channels: {
        cache: {
          get: (id: string) => channels.get(id),
          find: (fn: any) => {
            for (const ch of channels.values()) {
              if (fn(ch)) return ch;
            }
            return undefined;
          },
          values: () => channels.values(),
        },
      },
      members: {
        fetch: vi.fn(async (id: string) => {
          const m = members.get(id);
          if (!m) throw new Error('not found');
          return m;
        }),
      },
      roles: {
        cache: {
          get: (id: string) => roles.get(id),
          find: (fn: any) => {
            for (const r of roles.values()) {
              if (fn(r)) return r;
            }
            return undefined;
          },
          values: () => roles.values(),
        },
      },
      scheduledEvents: {
        fetch: vi.fn(async (idOrUndefined?: string) => {
          if (typeof idOrUndefined === 'string') {
            const ev = (overrides.events as Map<string, any>)?.get(idOrUndefined);
            if (!ev) throw new Error('not found');
            return ev;
          }
          return overrides.events ?? new Map();
        }),
        create: vi.fn(async (opts: any) => ({ name: opts.name })),
        edit: vi.fn(async (_id: string, opts: any) => ({ name: opts.name ?? 'Edited Event' })),
        delete: vi.fn(async () => {}),
      },
    } as any,
    client: {} as any,
    channelId: 'ch1',
    messageId: 'msg1',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('memberInfo', () => {
  it('returns member info', async () => {
    const member = makeMockMember({
      id: 'u1',
      username: 'alice',
      displayName: 'Alice',
      roles: [{ id: 'r1', name: 'Admin' }],
    });
    const ctx = makeCtx({ members: [member] });

    const result = await executeGuildAction(
      { type: 'memberInfo', userId: 'u1' },
      ctx,
    );

    expect(result.ok).toBe(true);
    const summary = (result as any).summary as string;
    expect(summary).toContain('Username: alice');
    expect(summary).toContain('Display: Alice');
    expect(summary).toContain('Admin');
  });

  it('fails when member not found', async () => {
    const ctx = makeCtx({});
    const result = await executeGuildAction(
      { type: 'memberInfo', userId: 'nonexistent' },
      ctx,
    );
    expect(result).toEqual({ ok: false, error: 'Member "nonexistent" not found' });
  });
});

describe('roleInfo', () => {
  it('lists roles sorted by position', async () => {
    const roles = [
      { id: 'r1', name: 'Admin', position: 2, members: { size: 3 } },
      { id: 'r2', name: 'Member', position: 1, members: { size: 10 } },
    ];
    const ctx = makeCtx({ roles });

    const result = await executeGuildAction({ type: 'roleInfo' }, ctx);

    expect(result.ok).toBe(true);
    const summary = (result as any).summary as string;
    expect(summary).toContain('Admin');
    expect(summary).toContain('Member');
    // Admin should come first (higher position).
    expect(summary.indexOf('Admin')).toBeLessThan(summary.indexOf('Member'));
  });
});

describe('roleAdd / roleRemove', () => {
  it('adds a role by name', async () => {
    const member = makeMockMember({ id: 'u1', displayName: 'Alice' });
    const role = { id: 'r1', name: 'Moderator', position: 1 };
    const ctx = makeCtx({ members: [member], roles: [role] });

    const result = await executeGuildAction(
      { type: 'roleAdd', userId: 'u1', role: 'Moderator' },
      ctx,
    );

    expect(result).toEqual({ ok: true, summary: 'Added role "Moderator" to Alice' });
    expect(member.roles.add).toHaveBeenCalledWith('r1');
  });

  it('removes a role by name', async () => {
    const member = makeMockMember({ id: 'u1', displayName: 'Alice' });
    const role = { id: 'r1', name: 'Moderator', position: 1 };
    const ctx = makeCtx({ members: [member], roles: [role] });

    const result = await executeGuildAction(
      { type: 'roleRemove', userId: 'u1', role: 'Moderator' },
      ctx,
    );

    expect(result).toEqual({ ok: true, summary: 'Removed role "Moderator" from Alice' });
    expect(member.roles.remove).toHaveBeenCalledWith('r1');
  });

  it('fails when role not found', async () => {
    const member = makeMockMember({ id: 'u1' });
    const ctx = makeCtx({ members: [member] });

    const result = await executeGuildAction(
      { type: 'roleAdd', userId: 'u1', role: 'Nonexistent' },
      ctx,
    );

    expect(result).toEqual({ ok: false, error: 'Role "Nonexistent" not found' });
  });
});

describe('searchMessages', () => {
  it('finds matching messages', async () => {
    const msg1 = { id: 'm1', content: 'Hello world', author: { username: 'alice' } };
    const msg2 = { id: 'm2', content: 'Goodbye', author: { username: 'bob' } };
    const messages = new Map([['m1', msg1], ['m2', msg2]]);

    const ch = {
      id: 'ch1',
      name: 'general',
      type: ChannelType.GuildText,
      messages: { fetch: vi.fn(async () => messages) },
    };
    const ctx = makeCtx({ channels: [ch] });

    const result = await executeGuildAction(
      { type: 'searchMessages', query: 'hello', channel: '#general' },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect((result as any).summary).toContain('[alice] Hello world');
    expect((result as any).summary).not.toContain('Goodbye');
  });
});

describe('eventList', () => {
  it('lists events', async () => {
    const events = new Map([
      ['e1', { id: 'e1', name: 'Team Meeting', scheduledStartAt: new Date('2025-02-01T15:00:00Z'), description: 'Weekly sync' }],
    ]);
    const ctx = makeCtx({ events });

    const result = await executeGuildAction({ type: 'eventList' }, ctx);

    expect(result.ok).toBe(true);
    expect((result as any).summary).toContain('Team Meeting (id:e1)');
  });

  it('shows empty message when no events', async () => {
    const ctx = makeCtx({ events: new Map() });
    const result = await executeGuildAction({ type: 'eventList' }, ctx);
    expect(result).toEqual({ ok: true, summary: 'No scheduled events' });
  });
});

describe('eventCreate', () => {
  it('creates an external event with location', async () => {
    const ctx = makeCtx({});

    const result = await executeGuildAction(
      {
        type: 'eventCreate',
        name: 'Offsite',
        startTime: '2025-03-01T10:00:00Z',
        location: 'Conference Room A',
      },
      ctx,
    );

    expect(result).toEqual({ ok: true, summary: 'Created event "Offsite"' });
    expect((ctx.guild as any).scheduledEvents.create).toHaveBeenCalled();
  });

  it('fails with invalid startTime', async () => {
    const ctx = makeCtx({});

    const result = await executeGuildAction(
      { type: 'eventCreate', name: 'Bad', startTime: 'not-a-date' },
      ctx,
    );

    expect(result).toEqual({ ok: false, error: 'Invalid startTime: "not-a-date"' });
  });
});

describe('eventEdit', () => {
  it('edits an event name', async () => {
    const ctx = makeCtx({});

    const result = await executeGuildAction(
      { type: 'eventEdit', eventId: 'e1', name: 'New Name' },
      ctx,
    );

    expect(result).toEqual({ ok: true, summary: 'Edited event "New Name"' });
    expect((ctx.guild as any).scheduledEvents.edit).toHaveBeenCalledWith('e1', { name: 'New Name' });
  });

  it('edits multiple fields', async () => {
    const ctx = makeCtx({});

    const result = await executeGuildAction(
      { type: 'eventEdit', eventId: 'e1', name: 'Updated', description: 'New desc', startTime: '2025-06-01T10:00:00Z' },
      ctx,
    );

    expect(result.ok).toBe(true);
    const call = (ctx.guild as any).scheduledEvents.edit.mock.calls[0];
    expect(call[0]).toBe('e1');
    expect(call[1]).toMatchObject({ name: 'Updated', description: 'New desc' });
    expect(call[1].scheduledStartTime).toBeDefined();
  });

  it('fails when no fields provided', async () => {
    const ctx = makeCtx({});

    const result = await executeGuildAction(
      { type: 'eventEdit', eventId: 'e1' },
      ctx,
    );

    expect(result).toEqual({ ok: false, error: 'eventEdit requires at least one field to update' });
  });

  it('fails with invalid startTime', async () => {
    const ctx = makeCtx({});

    const result = await executeGuildAction(
      { type: 'eventEdit', eventId: 'e1', startTime: 'nope' },
      ctx,
    );

    expect(result).toEqual({ ok: false, error: 'Invalid startTime: "nope"' });
  });

  it('fails with invalid endTime', async () => {
    const ctx = makeCtx({});

    const result = await executeGuildAction(
      { type: 'eventEdit', eventId: 'e1', endTime: 'bad' },
      ctx,
    );

    expect(result).toEqual({ ok: false, error: 'Invalid endTime: "bad"' });
  });
});

describe('eventDelete', () => {
  it('deletes an event and shows its name', async () => {
    const events = new Map([
      ['e1', { id: 'e1', name: 'Team Meeting' }],
    ]);
    const ctx = makeCtx({ events });

    const result = await executeGuildAction(
      { type: 'eventDelete', eventId: 'e1' },
      ctx,
    );

    expect(result).toEqual({ ok: true, summary: 'Deleted event "Team Meeting"' });
    expect((ctx.guild as any).scheduledEvents.delete).toHaveBeenCalledWith('e1');
  });

  it('falls back to eventId when event not found for name', async () => {
    const ctx = makeCtx({});

    const result = await executeGuildAction(
      { type: 'eventDelete', eventId: 'unknown-id' },
      ctx,
    );

    expect(result).toEqual({ ok: true, summary: 'Deleted event "unknown-id"' });
    expect((ctx.guild as any).scheduledEvents.delete).toHaveBeenCalledWith('unknown-id');
  });
});
