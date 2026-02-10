import { describe, expect, it } from 'vitest';
import { parseBdJson } from './bd-cli.js';

// ---------------------------------------------------------------------------
// parseBdJson
// ---------------------------------------------------------------------------

describe('parseBdJson', () => {
  it('parses array output', () => {
    const input = JSON.stringify([
      { id: 'ws-001', title: 'Test', status: 'open' },
      { id: 'ws-002', title: 'Test 2', status: 'closed' },
    ]);
    const result = parseBdJson(input);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('ws-001');
    expect(result[1].id).toBe('ws-002');
  });

  it('parses single-object output', () => {
    const input = JSON.stringify({ id: 'ws-001', title: 'Test', status: 'open' });
    const result = parseBdJson(input);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ws-001');
  });

  it('strips markdown fences', () => {
    const input = '```json\n[{"id":"ws-001","title":"Test"}]\n```';
    const result = parseBdJson(input);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ws-001');
  });

  it('strips bare markdown fences (no language tag)', () => {
    const input = '```\n{"id":"ws-001","title":"Test"}\n```';
    const result = parseBdJson(input);
    expect(result).toHaveLength(1);
  });

  it('returns empty array for empty input', () => {
    expect(parseBdJson('')).toEqual([]);
    expect(parseBdJson('  \n  ')).toEqual([]);
  });

  it('throws on error-only object', () => {
    const input = JSON.stringify({ error: 'not found' });
    expect(() => parseBdJson(input)).toThrow('not found');
  });

  it('throws on malformed JSON', () => {
    expect(() => parseBdJson('{bad json}')).toThrow();
  });

  it('returns empty array for non-object JSON', () => {
    expect(parseBdJson('"just a string"')).toEqual([]);
    expect(parseBdJson('42')).toEqual([]);
    expect(parseBdJson('null')).toEqual([]);
  });
});
