import { describe, expect, it } from 'vitest';

import { isAllowlisted, parseAllowChannelIds, parseAllowUserIds } from './allowlist.js';

describe('parseAllowUserIds', () => {
  it('parses comma/space separated IDs', () => {
    expect(parseAllowUserIds(' 123, 456 789 ')).toEqual(new Set(['123', '456', '789']));
  });

  it('drops non-numeric tokens', () => {
    expect(parseAllowUserIds('abc 123 def')).toEqual(new Set(['123']));
  });
});

describe('parseAllowChannelIds', () => {
  it('parses comma/space separated IDs', () => {
    expect(parseAllowChannelIds(' 1,2  3 ')).toEqual(new Set(['1', '2', '3']));
  });
});

describe('isAllowlisted', () => {
  it('fails closed when the allowlist is empty', () => {
    expect(isAllowlisted(new Set(), '123')).toBe(false);
  });

  it('allows when userId is present', () => {
    expect(isAllowlisted(new Set(['123']), '123')).toBe(true);
    expect(isAllowlisted(new Set(['123']), '456')).toBe(false);
  });
});

