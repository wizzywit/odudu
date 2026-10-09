// The required actions a mailed link may take a subject through, in the
// order the sign-in flow asks for them, each with what it asks in words a
// subject reads. The vocabulary is `requiredActionSchema`'s
// (@odudu/contracts), which this package does not depend on; the admin route
// holds a request to it before a link is ever minted.
const LABELS = {
  'update-password': 'Choose a new password',
  'configure-totp': 'Set up an authenticator app',
  'configure-passkey': 'Register a passkey',
  'generate-recovery-codes': 'Save a set of recovery codes',
} as const;

export type LinkedRequiredAction = keyof typeof LABELS;

const ORDER = Object.keys(LABELS) as readonly LinkedRequiredAction[];

export function isLinkedRequiredAction(value: string): value is LinkedRequiredAction {
  return Object.hasOwn(LABELS, value);
}

/** Each named action once, in the order they are asked; anything unknown is dropped. */
export function orderedActions(actions: readonly string[]): LinkedRequiredAction[] {
  return ORDER.filter((action) => actions.includes(action));
}

export function actionLabel(action: LinkedRequiredAction): string {
  return LABELS[action];
}
