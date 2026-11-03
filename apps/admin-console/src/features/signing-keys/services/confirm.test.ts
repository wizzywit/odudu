import type { SigningKey } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import {
  deleteKeyConsequence,
  dialogOf,
  promoteConsequence,
  retireConsequence,
  retireTyped,
} from '#/features/signing-keys/services/confirm';

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

describe('promoteConsequence', () => {
  it('says which key signs from now on and what happens to the one it replaces', () => {
    const text = promoteConsequence(key({}), ACTIVE, { kind: 'ready' });
    expect(text).toContain('this ES256 key signs every new token');
    expect(text).toContain('RS256 key kid-a');
    expect(text).toContain('stays published');
  });

  it('adds why it is not ready when it is not', () => {
    const text = promoteConsequence(key({}), ACTIVE, {
      kind: 'young',
      at: new Date('2026-10-12T12:35:00Z'),
    });
    expect(text).toContain('Ready from 2026-10-12 12:35:00 UTC');
  });

  it('copes with no active key', () => {
    expect(promoteConsequence(key({}), undefined, { kind: 'ready' })).not.toContain('replaces');
  });
});

describe('retire and delete', () => {
  it('types the kid to retire a key', () => {
    expect(retireTyped(key({ kid: 'kid-9' }))).toBe('kid-9');
  });

  it('says a retired key leaves the published key set and that tokens it signed stop verifying', () => {
    expect(retireConsequence(key({}))).toMatch(/no longer published/u);
    expect(retireConsequence(key({}))).toMatch(/stops verifying/u);
  });

  it('says the console session ends if the token it holds was signed by the key', () => {
    expect(retireConsequence(key({}))).toMatch(/console session ends/u);
  });

  it('says deleting a retired key is for good', () => {
    expect(deleteKeyConsequence(key({ status: 'retired' }))).toContain('cannot be undone');
  });
});

describe('dialogOf', () => {
  const rotating = key({});
  const ready = { kind: 'ready' } as const;

  it('asks plainly to promote, and types the kid to retire', () => {
    const promote = dialogOf('promote', rotating, ACTIVE, ready);
    expect(promote).toMatchObject({ title: 'Promote this key?', confirmLabel: 'Promote key' });
    expect(promote.typed).toBeUndefined();
    expect(dialogOf('retire', rotating, ACTIVE, ready)).toMatchObject({
      title: 'Retire this key?',
      confirmLabel: 'Retire key',
      typed: 'kid-k',
      tone: 'danger',
    });
  });

  it('asks plainly, in danger, to delete', () => {
    const asked = dialogOf('delete', key({ status: 'retired' }), ACTIVE, ready);
    expect(asked).toMatchObject({
      title: 'Delete this key?',
      confirmLabel: 'Delete key',
      tone: 'danger',
    });
    expect(asked.typed).toBeUndefined();
  });
});
