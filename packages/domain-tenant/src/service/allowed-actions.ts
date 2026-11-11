import { requiredActionSchema, type RequiredAction } from '@odudu/contracts/admin';
import { ME_READ_SCOPE } from '#/service/me-scopes';

// The required actions an application may start through /authorize: the
// vocabulary the admin API already uses for a subject's required actions.
export const ALLOWED_ACTION_NAMES: readonly string[] = requiredActionSchema.options;

export const ALLOWED_ACTIONS_NEED_ME_READ = 'allowed_actions_need_me_read';

export const ALLOWED_ACTIONS_NEED_ME_READ_MESSAGE = `a client that may start an action holds the scope ${ME_READ_SCOPE}, which is how it reads the outcome`;

export function isAllowedAction(entry: string): entry is RequiredAction {
  return ALLOWED_ACTION_NAMES.includes(entry);
}

export function unknownAllowedActions(entries: readonly string[]): string[] {
  return entries.filter((entry) => !isAllowedAction(entry));
}

export function distinctAllowedActions(entries: readonly RequiredAction[]): RequiredAction[] {
  return [...new Set(entries)];
}

// True when the pair is coherent: a client with no allowed action holds
// whatever it likes, and one with any holds me:read.
export function allowedActionsHaveMeRead(
  actions: readonly string[],
  scopes: readonly string[],
): boolean {
  return actions.length === 0 || scopes.includes(ME_READ_SCOPE);
}
