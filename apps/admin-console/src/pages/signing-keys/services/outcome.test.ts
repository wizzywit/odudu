import type { SigningKey } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import { keyActionOutcome } from '#/pages/signing-keys/services/outcome';

const KEY: SigningKey = {
  id: 'k1',
  status: 'rotating',
  kid: 'kid-1',
  alg: 'RS256',
  created_at: '2026-10-12T09:00:00Z',
  not_after: null,
};

const ok = { ok: true as const, status: 200, data: KEY, etag: null, next: null };

function refused(status: number, type = 'about:blank', detail?: string) {
  return {
    ok: false as const,
    kind: 'problem' as const,
    problem: { type, title: 'Conflict', status, ...(detail === undefined ? {} : { detail }) },
  };
}

describe('keyActionOutcome', () => {
  it('says what a success did', () => {
    expect(keyActionOutcome('promote', KEY, ok)).toEqual({
      done: true,
      text: 'The RS256 key kid-1 is now the active key.',
    });
    expect(keyActionOutcome('retire', KEY, ok).text).toContain('was retired');
    expect(keyActionOutcome('delete', KEY, ok).text).toContain('was deleted');
  });

  it('keys the refusal of retiring the active key on its type, not its words', () => {
    const outcome = keyActionOutcome(
      'retire',
      KEY,
      refused(409, 'about:blank#key-active', 'prose that is not read'),
    );
    expect(outcome.done).toBe(false);
    expect(outcome.text).toContain('Promote another key first');
    expect(outcome.text).not.toContain('prose that is not read');
  });

  it('names the clients still needing the algorithm from the structured list', () => {
    const outcome = keyActionOutcome('retire', KEY, {
      ok: false,
      kind: 'problem',
      problem: {
        type: 'about:blank#key-algorithm-needed',
        title: 'Conflict',
        status: 409,
        detail: 'prose that is not read',
        errors: [
          { path: 'clients', message: 'billing' },
          { path: 'clients', message: 'ledger' },
        ],
      },
    });
    expect(outcome.done).toBe(false);
    expect(outcome.text).toContain('billing and ledger');
    expect(outcome.text).toContain('RS256');
    expect(outcome.text).not.toContain('prose that is not read');
  });

  it('says how many more clients there are when the list was cut', () => {
    const outcome = keyActionOutcome('retire', KEY, {
      ok: false,
      kind: 'problem',
      problem: {
        type: 'about:blank#key-algorithm-needed',
        title: 'Conflict',
        status: 409,
        errors: [
          { path: 'clients', message: 'a' },
          { path: 'clients', message: 'b' },
          { path: 'clients.more', message: '9998' },
        ],
      },
    });
    expect(outcome.text).toContain('a, b and 9,998 more');
  });

  it('refuses to delete a key that is not retired, by type', () => {
    const outcome = keyActionOutcome('delete', KEY, refused(409, 'about:blank#key-not-retired'));
    expect(outcome).toEqual({
      done: false,
      text: 'Only a retired key can be deleted. Retire it first.',
    });
  });

  it('treats a key the server no longer has as already gone for retire and delete', () => {
    expect(keyActionOutcome('retire', KEY, refused(404))).toMatchObject({ done: true });
    expect(keyActionOutcome('delete', KEY, refused(404))).toMatchObject({ done: true });
  });

  it('says a promote of a key that is gone could not happen', () => {
    const outcome = keyActionOutcome('promote', KEY, refused(404));
    expect(outcome.done).toBe(false);
    expect(outcome.text).toContain('can no longer be promoted');
  });

  it('names the capability a refusal needed', () => {
    const outcome = keyActionOutcome('retire', KEY, refused(403));
    expect(outcome.done).toBe(false);
    expect(outcome.text).toContain('manage-keys');
  });

  it('never asks to send again after a lost answer', () => {
    const outcome = keyActionOutcome('promote', KEY, { ok: false, kind: 'network' });
    expect(outcome.done).toBe(false);
    expect(outcome.text).toContain('has not been sent again');
  });
});
