import type { SigningKey } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import { askingOf, keyRows, shownAlg } from '#/pages/signing-keys/services/rows';
import { dialogOf } from '#/pages/signing-keys/services/confirm';
import { DEFAULT_ALG } from '#/pages/signing-keys/services/stage';

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

const ACTIVE = key({ id: 'a', kid: 'kid-a', status: 'active', alg: 'RS256' });
const READY = { ready: true, tone: 'active', label: 'Ready', text: 'Ready.' } as const;

describe('keyRows', () => {
  const keys = [key({ id: 'k1' }), key({ id: 'k2' })];

  it('says how ready each key is to be promoted, in a lane that can promote', () => {
    const rows = keyRows(keys, () => READY);
    expect(rows.map((row) => row.key)).toEqual(keys);
    expect(rows.map((row) => row.readiness)).toEqual([READY, READY]);
  });
  it('says nothing of readiness in a lane that cannot promote, and does not ask', () => {
    expect(keyRows(keys, null).map((row) => row.readiness)).toEqual([null, null]);
  });

  it('names each action by the key it acts on, for a screen reader', () => {
    expect(keyRows([key({ kid: 'kid-x' })], null)[0]?.labels).toEqual({
      promote: 'Promote kid-x',
      retire: 'Retire kid-x',
      delete: 'Delete kid-x',
    });
  });
});

describe('shownAlg', () => {
  it('is the algorithm chosen, else the active key’s, else the default', () => {
    expect(shownAlg('ES256', ACTIVE)).toBe('ES256');
    expect(shownAlg(null, ACTIVE)).toBe('RS256');
    expect(shownAlg(null, undefined)).toBe(DEFAULT_ALG);
    expect(shownAlg('RS256', undefined)).toBe('RS256');
  });
});

describe('askingOf', () => {
  it('is nothing until an action is asked', () => {
    expect(askingOf(null, ACTIVE, () => ({ kind: 'ready' }))).toBeNull();
  });
  it('is the action with the dialog that confirms it', () => {
    const asked = { action: 'promote' as const, key: key({}) };
    expect(askingOf(asked, ACTIVE, () => ({ kind: 'ready' }))).toEqual({
      ...asked,
      dialog: dialogOf('promote', asked.key, ACTIVE, { kind: 'ready' }),
    });
  });
});
