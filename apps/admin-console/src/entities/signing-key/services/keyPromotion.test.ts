import { describe, expect, it } from 'vitest';
import {
  LONGEST_TOKEN_LIFETIME_SECONDS,
  promotableAt,
  readyToPromote,
  promotionOf,
} from '#/entities/signing-key/services/keyPromotion';
import type { SigningKey } from '#/entities/signing-key/types/signingKey';

const NOW = new Date('2026-09-29T12:00:00Z');

function key(overrides: Partial<SigningKey>): SigningKey {
  return {
    id: 'k',
    status: 'rotating',
    kid: 'kid',
    alg: 'ES256',
    created_at: '2026-09-29T09:00:00Z',
    not_after: null,
    ...overrides,
  };
}

function ago(seconds: number): string {
  return new Date(NOW.getTime() - seconds * 1000).toISOString();
}

const ACTIVE = key({ id: 'a', status: 'active', created_at: '2026-09-01T00:00:00Z' });

it('holds a token lifetime of an hour, the ceiling every client lifetime is held to', () => {
  expect(LONGEST_TOKEN_LIFETIME_SECONDS).toBe(3600);
});

it('is ready once it has been published longer than the longest token lifetime and five minutes', () => {
  const staged = key({ id: 'r', created_at: ago(3600 + 300 + 1) });
  expect(readyToPromote([ACTIVE, staged], NOW)).toEqual([staged]);
});

it('is not ready at exactly the lifetime and margin, nor before', () => {
  const edge = key({ id: 'edge', created_at: ago(3600 + 300) });
  const young = key({ id: 'young', created_at: ago(60) });
  expect(readyToPromote([ACTIVE, edge, young], NOW)).toEqual([]);
});

it('takes the longest lifetime it is given', () => {
  const staged = key({ id: 'r', created_at: ago(900) });
  expect(readyToPromote([ACTIVE, staged], NOW, 300)).toEqual([staged]);
  expect(readyToPromote([ACTIVE, staged], NOW, 600)).toEqual([]);
});

it('never offers an active or a retired key', () => {
  const old = ago(10 * 86_400);
  const retired = key({ id: 'x', status: 'retired', created_at: old });
  expect(readyToPromote([ACTIVE, retired], NOW)).toEqual([]);
});

it('passes over a rotating key older than the active one, which a promotion demoted', () => {
  const active = key({ id: 'new', status: 'active', created_at: ago(7200) });
  const demoted = key({ id: 'old', created_at: ago(30 * 86_400) });
  expect(readyToPromote([active, demoted], NOW)).toEqual([]);
});

it('never offers a key of another algorithm, which already signs for clients asking it', () => {
  const other = key({ id: 'rs', alg: 'RS256', created_at: ago(10 * 86_400) });
  const same = key({ id: 'es', alg: 'ES256', created_at: ago(10 * 86_400) });
  expect(readyToPromote([ACTIVE, other, same], NOW)).toEqual([same]);
});

it('offers any old rotating key when there is no active key at all', () => {
  const staged = key({ id: 'r', created_at: ago(30 * 86_400) });
  expect(readyToPromote([staged], NOW)).toEqual([staged]);
});

it('says when a rotating key becomes ready', () => {
  const staged = key({ created_at: '2026-09-29T11:00:00Z' });
  expect(promotableAt(staged).toISOString()).toBe('2026-09-29T12:05:00.000Z');
  expect(promotableAt(staged, 60).toISOString()).toBe('2026-09-29T11:06:00.000Z');
});

describe('promotionOf', () => {
  it('is ready for a rotating key published longer than the longest token lives', () => {
    expect(promotionOf(key({}), [ACTIVE], NOW, true)).toEqual({ kind: 'ready' });
  });

  it('says when a young key becomes ready', () => {
    const young = key({ created_at: '2026-09-29T11:30:00Z' });
    expect(promotionOf(young, [ACTIVE], NOW, true)).toEqual({
      kind: 'young',
      at: new Date('2026-09-29T12:35:00Z'),
    });
  });

  it('is young at exactly the lifetime and margin and ready a second after', () => {
    const at = new Date(NOW.getTime() - (3600 + 300) * 1000);
    const edge = key({ created_at: at.toISOString() });
    const over = key({ created_at: new Date(at.getTime() - 1000).toISOString() });
    expect(promotionOf(edge, [ACTIVE], NOW, true)).toEqual({ kind: 'young', at: NOW });
    expect(promotionOf(over, [ACTIVE], NOW, true)).toEqual({ kind: 'ready' });
  });

  it('says why a key of another algorithm than the active one is not offered', () => {
    expect(promotionOf(key({ alg: 'RS256' }), [ACTIVE], NOW, true)).toEqual({
      kind: 'algorithm',
      active: 'ES256',
    });
  });

  it('says a key older than the active one is probably the one it replaced', () => {
    const older = key({ created_at: '2026-08-01T00:00:00Z' });
    expect(promotionOf(older, [ACTIVE], NOW, true)).toEqual({ kind: 'replaced' });
  });

  it('judges nothing while the active key has not been read', () => {
    expect(promotionOf(key({}), [], NOW, false)).toEqual({ kind: 'unknown' });
  });

  it('is ready with no active key at all, once old enough', () => {
    expect(promotionOf(key({}), [], NOW, true)).toEqual({ kind: 'ready' });
  });
});
