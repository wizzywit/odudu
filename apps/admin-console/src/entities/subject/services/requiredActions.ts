import type {
  ApplicationAction,
  LinkedAction,
  RequiredAction,
} from '#/entities/subject/types/subjectWrites';
import { listOrNone } from '#/shared/lib/services/format';
import { inOrderOf } from '#/shared/lib/services/ids';

// In the order the next sign-in asks for them.
export const REQUIRED_ACTIONS: readonly {
  action: RequiredAction;
  label: string;
  description: string;
}[] = [
  {
    action: 'verify-email',
    label: 'Verify the email address',
    description:
      'The next sign-in asks them to prove the address on file with a link sent to it, before anything else.',
  },
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
  {
    action: 'update-profile',
    label: 'Complete the profile',
    description: 'The next sign-in asks them to fill in every profile field that is still empty.',
  },
  {
    action: 'accept-terms',
    label: 'Accept the terms',
    description:
      'The next sign-in asks them to accept the tenant’s terms at the version in force. The tenant needs a terms address under Settings first.',
  },
];

// The actions an application may start: all but the tenant's terms.
const APPLICATION_ACTION_IDS: readonly ApplicationAction[] = [
  'verify-email',
  'update-password',
  'configure-totp',
  'configure-passkey',
  'generate-recovery-codes',
  'update-profile',
];

// The actions a mailed link can take a person through.
const LINKED_ACTION_IDS: readonly LinkedAction[] = [
  'update-password',
  'configure-totp',
  'configure-passkey',
  'generate-recovery-codes',
];

const isApplicationAction = (action: RequiredAction): action is ApplicationAction =>
  APPLICATION_ACTION_IDS.some((id) => id === action);

const isLinkedAction = (action: RequiredAction): action is LinkedAction =>
  LINKED_ACTION_IDS.some((id) => id === action);

export const APPLICATION_ACTIONS = REQUIRED_ACTIONS.flatMap(({ action, label, description }) =>
  isApplicationAction(action) ? [{ action, label, description }] : [],
);

// All of them, as a checklist offers them.
export const REQUIRED_ACTION_OPTIONS = REQUIRED_ACTIONS.map(({ action, label, description }) => ({
  id: action,
  label,
  description,
}));

// Those a mailed link can finish, as a checklist offers them.
export const LINKED_ACTION_OPTIONS = REQUIRED_ACTION_OPTIONS.filter((option) =>
  isLinkedAction(option.id),
);

const REQUIRED_ACTION_ORDER = REQUIRED_ACTIONS.map((each) => each.action);

export function requiredActionsInOrder(actions: readonly string[]): RequiredAction[] {
  return inOrderOf(REQUIRED_ACTION_ORDER, actions);
}

export function linkedActionsInOrder(actions: readonly string[]): LinkedAction[] {
  return requiredActionsInOrder(actions).filter(isLinkedAction);
}

export function describeActions(value: unknown): string {
  const labels = requiredActionsInOrder(Array.isArray(value) ? value.map(String) : []).map(
    (action) => REQUIRED_ACTIONS.find((each) => each.action === action)?.label ?? action,
  );
  return listOrNone(labels, { join: 'comma' });
}

export function actionsMailProblem(actions: readonly RequiredAction[]): { actions: string } | null {
  return actions.length === 0 ? { actions: 'Choose at least one action.' } : null;
}
