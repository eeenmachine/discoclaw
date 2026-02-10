import fs from 'node:fs/promises';

/**
 * Acquire a PID lock file. Throws if another live process holds the lock.
 */
export async function acquirePidLock(lockPath: string): Promise<void> {
  try {
    const content = await fs.readFile(lockPath, 'utf-8');
    const pid = Number(content.trim());
    if (Number.isNaN(pid) || pid <= 0) {
      // Corrupt lock file — overwrite it.
    } else {
      let alive = false;
      try {
        process.kill(pid, 0); // signal 0 = existence check
        alive = true;
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EPERM') {
          alive = true; // process exists but we lack permission to signal it
        }
        // ESRCH = process is dead — stale lock, safe to overwrite.
      }
      if (alive) {
        throw new Error(
          `Another discoclaw instance is already running (PID ${pid}). ` +
            `Lock file: ${lockPath}`,
        );
      }
    }
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      // No lock file — proceed to create one.
    } else {
      throw err;
    }
  }

  await fs.writeFile(lockPath, String(process.pid), 'utf-8');
}

/**
 * Release the PID lock file, but only if it contains our PID.
 */
export async function releasePidLock(lockPath: string): Promise<void> {
  try {
    const content = await fs.readFile(lockPath, 'utf-8');
    if (content.trim() === String(process.pid)) {
      await fs.unlink(lockPath);
    }
  } catch {
    // Lock file already gone or unreadable — nothing to do.
  }
}
