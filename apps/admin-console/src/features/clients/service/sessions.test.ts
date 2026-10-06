import { describe, expect, it } from 'vitest';
import {
  revokedText,
  revokeConsequence,
  revokeFailureText,
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
  expect(revokeConsequence('Billing')).toContain('Every grant issued through Billing is revoked');
  expect(revokeConsequence('Billing')).toContain('cannot be undone');
});

it('says a lost answer is not sent again, and the server reason otherwise', () => {
  expect(revokeFailureText({ ok: false, kind: 'network' }, 'Billing')).toContain(
    'It has not been sent again',
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
  ).toBe('The grants of Billing was not revoked: no');
});
