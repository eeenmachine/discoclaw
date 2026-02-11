import { describe, expect, it } from 'vitest';
import { buildThreadName, buildBeadStarterContent, getThreadIdFromBead } from './discord-sync.js';
import type { BeadData } from './types.js';

// ---------------------------------------------------------------------------
// buildThreadName
// ---------------------------------------------------------------------------

describe('buildThreadName', () => {
  it('builds name with emoji prefix and ID', () => {
    const name = buildThreadName('ws-001', 'Fix login bug', 'open');
    expect(name).toBe('\u{1F7E2} [001] Fix login bug');
  });

  it('uses yellow emoji for in_progress', () => {
    const name = buildThreadName('ws-002', 'Add feature', 'in_progress');
    expect(name).toContain('\u{1F7E1}');
  });

  it('uses checkmark for closed', () => {
    const name = buildThreadName('ws-003', 'Done task', 'closed');
    expect(name).toContain('\u2705');
  });

  it('uses prohibition for blocked', () => {
    const name = buildThreadName('ws-004', 'Blocked task', 'blocked');
    expect(name).toContain('\u{1F6AB}');
  });

  it('truncates long titles to 100 chars total', () => {
    const longTitle = 'A'.repeat(200);
    const name = buildThreadName('ws-001', longTitle, 'open');
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name).toContain('\u2026'); // ellipsis
  });

  it('defaults to open emoji for unknown status', () => {
    const name = buildThreadName('ws-001', 'Test', 'unknown_status');
    expect(name).toContain('\u{1F7E2}');
  });
});

// ---------------------------------------------------------------------------
// buildBeadStarterContent
// ---------------------------------------------------------------------------

describe('buildBeadStarterContent', () => {
  const makeBead = (overrides?: Partial<BeadData>): BeadData => ({
    id: 'ws-001',
    title: 'Test',
    description: 'A test bead',
    status: 'open',
    priority: 2,
    issue_type: 'task',
    owner: '',
    external_ref: '',
    labels: [],
    comments: [],
    created_at: '',
    updated_at: '',
    close_reason: '',
    ...overrides,
  });

  it('produces correct format with description, ID, priority, status', () => {
    const content = buildBeadStarterContent(makeBead());
    expect(content).toContain('A test bead');
    expect(content).toContain('**ID:** `ws-001`');
    expect(content).toContain('**Priority:** P2');
    expect(content).toContain('**Status:** open');
  });

  it('includes owner when present', () => {
    const content = buildBeadStarterContent(makeBead({ owner: 'alice' }));
    expect(content).toContain('**Owner:** alice');
  });

  it('omits owner when empty', () => {
    const content = buildBeadStarterContent(makeBead({ owner: '' }));
    expect(content).not.toContain('**Owner:**');
  });

  it('does not include mention lines', () => {
    const content = buildBeadStarterContent(makeBead());
    expect(content).not.toContain('<@');
  });

  it('defaults priority to P2 when undefined', () => {
    const content = buildBeadStarterContent(makeBead({ priority: undefined as any }));
    expect(content).toContain('**Priority:** P2');
  });
});

// ---------------------------------------------------------------------------
// getThreadIdFromBead
// ---------------------------------------------------------------------------

describe('getThreadIdFromBead', () => {
  const makeBead = (externalRef: string): BeadData => ({
    id: 'ws-001',
    title: 'Test',
    description: '',
    status: 'open',
    priority: 2,
    issue_type: 'task',
    owner: '',
    external_ref: externalRef,
    labels: [],
    comments: [],
    created_at: '',
    updated_at: '',
    close_reason: '',
  });

  it('extracts thread ID from discord: prefix', () => {
    expect(getThreadIdFromBead(makeBead('discord:123456789'))).toBe('123456789');
  });

  it('extracts raw numeric ID', () => {
    expect(getThreadIdFromBead(makeBead('123456789'))).toBe('123456789');
  });

  it('returns null for empty external_ref', () => {
    expect(getThreadIdFromBead(makeBead(''))).toBeNull();
  });

  it('returns null for non-discord external_ref', () => {
    expect(getThreadIdFromBead(makeBead('gh-123'))).toBeNull();
  });

  it('handles whitespace', () => {
    expect(getThreadIdFromBead(makeBead('  discord:123  '))).toBe('123');
  });
});
