import { describe, expect, it } from 'vitest';
import { checkEmailRequest, planEmailChange } from '#/service/email-change';

describe('checkEmailRequest', () => {
  it('accepts an address the email claim may carry', () => {
    expect(checkEmailRequest('ada@example.com')).toEqual({ kind: 'ok', email: 'ada@example.com' });
  });

  it.each([['not an address'], ['a@b'], [''], ['ada @example.com']])(
    'refuses %j as an address the claim may not carry',
    (value) => {
      const verdict = checkEmailRequest(value);
      expect(verdict.kind).toBe('invalid');
      if (verdict.kind === 'invalid') expect(verdict.description).toContain('email claim');
    },
  );

  it('refuses null, since an address is changed and not removed', () => {
    expect(checkEmailRequest(null)).toEqual({
      kind: 'invalid',
      description: 'an address cannot be removed, only changed to another',
    });
  });

  it('refuses a value that is not text', () => {
    expect(checkEmailRequest(4).kind).toBe('invalid');
  });
});

describe('planEmailChange', () => {
  const plan = (holder: string | null, withinBudget = true) =>
    planEmailChange({ holder, subjectId: 'me', withinBudget });

  it('sends a mail when nobody holds the address', () => {
    expect(plan(null)).toEqual({ kind: 'send' });
  });

  it('skips an address another account holds', () => {
    expect(plan('other')).toEqual({ kind: 'skip', reason: 'address_in_use' });
  });

  it('skips an address the person already holds, in any case', () => {
    expect(plan('me')).toEqual({ kind: 'skip', reason: 'unchanged' });
  });

  it('skips a free address that has been mailed too often', () => {
    expect(plan(null, false)).toEqual({ kind: 'skip', reason: 'throttled' });
  });

  it('names the holder, not the budget, when both apply', () => {
    expect(plan('other', false)).toEqual({ kind: 'skip', reason: 'address_in_use' });
  });
});
