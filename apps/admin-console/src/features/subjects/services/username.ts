import { USERNAME_RULE } from '@odudu/contracts/admin';
import { sentence } from '#/shared/services/format';
import type { Loaded } from '#/shared/services/read';

export const USERNAME_RULE_TEXT = sentence(USERNAME_RULE);

export function usernameProblem(username: string): string | null {
  return username === '' ? 'Enter a username.' : null;
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
