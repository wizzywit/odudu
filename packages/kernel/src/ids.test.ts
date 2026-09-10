import { describe, expect, it } from 'vitest';
import { newId } from '#/ids';

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
