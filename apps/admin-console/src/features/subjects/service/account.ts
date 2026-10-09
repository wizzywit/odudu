import { USERNAME_RULE, type Subject } from '@odudu/contracts/admin';
import { writeFailureText } from '#/shared/service/failure.ts';
import type { GatewayFailure } from '#/shared/service/result.ts';

export const USERNAME_RULE_TEXT = `${USERNAME_RULE.charAt(0).toUpperCase()}${USERNAME_RULE.slice(1)}.`;

export function usernameProblem(username: string): string | null {
  return username === '' ? 'Enter a username.' : null;
}

// A service or agent subject has no `users` row: no username, email,
// profile, password or lockout, since it signs in as itself.
export function signsInAsItself(subject: Pick<Subject, 'type'>): boolean {
  return subject.type !== 'user';
}

export function enabledVerb(enabled: boolean): 'enabled' | 'disabled' {
  return enabled ? 'enabled' : 'disabled';
}

export function subjectWriteFailure(failure: GatewayFailure, name: string, verb: string): string {
  return writeFailureText(failure, {
    name,
    verb,
    lookAt: 'the subject',
    stale: `${name} changed elsewhere since you opened it, so it was not ${verb}. It has been read again; look at it before trying again.`,
    refused: (problem) =>
      problem.status === 403
        ? `${name} was not ${verb}: it needs the manage-users capability, or ${name} holds an admin capability you do not.`
        : null,
  });
}

export type UsernameMode =
  // Offered: the tenant's policy accepts a rename.
  | { kind: 'editable'; description: string }
  // Not offered: the policy is off, and this is why.
  | { kind: 'fixed'; reason: string; settingsHref: string }
  | { kind: 'failed'; retry: () => void }
  | { kind: 'checking' };

export function usernameMode(
  policy:
    | { status: 'loading' }
    | { status: 'ready'; editable: boolean }
    | { status: 'failed'; retry: () => void },
  settingsHref: string,
): UsernameMode {
  switch (policy.status) {
    case 'loading':
      return { kind: 'checking' };
    case 'failed':
      return { kind: 'failed', retry: policy.retry };
    case 'ready':
      return policy.editable
        ? { kind: 'editable', description: USERNAME_RULE_TEXT }
        : {
            kind: 'fixed',
            reason:
              "Usernames in this tenant are fixed: its username_editable setting is off, so a rename would be refused. Turn it on under the tenant's",
            settingsHref,
          };
  }
}
