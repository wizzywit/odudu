import type { SigningKey } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import {
  promoteWarning,
  promotionLabel,
  promotionOf,
  promotionReading,
  promotionText,
} from '#/features/signing-keys/services/promotion';

const NOW = new Date('2026-10-12T12:00:00Z');

function key(overrides: Partial<SigningKey>): SigningKey {
  return {
    id: 'k',
    status: 'rotating',
    kid: 'kid-k',
    alg: 'ES256',
    created_at: '2026-10-12T09:00:00Z',
    not_after: null,
    ...overrides,
  };
}

const ACTIVE = key({ id: 'a', kid: 'kid-a', status: 'active', created_at: '2026-10-01T00:00:00Z' });

describe('promotionOf', () => {
  it('is ready for a rotating key published longer than the longest token lives', () => {
    expect(promotionOf(key({}), [ACTIVE], NOW, true)).toEqual({ kind: 'ready' });
  });

  it('says when a young key becomes ready', () => {
    const young = key({ created_at: '2026-10-12T11:30:00Z' });
    expect(promotionOf(young, [ACTIVE], NOW, true)).toEqual({
      kind: 'young',
      at: new Date('2026-10-12T12:35:00Z'),
    });
  });

  it('says why a key of another algorithm than the active one is not offered', () => {
    expect(promotionOf(key({ alg: 'RS256' }), [ACTIVE], NOW, true)).toEqual({
      kind: 'algorithm',
      active: 'ES256',
    });
  });

  it('says a key older than the active one is probably the one it replaced', () => {
    const older = key({ created_at: '2026-09-01T00:00:00Z' });
    expect(promotionOf(older, [ACTIVE], NOW, true)).toEqual({ kind: 'replaced' });
  });

  it('judges nothing while the active key has not been read', () => {
    expect(promotionOf(key({}), [], NOW, false)).toEqual({ kind: 'unknown' });
  });

  it('is ready with no active key at all, once old enough', () => {
    expect(promotionOf(key({}), [], NOW, true)).toEqual({ kind: 'ready' });
  });
});

describe('what a promotion reading says', () => {
  it('labels ready and not ready', () => {
    expect(promotionLabel({ kind: 'ready' })).toBe('Ready');
    expect(promotionLabel({ kind: 'young', at: NOW })).toBe('Not ready');
    expect(promotionLabel({ kind: 'unknown' })).toBe('Unknown');
  });

  it('names the time a young key is ready from', () => {
    expect(promotionText({ kind: 'young', at: new Date('2026-10-12T12:35:00Z') })).toBe(
      'Ready from 2026-10-12 12:35:00 UTC: until then a relying party may not have fetched its public key.',
    );
  });

  it('reads a key of another algorithm as a migration, not as unready', () => {
    const reading = promotionReading({ kind: 'algorithm', active: 'ES256' });
    expect(reading).toMatchObject({ ready: false, label: 'Changes algorithm', tone: 'neutral' });
    expect(reading.text).toContain('migrate');
  });

  it('names both algorithms', () => {
    expect(promotionText({ kind: 'algorithm', active: 'ES256' })).toContain('ES256');
  });

  it('warns of nothing for a ready key, and leaves the choice with the caller otherwise', () => {
    expect(promoteWarning({ kind: 'ready' })).toBeNull();
    const warning = promoteWarning({ kind: 'replaced' });
    expect(warning).toContain('older than the active key');
    expect(warning).toContain('the server does not refuse it');
  });
});

it('reads a promotion as whether it is ready, a label and a sentence', () => {
  expect(promotionReading({ kind: 'ready' })).toEqual({
    ready: true,
    tone: 'active',
    label: 'Ready',
    text: 'Ready to promote.',
  });
  expect(promotionReading({ kind: 'replaced' })).toMatchObject({
    ready: false,
    label: 'Not ready',
  });
});
