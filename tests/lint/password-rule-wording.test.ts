import { describe, expect, it } from 'vitest';
import { en as account } from '../../packages/account/src/view/messages.js';
import { en as authnFlows } from '../../packages/authn-flows/src/view/messages.js';

// The change-password page (authn-flows) and the reset and registration pages
// (account) each hold their own catalogue, since neither may import the
// other's. A rule has to read the same on all of them, so this holds the
// sentences equal until they are translated, where the two diverge only by
// being translated on purpose.
const SHARED = [
  'minLength',
  'maxLength',
  'requireDigit',
  'requireUppercase',
  'requireLowercase',
  'requireSpecial',
  'notUsername',
  'notEmail',
  'notReused',
  'common',
  'breached',
  'breachCheckUnavailable',
] as const;

const HINTS = [
  'heading',
  'minLength',
  'digit',
  'uppercase',
  'lowercase',
  'special',
  'notCommon',
  'show',
  'summary',
] as const;

describe('a password rule is worded the same by both catalogues that word it', () => {
  it.each(SHARED)('%s', (rule) => {
    expect(account[`password.rule.${rule}`]).toBe(authnFlows[`updatePassword.rule.${rule}`]);
  });

  it('leaves no account rule unpinned', () => {
    const held = Object.keys(account)
      .filter((id) => id.startsWith('password.rule.'))
      .map((id) => id.slice('password.rule.'.length));
    expect(held.sort()).toEqual([...SHARED].sort());
  });

  it.each(HINTS)('hint %s', (hint) => {
    expect(account[`password.hint.${hint}`]).toBe(authnFlows[`updatePassword.hint.${hint}`]);
  });

  it('leaves no account hint unpinned', () => {
    const held = Object.keys(account)
      .filter((id) => id.startsWith('password.hint.'))
      .map((id) => id.slice('password.hint.'.length));
    expect(held.sort()).toEqual([...HINTS].sort());
  });
});
