import { applicationActionSchema, type ApplicationAction } from '@odudu/contracts/admin';
import { type ErrorCode } from '@odudu/kernel';
import { ME_READ_SCOPE } from '#/service/me-scopes';

// The required actions an application may start through /authorize: those of
// a subject's required actions the tenant does not reserve to itself.
export const ALLOWED_ACTION_NAMES: readonly string[] = applicationActionSchema.options;

export const ALLOWED_ACTIONS_NEED_ME_READ = 'allowed_actions_need_me_read' satisfies ErrorCode;

export const ALLOWED_ACTIONS_NEED_ME_READ_MESSAGE =
  `a client that may start an action holds the scope ${ME_READ_SCOPE}, which is how it reads the outcome: ` +
  `assign ${ME_READ_SCOPE} to the client first, or make it a default assignment so every new client has it ` +
  `(odudu seed client --allow-action assigns it itself)`;

// The refusal where me:read is the thing being taken away.
export const ALLOWED_ACTIONS_KEEP_ME_READ_MESSAGE =
  `the scope ${ME_READ_SCOPE} stays while a client may start an action, since that client reads ` +
  `the outcome through it: clear the client's allowed_actions first`;

export function isAllowedAction(entry: string): entry is ApplicationAction {
  return ALLOWED_ACTION_NAMES.includes(entry);
}

export function unknownAllowedActions(entries: readonly string[]): string[] {
  return entries.filter((entry) => !isAllowedAction(entry));
}

export function distinctAllowedActions(entries: readonly ApplicationAction[]): ApplicationAction[] {
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
