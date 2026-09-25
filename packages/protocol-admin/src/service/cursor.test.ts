import { describe, expect, it } from 'vitest';
import { coerceLimit, decodeCursor, encodeCursor } from '#/service/cursor';

const KEY = new Uint8Array(32).fill(7);

describe('coerceLimit', () => {
  it('defaults, and coerces down rather than refusing', () => {
    expect(coerceLimit(undefined)).toBe(50);
    expect(coerceLimit('10')).toBe(10);
    expect(coerceLimit('100000')).toBe(200);
  });

  it('refuses a limit that is not a positive integer', () => {
    for (const raw of ['0', '-1', '1.5', '1e3', ' 7 ', '']) {
      expect(() => coerceLimit(raw), raw).toThrow();
    }
  });
});

describe('decodeCursor', () => {
  it('round-trips a cursor for its own collection and tenant', () => {
    const raw = encodeCursor(KEY, { after: 'a-uuid', collection: 'subjects', tenantId: 't1' });
    expect(decodeCursor(KEY, 'subjects', 't1', raw)).toEqual({ kind: 'ok', after: 'a-uuid' });
  });

  it('refuses a cursor minted for another collection', () => {
    const raw = encodeCursor(KEY, { after: 'a-uuid', collection: 'clients', tenantId: 't1' });
    expect(decodeCursor(KEY, 'subjects', 't1', raw)).toEqual({ kind: 'invalid' });
  });

  it('refuses a cursor minted for another tenant', () => {
    const raw = encodeCursor(KEY, { after: 'a-uuid', collection: 'subjects', tenantId: 't2' });
    expect(decodeCursor(KEY, 'subjects', 't1', raw)).toEqual({ kind: 'invalid' });
  });

  it('refuses a hand-written cursor', () => {
    const forged = Buffer.from(
      JSON.stringify({ after: 'a-uuid', collection: 'subjects', tenantId: 't1' }),
    ).toString('base64url');
    expect(decodeCursor(KEY, 'subjects', 't1', forged)).toEqual({ kind: 'invalid' });
  });

  it('refuses a cursor whose tag was tampered with', () => {
    const raw = encodeCursor(KEY, { after: 'a-uuid', collection: 'subjects', tenantId: 't1' });
    const tampered = `${raw.slice(0, -2)}${raw.endsWith('aa') ? 'bb' : 'aa'}`;
    expect(decodeCursor(KEY, 'subjects', 't1', tampered)).toEqual({ kind: 'invalid' });
  });
});
