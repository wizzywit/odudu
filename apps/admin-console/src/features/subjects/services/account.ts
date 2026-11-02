import { USERNAME_RULE, type Subject } from '@odudu/contracts/admin';
import { writeFailureText } from '#/shared/services/failure';
import { sentence } from '#/shared/services/format';
import type { Loaded } from '#/shared/services/read';
import type { GatewayFailure } from '#/shared/services/result';
import { subjectRefusal } from '#/features/subjects/services/access';

export const USERNAME_RULE_TEXT = sentence(USERNAME_RULE);

export function usernameProblem(username: string): string | null {
  return username === '' ? 'Enter a username.' : null;
}

// A service subject has no `users` row: no username, email,
// profile, password or lockout, since it signs in as itself.
export function signsInAsItself(subject: Pick<Subject, 'type'>): boolean {
  return subject.type !== 'user';
}

// Keyed on the subject's type alone: the server refuses on a client naming
// the subject, and every service subject the product makes has one.
export function deletionRefusal(subject: Pick<Subject, 'type'>): string | null {
  return subject.type === 'service'
    ? "This is a client's service account. Delete the client instead; it cannot be deleted on its own."
    : null;
}

export function enabledVerb(enabled: boolean): 'enabled' | 'disabled' {
  return enabled ? 'enabled' : 'disabled';
}

// A confirmation question shows only for the one asked; the problem a
// failed answer left belongs to it.
export function confirmationOf<W extends string>(
  which: W,
  asked: W | null,
  problem: string | null,
): { confirming: boolean; problem: string | null } {
  return asked === which ? { confirming: true, problem } : { confirming: false, problem: null };
}

export function subjectWriteFailure(failure: GatewayFailure, name: string, verb: string): string {
  return writeFailureText(failure, {
    name,
    verb,
    lookAt: 'the subject',
    stale: `${name} changed elsewhere since you opened it, so it was not ${verb}. It has been read again; look at it before trying again.`,
    refused: (problem) =>
      problem.status === 403
        ? `${name} was not ${verb}: ${subjectRefusal(name, 'manage-users')}`
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

export function usernameMode(policy: Loaded<boolean>, settingsHref: string): UsernameMode {
  switch (policy.status) {
    case 'loading':
      return { kind: 'checking' };
    case 'failed':
      return { kind: 'failed', retry: policy.retry };
    case 'ready':
      return policy.data
        ? { kind: 'editable', description: USERNAME_RULE_TEXT }
        : {
            kind: 'fixed',
            reason:
              "Usernames in this tenant are fixed: its username_editable setting is off, so a rename would be refused. Turn it on under the tenant's",
            settingsHref,
          };
  }
}
