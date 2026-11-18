import { describe, expect, it } from 'vitest';
import { planAdminEmailChange } from '#/service/admin-email-plan';

describe('planAdminEmailChange', () => {
  it('clears the address when none is asked for', () => {
    expect(planAdminEmailChange({ asked: null, holder: 'me', subjectId: 'me' })).toEqual({
      kind: 'clear',
    });
  });

  it('cancels a pending change when the address asked for is the one the person holds', () => {
    expect(
      planAdminEmailChange({ asked: 'Ada@Example.com', holder: 'me', subjectId: 'me' }),
    ).toEqual({ kind: 'cancel' });
  });

  it('asks the person to confirm an address nobody holds', () => {
    expect(
      planAdminEmailChange({ asked: 'new@example.com', holder: null, subjectId: 'me' }),
    ).toEqual({ kind: 'confirm', address: 'new@example.com' });
  });
});
