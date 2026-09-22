import { MAX_PASSWORD_LENGTH } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { evaluatePassword, type PasswordPolicy } from '#/service/password-policy';

const base: PasswordPolicy = {
  minLength: 8,
  requireDigit: false,
  requireUppercase: false,
  requireLowercase: false,
  requireSpecial: false,
  notUsername: true,
  notEmail: true,
  historyDepth: 0,
  maxAgeDays: 0,
};
const ada = { username: 'ada', email: 'ada@example.com' };
// A username and an email local part that differ, so a test can isolate
// which rule fired instead of always tripping both at once.
const distinct = { username: 'ada', email: 'grace@example.com' };

describe('evaluatePassword', () => {
  it('accepts a password that satisfies the policy', () => {
    expect(evaluatePassword('correct horse battery', base, ada)).toEqual([]);
  });

  it('reports every violation at once, not the first', () => {
    const strict = {
      ...base,
      minLength: 12,
      requireDigit: true,
      requireUppercase: true,
      requireSpecial: true,
    };
    const violations = evaluatePassword('short', strict, ada);
    expect(violations.map((v) => v.rule).sort()).toEqual([
      'min-length',
      'require-digit',
      'require-special',
      'require-uppercase',
    ]);
  });

  // The maximum is not a tenant setting, so a tenant cannot configure its way
  // past it; readPasswordField refuses the same length at every form read,
  // and this is what binds the writers that read no form.
  it('refuses a password longer than the maximum, whatever the tenant says', () => {
    expect(evaluatePassword('a'.repeat(MAX_PASSWORD_LENGTH), base, ada)).toEqual([]);
    expect(
      evaluatePassword('a'.repeat(MAX_PASSWORD_LENGTH + 1), base, ada).map((v) => v.rule),
    ).toEqual(['max-length']);
  });

  it('refuses a password containing the username, case-insensitively', () => {
    expect(evaluatePassword('myADApassword', base, distinct).map((v) => v.rule)).toEqual([
      'not-username',
    ]);
  });

  it('refuses a password containing the local part of the email address, case-insensitively', () => {
    expect(evaluatePassword('myGRACEpassword', base, distinct).map((v) => v.rule)).toEqual([
      'not-email',
    ]);
  });

  it('trips both rules when the username equals the email local part', () => {
    expect(
      evaluatePassword('myADApassword', base, ada)
        .map((v) => v.rule)
        .sort(),
    ).toEqual(['not-email', 'not-username']);
  });

  it('counts characters, not UTF-16 code units', () => {
    // Eight emoji are eight characters. A length check on .length would
    // count sixteen and wrongly accept a seven-character password.
    expect(evaluatePassword('🔑🔑🔑🔑🔑🔑🔑', base, ada).map((v) => v.rule)).toEqual([
      'min-length',
    ]);
    expect(evaluatePassword('🔑🔑🔑🔑🔑🔑🔑🔑', base, ada)).toEqual([]);
  });

  it('applies no email rule to a subject with no address', () => {
    expect(evaluatePassword('a-fine-password', base, { username: 'ada', email: null })).toEqual([]);
  });
});
