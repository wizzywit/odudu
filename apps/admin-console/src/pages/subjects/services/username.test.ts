import { USERNAME_RULE } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import {
  usernameMode,
  USERNAME_RULE_TEXT,
  usernameProblem,
} from '#/pages/subjects/services/username';

describe('the username', () => {
  it("states the contract's own rule, as a sentence", () => {
    expect(USERNAME_RULE_TEXT.toLowerCase()).toBe(`${USERNAME_RULE}.`.toLowerCase());
    expect(USERNAME_RULE_TEXT.startsWith('A username')).toBe(true);
  });

  it('asks for one before sending anything', () => {
    expect(usernameProblem('')).toBe('Enter a username.');
    expect(usernameProblem('   ')).toBeNull();
    expect(usernameProblem('ada')).toBeNull();
  });
});

describe('the username in the account section', () => {
  const retry = () => undefined;
  it('waits for the policy, and offers a retry when it could not be read', () => {
    expect(usernameMode({ status: 'loading' }, '/s')).toEqual({ kind: 'checking' });
    expect(usernameMode({ status: 'failed', retry }, '/s')).toEqual({ kind: 'failed', retry });
  });

  it('offers a rename where the policy allows it, and otherwise says why not', () => {
    expect(usernameMode({ status: 'ready', data: true }, '/s')).toEqual({
      kind: 'editable',
      description: USERNAME_RULE_TEXT,
    });
    expect(usernameMode({ status: 'ready', data: false }, '/s')).toMatchObject({
      kind: 'fixed',
      settingsHref: '/s',
      reason: expect.stringMatching(/username_editable setting is off/u) as string,
    });
  });
});
