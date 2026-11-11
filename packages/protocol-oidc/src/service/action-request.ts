import { AUTHORIZE_REQUEST_DESCRIPTIONS } from '#/service/oauth-errors';
import { type ActionStatus, type PendingRequest, type RequiredAction } from '@odudu/authn-flows';

// The names the `action` parameter takes: the required actions the server
// already knows, in the order they are owed.
const ACTIONS: readonly string[] = [
  'update-password',
  'configure-totp',
  'configure-passkey',
  'generate-recovery-codes',
];

function isAction(value: unknown): value is RequiredAction {
  return typeof value === 'string' && ACTIONS.includes(value);
}

export type ActionParse =
  { kind: 'none' } | { kind: 'action'; action: RequiredAction } | { kind: 'invalid' };

// Read from the raw parameters, not the normalised ones: normalisation treats
// an empty value as an omitted one and folds a repeat to a single value, and
// an application that sends `action=` or two of them has made a mistake that
// is better refused than answered as if it had asked for nothing.
export function parseAction(rawParams: unknown): ActionParse {
  if (typeof rawParams !== 'object' || rawParams === null || Array.isArray(rawParams)) {
    return { kind: 'none' };
  }
  const raw: unknown = (rawParams as Record<string, unknown>).action;
  if (raw === undefined) return { kind: 'none' };
  return isAction(raw) ? { kind: 'action', action: raw } : { kind: 'invalid' };
}

export interface ActionRequestFacts {
  action: RequiredAction;
  // What the client may start, and whether it holds the scope that lets it
  // read the outcome back.
  allowedActions: readonly RequiredAction[];
  holdsMeRead: boolean;
  prompts: ReadonlySet<string>;
  // Whether a passkey can be enrolled at all on this deployment.
  passkeyAvailable: boolean;
}

// Why an action the request names cannot be started, as the sentence the
// error carries; null when it can. Every reason is fixed text, never an echo
// of the request.
export function actionRefusal(facts: ActionRequestFacts): string | null {
  if (!facts.allowedActions.includes(facts.action) || !facts.holdsMeRead) {
    return AUTHORIZE_REQUEST_DESCRIPTIONS.actionNotAllowed;
  }
  // An action is a page, and neither of these shows one.
  if (facts.prompts.has('none') || facts.prompts.has('create')) {
    return AUTHORIZE_REQUEST_DESCRIPTIONS.actionNeedsPage;
  }
  if (facts.action === 'configure-passkey' && !facts.passkeyAvailable) {
    return AUTHORIZE_REQUEST_DESCRIPTIONS.actionNotAllowed;
  }
  return null;
}

type ParkedAction = Pick<PendingRequest, 'action' | 'actionStatus'>;

// The action still to be shown: asked for, and not yet ended.
export function requestedActionOf(pending: ParkedAction): RequiredAction | null {
  return pending.action !== undefined && pending.actionStatus === undefined ? pending.action : null;
}

// What the person owes before the code is issued: the tenant's own required
// actions, and the one the application asked for while it is still to be shown.
export function owedWithRequested(
  owed: readonly RequiredAction[],
  pending: ParkedAction,
): readonly RequiredAction[] {
  const requested = requestedActionOf(pending);
  return requested === null || owed.includes(requested) ? owed : [...owed, requested];
}

// An action changes a credential, so it needs a sign-in no older than the
// tenant's window (the rule the "me" API's gated routes apply), however much
// older a session the client would itself accept.
export function effectiveMaxAge(
  maxAge: number | null,
  windowSeconds: number,
  actionRequested: boolean,
): number | null {
  if (!actionRequested) return maxAge;
  return maxAge === null ? windowSeconds : Math.min(maxAge, windowSeconds);
}

// The `action_status` the response carries: only the ending of an action the
// server parked, never anything the browser or the client sent.
export function actionStatusParameter(pending: ParkedAction): ActionStatus | null {
  return pending.action !== undefined && pending.actionStatus !== undefined
    ? pending.actionStatus
    : null;
}
