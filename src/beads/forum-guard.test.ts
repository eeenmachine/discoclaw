import { describe, expect, it, vi } from 'vitest';
import { initBeadsForumGuard } from './forum-guard.js';

function makeClient(botUserId = 'bot-user-1') {
  const listeners: Record<string, Function[]> = {};
  return {
    on: vi.fn((event: string, cb: Function) => {
      (listeners[event] ??= []).push(cb);
    }),
    user: { id: botUserId },
    _listeners: listeners,
  };
}

function makeThread(overrides?: Partial<any>) {
  return {
    id: 'thread-1',
    name: 'Bead 1',
    parentId: 'beads-forum-1',
    ownerId: 'bot-user-1',
    send: vi.fn().mockResolvedValue(undefined),
    setArchived: vi.fn().mockResolvedValue(undefined),
    client: { user: { id: 'bot-user-1' } },
    ...overrides,
  };
}

describe('initBeadsForumGuard', () => {
  function setup(botUserId = 'bot-user-1') {
    const client = makeClient(botUserId);
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    initBeadsForumGuard({ client: client as any, forumId: 'beads-forum-1', log });
    const listeners = client._listeners['threadCreate'] ?? [];
    expect(listeners.length).toBeGreaterThan(0);
    return { listener: listeners[0], log };
  }

  it('rejects manually-created threads with guidance and archives', async () => {
    const { listener } = setup();
    const thread = makeThread({ ownerId: 'some-user' });
    await listener(thread);

    expect(thread.send).toHaveBeenCalledWith(expect.stringContaining('bd create'));
    expect(thread.setArchived).toHaveBeenCalledWith(true);
  });

  it('allows bot-created threads through without sending or archiving', async () => {
    const { listener } = setup();
    const thread = makeThread({ ownerId: 'bot-user-1' });
    await listener(thread);

    expect(thread.send).not.toHaveBeenCalled();
    expect(thread.setArchived).not.toHaveBeenCalled();
  });

  it('ignores threads from other forums', async () => {
    const { listener } = setup();
    const thread = makeThread({ parentId: 'other-forum', ownerId: 'some-user' });
    await listener(thread);

    expect(thread.send).not.toHaveBeenCalled();
    expect(thread.setArchived).not.toHaveBeenCalled();
  });

  it('handles send failure without preventing archive attempt', async () => {
    const { listener } = setup();
    const thread = makeThread({ ownerId: 'some-user' });
    thread.send.mockRejectedValue(new Error('Missing Access'));
    await listener(thread);

    expect(thread.setArchived).toHaveBeenCalledWith(true);
  });
});

describe('initBeadsForumGuard threadUpdate', () => {
  function setup(botUserId = 'bot-user-1') {
    const client = makeClient(botUserId);
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    initBeadsForumGuard({ client: client as any, forumId: 'beads-forum-1', log });
    const listeners = client._listeners['threadUpdate'] ?? [];
    expect(listeners.length).toBeGreaterThan(0);
    return { listener: listeners[0], log };
  }

  it('rejects unarchived manual thread', async () => {
    const { listener } = setup();
    const oldThread = makeThread({ ownerId: 'some-user', archived: true });
    const newThread = makeThread({ ownerId: 'some-user', archived: false });
    await listener(oldThread, newThread);

    expect(newThread.send).toHaveBeenCalledWith(expect.stringContaining('bd create'));
    expect(newThread.setArchived).toHaveBeenCalledWith(true);
  });

  it('allows bot-owned unarchived thread through', async () => {
    const { listener } = setup();
    const oldThread = makeThread({ archived: true });
    const newThread = makeThread({ archived: false });
    await listener(oldThread, newThread);

    expect(newThread.send).not.toHaveBeenCalled();
    expect(newThread.setArchived).not.toHaveBeenCalled();
  });

  it('ignores archive transitions (thread being archived)', async () => {
    const { listener } = setup();
    const oldThread = makeThread({ ownerId: 'some-user', archived: false });
    const newThread = makeThread({ ownerId: 'some-user', archived: true });
    await listener(oldThread, newThread);

    expect(newThread.send).not.toHaveBeenCalled();
  });
});
