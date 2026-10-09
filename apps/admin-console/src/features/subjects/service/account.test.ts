import { USERNAME_RULE } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import type { GatewayFailure } from '#/shared/service/result.ts';
import {
  enabledVerb,
  subjectWriteFailure,
  usernameMode,
  USERNAME_RULE_TEXT,
  usernameProblem,
} from '#/features/subjects/service/account.ts';

const failure = (kind: 'network' | 'schema' | 'defect'): GatewayFailure => ({ ok: false, kind });

const refusal = (
  status: number,
  extra: { type?: string; detail?: string; errors?: { path: string; message: string }[] } = {},
): GatewayFailure => ({
  ok: false,
  kind: 'problem',
  problem: { type: 'about:blank', title: `T${String(status)}`, status, ...extra },
});

describe('the username', () => {
  it("states the contract's own rule, as a sentence", () => {
    expect(USERNAME_RULE_TEXT.toLowerCase()).toBe(`${USERNAME_RULE}.`.toLowerCase());
    expect(USERNAME_RULE_TEXT.startsWith('A username')).toBe(true);
  });

  it('asks for one before sending anything', () => {
    expect(usernameProblem('')).toBe('Enter a username.');
    expect(usernameProblem('ada')).toBeNull();
  });
});

describe('what a failed change to the account says', () => {
  it('names the subject and the verb, and keeps the server’s word for the rest', () => {
    expect(subjectWriteFailure(failure('network'), 'ada', 'deleted')).toBe(
      'Could not confirm whether ada was deleted. It has not been sent again; look at the subject before trying again.',
    );
    expect(subjectWriteFailure(failure('schema'), 'ada', 'enabled')).toBe(
      'ada may have been enabled, but the answer could not be read. Reload to check.',
    );
    expect(subjectWriteFailure(failure('defect'), 'ada', 'disabled')).toBe(
      'The console could not finish, so ada was not disabled. This is a fault in the console, not something you did.',
    );
    expect(subjectWriteFailure(refusal(403), 'ada', 'deleted')).toBe(
      'ada was not deleted: it needs the manage-users capability, or ada holds an admin capability you do not.',
    );
    expect(subjectWriteFailure(refusal(412), 'ada', 'enabled')).toBe(
      'ada changed elsewhere since you opened it, so it was not enabled. It has been read again; look at it before trying again.',
    );
    expect(subjectWriteFailure(refusal(409, { detail: 'last one' }), 'ada', 'deleted')).toBe(
      'ada was not deleted: last one',
    );
  });

  it('says enabled or disabled for what was asked', () => {
    expect(enabledVerb(true)).toBe('enabled');
    expect(enabledVerb(false)).toBe('disabled');
  });
});

describe('the username in the account section', () => {
  const retry = () => undefined;
  it('waits for the policy, and offers a retry when it could not be read', () => {
    expect(usernameMode({ status: 'loading' }, '/s')).toEqual({ kind: 'checking' });
    expect(usernameMode({ status: 'failed', retry }, '/s')).toEqual({ kind: 'failed', retry });
  });

  it('offers a rename where the policy allows it, and otherwise says why not', () => {
    expect(usernameMode({ status: 'ready', editable: true }, '/s')).toEqual({
      kind: 'editable',
      description: USERNAME_RULE_TEXT,
    });
    expect(usernameMode({ status: 'ready', editable: false }, '/s')).toMatchObject({
      kind: 'fixed',
      settingsHref: '/s',
      reason: expect.stringMatching(/username_editable setting is off/u) as string,
    });
  });
});
