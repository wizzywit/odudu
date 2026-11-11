import { REQUIRED_ACTIONS } from '#/entities/subject';

export const ACTIONS_LABEL = 'Actions an application may start';

export const ACTIONS_RULE =
  'The account changes this client may ask Odudu to run for a person who is signed in, through a parameter of its authorization request. A client may start none until one is chosen here.';

export const ACTIONS_NEED_ME_READ =
  'A client that may start an action also holds the me:read scope, which is how it reads the outcome. Assign me:read under Scopes first.';

const ME_READ_SCOPE = 'me:read';

const ACTION_NOTES: Readonly<Record<string, string>> = {
  'update-password': 'Asks for the current password, then a new one.',
  'configure-totp': 'Enrols an authenticator app as a second factor.',
  'configure-passkey': 'Registers a passkey on the device in use.',
  'generate-recovery-codes': 'Shows a fresh set of recovery codes once, replacing any held.',
};

export interface ActionOption {
  id: string;
  label: string;
  description: string;
  unavailable: null;
}

export function actionOptions(): ActionOption[] {
  return REQUIRED_ACTIONS.map(({ action, label }) => ({
    id: action,
    label,
    description: ACTION_NOTES[action] ?? '',
    unavailable: null,
  }));
}

export function actionsBlock(
  actions: readonly string[],
  scopes: readonly { name: string }[],
): string | undefined {
  const holdsMeRead = scopes.some((scope) => scope.name === ME_READ_SCOPE);
  return actions.length > 0 && !holdsMeRead ? ACTIONS_NEED_ME_READ : undefined;
}
