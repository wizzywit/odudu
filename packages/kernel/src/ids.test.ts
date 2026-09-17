import { describe, expect, it } from 'vitest';
import { isUuid, newId } from '#/ids';

describe('newId', () => {
  it('produces a UUID with version nibble 7', () => {
    expect(newId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('produces distinct values', () => {
    const ids = new Set(Array.from({ length: 1_000 }, () => newId()));
    expect(ids.size).toBe(1_000);
  });

  it('sorts lexicographically in creation order', () => {
    const ids = Array.from({ length: 100 }, () => newId());
    expect([...ids].sort()).toEqual(ids);
  });
});

// Postgres raises on a `uuid` comparison against anything it cannot parse,
// so this is the check that stands between a form field and an unhandled
// database error.
describe('isUuid', () => {
  it('accepts what newId produces', () => {
    expect(isUuid(newId())).toBe(true);
  });

  it('accepts a uuid of any version or variant, and either case', () => {
    expect(isUuid('01a0a992-4657-7d89-8fbf-3385f54810d4')).toBe(true);
    expect(isUuid('00000000-0000-0000-0000-000000000000')).toBe(true);
    expect(isUuid('F47AC10B-58CC-4372-A567-0E02B2C3D479')).toBe(true);
  });

  it('refuses everything Postgres would raise on', () => {
    for (const candidate of [
      '',
      'not-a-uuid',
      '01a0a992-4657-7d89-8fbf',
      '01a0a992-4657-7d89-8fbf-3385f54810d4x',
      // Two ids joined by a newline: what a page carrying the field in more
      // than one form gives a client that extracts every match.
      '01a0a992-4657-7d89-8fbf-3385f54810d4\n01a0a992-4657-7d89-8fbf-3385f54810d4',
      "01a0a992-4657-7d89-8fbf-3385f54810d4' or '1'='1",
      ' 01a0a992-4657-7d89-8fbf-3385f54810d4 ',
    ]) {
      expect(isUuid(candidate), `expected ${JSON.stringify(candidate)} to be refused`).toBe(false);
    }
  });
});
