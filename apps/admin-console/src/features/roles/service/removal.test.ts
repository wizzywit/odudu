import { describe, expect, it } from 'vitest';
import {
  deleteChecking,
  removalAction,
  roleDeleteConsequence,
  roleDeleteFailureText,
} from '#/features/roles/service/removal.ts';

const certain = { kind: 'certain', lost: ['view-audit'] } as const;

const refusal = (status: number, detail?: string, type = 'about:blank') =>
  ({ ok: false, kind: 'problem', problem: { type, title: 'Refused', status, detail } }) as const;

describe('deleting a role', () => {
  it('says what it comes to, with the loss appended', () => {
    expect(roleDeleteConsequence('reader', { kind: 'none' })).toBe(
      'reader is taken from every subject, group and scope it is given to, and out of every role it is nested in; what it nests is no longer held through it. It cannot be undone.',
    );
    expect(roleDeleteConsequence('reader', certain)).toContain(
      ' You hold view-audit through reader, so this takes it from you',
    );
  });

  it('words a failed delete, the server own reason for a refusal first', () => {
    expect(roleDeleteFailureText('reader', refusal(409, 'still in use'))).toBe(
      'Refused: still in use.',
    );
    expect(roleDeleteFailureText('reader', refusal(500, 'boom'))).toBe(
      'reader was not deleted: boom',
    );
    expect(roleDeleteFailureText('reader', refusal(403, 'x'))).toBe('Refused: x.');
    expect(roleDeleteFailureText('reader', { ok: false, kind: 'network' })).toBe(
      'Could not confirm whether reader was deleted. It has not been sent again; look at the roles before trying again.',
    );
  });
});

describe('what a removal does first', () => {
  it('waits while the loss is read, asks when it takes from the caller, else runs', () => {
    expect(removalAction({ kind: 'checking' })).toBe('wait');
    expect(removalAction({ kind: 'none' })).toBe('run');
    expect(removalAction(certain)).toBe('ask');
    expect(removalAction({ kind: 'possible', lost: ['view-audit'] })).toBe('ask');
  });

  it('checks a deletion until the ceiling and the loss are known', () => {
    const ready = { status: 'ready', caller: [], deleteHeld: null } as const;
    expect(deleteChecking({ status: 'checking' }, { kind: 'none' })).toBe(true);
    expect(deleteChecking(ready, { kind: 'checking' })).toBe(true);
    expect(deleteChecking(ready, { kind: 'none' })).toBe(false);
    expect(deleteChecking(ready, certain)).toBe(false);
  });
});
