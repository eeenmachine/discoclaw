import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import { acquirePidLock, releasePidLock } from './pidlock.js';

async function tmpLockPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pidlock-'));
  return path.join(dir, 'discoclaw.pid');
}

describe('acquirePidLock', () => {
  const paths: string[] = [];
  afterEach(async () => {
    for (const p of paths) {
      await fs.rm(path.dirname(p), { recursive: true, force: true });
    }
    paths.length = 0;
  });

  it('creates a lock file with the current PID', async () => {
    const lockPath = await tmpLockPath();
    paths.push(lockPath);

    await acquirePidLock(lockPath);

    const content = await fs.readFile(lockPath, 'utf-8');
    expect(content).toBe(String(process.pid));
  });

  it('overwrites a stale lock (dead PID)', async () => {
    const lockPath = await tmpLockPath();
    paths.push(lockPath);

    // Write a PID that (almost certainly) doesn't exist.
    await fs.writeFile(lockPath, '999999999', 'utf-8');

    await acquirePidLock(lockPath);

    const content = await fs.readFile(lockPath, 'utf-8');
    expect(content).toBe(String(process.pid));
  });

  it('throws when a live process holds the lock', async () => {
    const lockPath = await tmpLockPath();
    paths.push(lockPath);

    // PID 1 (init/systemd) is always alive.
    await fs.writeFile(lockPath, '1', 'utf-8');

    await expect(acquirePidLock(lockPath)).rejects.toThrow(/already running.*PID 1/);
  });

  it('overwrites a corrupt lock file', async () => {
    const lockPath = await tmpLockPath();
    paths.push(lockPath);

    await fs.writeFile(lockPath, 'not-a-pid', 'utf-8');

    await acquirePidLock(lockPath);

    const content = await fs.readFile(lockPath, 'utf-8');
    expect(content).toBe(String(process.pid));
  });
});

describe('releasePidLock', () => {
  const paths: string[] = [];
  afterEach(async () => {
    for (const p of paths) {
      await fs.rm(path.dirname(p), { recursive: true, force: true });
    }
    paths.length = 0;
  });

  it('removes the lock file when it contains our PID', async () => {
    const lockPath = await tmpLockPath();
    paths.push(lockPath);

    await fs.writeFile(lockPath, String(process.pid), 'utf-8');

    await releasePidLock(lockPath);

    await expect(fs.access(lockPath)).rejects.toThrow();
  });

  it('does not remove the lock file when it contains a different PID', async () => {
    const lockPath = await tmpLockPath();
    paths.push(lockPath);

    await fs.writeFile(lockPath, '1', 'utf-8');

    await releasePidLock(lockPath);

    const content = await fs.readFile(lockPath, 'utf-8');
    expect(content).toBe('1');
  });

  it('does nothing when the lock file does not exist', async () => {
    const lockPath = await tmpLockPath();
    paths.push(lockPath);

    // Should not throw.
    await releasePidLock(lockPath);
  });
});
