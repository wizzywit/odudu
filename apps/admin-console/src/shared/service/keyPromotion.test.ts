import type { SigningKey } from '@odudu/contracts/admin';
import { expect, it } from 'vitest';
import {
  LONGEST_TOKEN_LIFETIME_SECONDS,
  promotableAt,
  readyToPromote,
} from '#/shared/service/keyPromotion.ts';

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

it('offers any old rotating key when there is no active key at all', () => {
  const staged = key({ id: 'r', created_at: ago(30 * 86_400) });
  expect(readyToPromote([staged], NOW)).toEqual([staged]);
});

it('says when a rotating key becomes ready', () => {
  const staged = key({ created_at: '2026-09-29T11:00:00Z' });
  expect(promotableAt(staged).toISOString()).toBe('2026-09-29T12:05:00.000Z');
  expect(promotableAt(staged, 60).toISOString()).toBe('2026-09-29T11:06:00.000Z');
});
