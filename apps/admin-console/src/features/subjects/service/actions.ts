import { type RequiredAction } from '@odudu/contracts/admin';
import { inOrderOf } from '#/shared/service/ids.ts';

// In the order the next sign-in asks for them.
export const REQUIRED_ACTIONS: readonly {
  action: RequiredAction;
  label: string;
  description: string;
}[] = [
  {
    action: 'update-password',
    label: 'Choose a new password',
    description: 'The next sign-in asks for a new password before it lets them in.',
  },
  {
    action: 'configure-totp',
    label: 'Set up an authenticator app',
    description: 'Enrols a TOTP authenticator, which then becomes a second factor.',
  },
  {
    action: 'configure-passkey',
    label: 'Register a passkey',
    description: 'Registers a passkey on the device they sign in from.',
  },
  {
    action: 'generate-recovery-codes',
    label: 'Generate recovery codes',
    description: 'Shows them a fresh set of recovery codes, once, replacing any they hold.',
  },
];

const REQUIRED_ACTION_ORDER = REQUIRED_ACTIONS.map((each) => each.action);

export function requiredActionsInOrder(actions: readonly string[]): RequiredAction[] {
  return inOrderOf(REQUIRED_ACTION_ORDER, actions);
}

export function describeActions(value: unknown): string {
  const labels = requiredActionsInOrder(Array.isArray(value) ? value.map(String) : []).map(
    (action) => REQUIRED_ACTIONS.find((each) => each.action === action)?.label ?? action,
  );
  return labels.length === 0 ? 'none' : labels.join(', ');
}

export function actionsMailProblem(actions: readonly RequiredAction[]): { actions: string } | null {
  return actions.length === 0 ? { actions: 'Choose at least one action.' } : null;
}
