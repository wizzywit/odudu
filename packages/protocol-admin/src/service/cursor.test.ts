import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { coerceLimit, decodeCursor, encodeCursor, filterDigest } from '#/service/cursor';

const KEY = new Uint8Array(32).fill(7);
const NO_FILTERS = filterDigest({});

// Mirrors the module's own framing, to build a payload with no `filters`
// member — the shape any cursor minted before this task would have.
function frameWithoutFilters(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload);
  const hmacKey = createHash('sha256').update(KEY).update('odudu-admin-cursor-v1').digest();
  const tag = createHmac('sha256', hmacKey).update(json).digest('base64url');
  return `${Buffer.from(json, 'utf8').toString('base64url')}.${tag}`;
}

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

describe('filterDigest', () => {
  it('treats an explicit undefined the same as an absent key', () => {
    expect(filterDigest({ a: undefined })).toBe(filterDigest({}));
  });

  it('is order-independent over its entries', () => {
    expect(filterDigest({ a: '1', b: '2' })).toBe(filterDigest({ b: '2', a: '1' }));
  });

  it('differs when a value differs', () => {
    expect(filterDigest({ a: '1' })).not.toBe(filterDigest({ a: '2' }));
  });
});

describe('decodeCursor', () => {
  it('round-trips a cursor for its own collection and tenant', () => {
    const raw = encodeCursor(KEY, {
      after: 'a-uuid',
      collection: 'subjects',
      tenantId: 't1',
      filters: NO_FILTERS,
    });
    expect(decodeCursor(KEY, 'subjects', 't1', NO_FILTERS, raw)).toEqual({
      kind: 'ok',
      after: 'a-uuid',
    });
  });

  it('round-trips a cursor carrying a sort value', () => {
    const raw = encodeCursor(KEY, {
      after: 'a-uuid',
      sort: 'created_at:2026-01-01',
      collection: 'subjects',
      tenantId: 't1',
      filters: NO_FILTERS,
    });
    expect(decodeCursor(KEY, 'subjects', 't1', NO_FILTERS, raw)).toEqual({
      kind: 'ok',
      after: 'a-uuid',
      sort: 'created_at:2026-01-01',
    });
  });

  it('refuses a cursor minted for another collection', () => {
    const raw = encodeCursor(KEY, {
      after: 'a-uuid',
      collection: 'clients',
      tenantId: 't1',
      filters: NO_FILTERS,
    });
    expect(decodeCursor(KEY, 'subjects', 't1', NO_FILTERS, raw)).toEqual({ kind: 'invalid' });
  });

  it('refuses a cursor minted for another tenant', () => {
    const raw = encodeCursor(KEY, {
      after: 'a-uuid',
      collection: 'subjects',
      tenantId: 't2',
      filters: NO_FILTERS,
    });
    expect(decodeCursor(KEY, 'subjects', 't1', NO_FILTERS, raw)).toEqual({ kind: 'invalid' });
  });

  it('decodes under the same filters', () => {
    const filters = filterDigest({ event_type: 'admin_mutation' });
    const raw = encodeCursor(KEY, {
      after: 'a-uuid',
      collection: 'audit',
      tenantId: 't1',
      filters,
    });
    expect(decodeCursor(KEY, 'audit', 't1', filters, raw)).toEqual({ kind: 'ok', after: 'a-uuid' });
  });

  it('refuses the same cursor replayed under a different digest', () => {
    const minted = filterDigest({ event_type: 'admin_mutation' });
    const replayed = filterDigest({ event_type: 'token' });
    const raw = encodeCursor(KEY, {
      after: 'a-uuid',
      collection: 'audit',
      tenantId: 't1',
      filters: minted,
    });
    expect(decodeCursor(KEY, 'audit', 't1', replayed, raw)).toEqual({ kind: 'invalid' });
  });

  it('decodes when the same filters were built in another order', () => {
    const minted = filterDigest({ event_type: 'admin_mutation', outcome: 'allowed' });
    const raw = encodeCursor(KEY, {
      after: 'a-uuid',
      collection: 'audit',
      tenantId: 't1',
      filters: minted,
    });
    const replayed = filterDigest({ outcome: 'allowed', event_type: 'admin_mutation' });
    expect(decodeCursor(KEY, 'audit', 't1', replayed, raw)).toEqual({
      kind: 'ok',
      after: 'a-uuid',
    });
  });

  it('refuses a hand-written cursor', () => {
    const forged = Buffer.from(
      JSON.stringify({
        after: 'a-uuid',
        collection: 'subjects',
        tenantId: 't1',
        filters: NO_FILTERS,
      }),
    ).toString('base64url');
    expect(decodeCursor(KEY, 'subjects', 't1', NO_FILTERS, forged)).toEqual({ kind: 'invalid' });
  });

  it('refuses an old-format cursor carrying no filters member', () => {
    const raw = frameWithoutFilters({ after: 'a-uuid', collection: 'subjects', tenantId: 't1' });
    expect(decodeCursor(KEY, 'subjects', 't1', NO_FILTERS, raw)).toEqual({ kind: 'invalid' });
  });

  it('refuses a cursor whose tag was tampered with', () => {
    const raw = encodeCursor(KEY, {
      after: 'a-uuid',
      collection: 'subjects',
      tenantId: 't1',
      filters: NO_FILTERS,
    });
    const tampered = `${raw.slice(0, -2)}${raw.endsWith('aa') ? 'bb' : 'aa'}`;
    expect(decodeCursor(KEY, 'subjects', 't1', NO_FILTERS, tampered)).toEqual({ kind: 'invalid' });
  });
});
