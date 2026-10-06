import { describe, expect, it } from 'vitest';
import {
  revokedText,
  revokeConsequence,
  revokeFailureText,
  sessionsReadable,
} from '#/features/clients/service/sessions.ts';

describe('revokedText', () => {
  it('says how many grants went, and nothing more when that is all', () => {
    expect(revokedText('Billing', { revoked: 3, beyond_ceiling: 0, remaining: 0 })).toBe(
      '3 grants of Billing revoked.',
    );
    expect(revokedText('Billing', { revoked: 1, beyond_ceiling: 0, remaining: 0 })).toBe(
      '1 grant of Billing revoked.',
    );
  });

  it('says what was left alone for the ceiling, and that more remain to be revoked', () => {
    expect(revokedText('Billing', { revoked: 10000, beyond_ceiling: 2, remaining: 40 })).toBe(
      '10000 grants of Billing revoked. 2 left alone, their subjects holding an admin capability you do not. 40 more remain. Revoke again to continue.',
    );
  });
});

it('states what revoking costs before it is asked for', () => {
  expect(revokeConsequence('Billing', false)).toContain(
    'Every grant issued through Billing is revoked',
  );
  expect(revokeConsequence('Billing', false)).toContain('cannot be undone');
  expect(revokeConsequence('Billing', false)).not.toContain('console');
});

it("says on the console's own client that the caller is signed out of the console too", () => {
  const text = revokeConsequence('Odudu admin', true);
  expect(text).toContain('Every grant issued through Odudu admin is revoked');
  expect(text).toContain('your own sign-in to this console is one of them');
  expect(text).toContain('you will be signed out');
});

it('says a lost answer is not sent again, and the server reason otherwise', () => {
  expect(revokeFailureText({ ok: false, kind: 'network' }, 'Billing')).toContain(
    'It has not been sent again',
  );
  expect(revokeFailureText({ ok: false, kind: 'network' }, 'Billing')).toContain(
    'whether the revocation for Billing was carried out',
  );
  expect(
    revokeFailureText(
      {
        ok: false,
        kind: 'problem',
        problem: { type: 'about:blank', title: 'Conflict', status: 409, detail: 'no' },
      },
      'Billing',
    ),
  ).toBe('The revocation for Billing was not carried out: no');
});

describe('sessionsReadable', () => {
  it('admits manage-sessions, and rules nobody out before whoami answers', () => {
    expect(sessionsReadable({ capabilities: ['manage-sessions'], crossTenant: false })).toBe(true);
    expect(sessionsReadable({ capabilities: ['manage-clients'], crossTenant: false })).toBe(false);
    expect(sessionsReadable(undefined)).toBe(true);
  });
});
