import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildCronThreadName, formatStatusMessage, seedTagMap } from './discord-sync.js';
import type { CronRunRecord } from './run-stats.js';

describe('buildCronThreadName', () => {
  it('prefixes with cadence emoji', () => {
    expect(buildCronThreadName('Morning Report', 'daily')).toBe('\uD83C\uDF05 Morning Report');
  });

  it('uses frequent emoji', () => {
    expect(buildCronThreadName('Health Check', 'frequent')).toBe('\u23F1 Health Check');
  });

  it('omits emoji when cadence is null', () => {
    expect(buildCronThreadName('Some Job', null)).toBe('Some Job');
  });

  it('truncates long names to 100 chars', () => {
    const longName = 'x'.repeat(120);
    const result = buildCronThreadName(longName, 'daily');
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result).toContain('\u2026');
  });
});

describe('formatStatusMessage', () => {
  it('includes cronId token', () => {
    const record: CronRunRecord = {
      cronId: 'cron-abc12345',
      threadId: 'thread-1',
      runCount: 5,
      lastRunAt: '2025-01-15T10:00:00Z',
      lastRunStatus: 'success',
      cadence: 'daily',
      purposeTags: ['monitoring', 'cleanup'],
      disabled: false,
      model: 'haiku',
    };
    const msg = formatStatusMessage('cron-abc12345', record);
    expect(msg).toContain('[cronId:cron-abc12345]');
    expect(msg).toContain('Runs:** 5');
    expect(msg).toContain('haiku');
    expect(msg).toContain('daily');
    expect(msg).toContain('monitoring, cleanup');
  });

  it('shows error details', () => {
    const record: CronRunRecord = {
      cronId: 'cron-err1',
      threadId: 'thread-2',
      runCount: 1,
      lastRunAt: '2025-01-15T10:00:00Z',
      lastRunStatus: 'error',
      lastErrorMessage: 'timeout exceeded',
      cadence: null,
      purposeTags: [],
      disabled: false,
      model: null,
    };
    const msg = formatStatusMessage('cron-err1', record);
    expect(msg).toContain('\u274C');
    expect(msg).toContain('timeout exceeded');
  });

  it('shows model override when present', () => {
    const record: CronRunRecord = {
      cronId: 'cron-ovr',
      threadId: 'thread-3',
      runCount: 0,
      lastRunAt: null,
      lastRunStatus: null,
      cadence: 'hourly',
      purposeTags: [],
      disabled: false,
      model: 'haiku',
      modelOverride: 'opus',
    };
    const msg = formatStatusMessage('cron-ovr', record);
    expect(msg).toContain('opus');
  });

  it('shows N/A when no model or cadence', () => {
    const record: CronRunRecord = {
      cronId: 'cron-na',
      threadId: 'thread-4',
      runCount: 0,
      lastRunAt: null,
      lastRunStatus: null,
      cadence: null,
      purposeTags: [],
      disabled: false,
      model: null,
    };
    const msg = formatStatusMessage('cron-na', record);
    expect(msg).toContain('N/A');
  });
});

describe('seedTagMap', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cron-seed-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('copies seed file when target does not exist', async () => {
    const seedPath = path.join(tmpDir, 'seed.json');
    const targetPath = path.join(tmpDir, 'sub', 'target.json');
    await fs.writeFile(seedPath, '{"test": ""}', 'utf8');

    const seeded = await seedTagMap(seedPath, targetPath);
    expect(seeded).toBe(true);

    const content = await fs.readFile(targetPath, 'utf8');
    expect(content).toBe('{"test": ""}');
  });

  it('does not overwrite existing target', async () => {
    const seedPath = path.join(tmpDir, 'seed.json');
    const targetPath = path.join(tmpDir, 'target.json');
    await fs.writeFile(seedPath, '{"new": ""}', 'utf8');
    await fs.writeFile(targetPath, '{"existing": "123"}', 'utf8');

    const seeded = await seedTagMap(seedPath, targetPath);
    expect(seeded).toBe(false);

    const content = await fs.readFile(targetPath, 'utf8');
    expect(content).toBe('{"existing": "123"}');
  });
});
