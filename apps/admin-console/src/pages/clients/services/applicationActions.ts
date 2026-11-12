import type { ApplicationAction } from '#/entities/subject';

export const ACTIONS_LABEL = 'Actions an application may start';

export const ACTIONS_RULE =
  'The account changes this client may ask Odudu to run for a person who is signed in, through a parameter of its authorization request. A client may start none until one is chosen here.';

export const ACTIONS_NEED_ME_READ =
  'A client that may start an action also holds the me:read scope, which is how it reads the outcome. Assign me:read under Scopes first.';

const ME_READ_SCOPE = 'me:read';

const ACTION_NOTES: Readonly<Record<ApplicationAction, string>> = {
  'verify-email': 'Asks the person to prove the address on file with a link sent to it.',
  'update-password': 'Asks for the current password, then a new one.',
  'configure-totp': 'Enrols an authenticator app as a second factor.',
  'configure-passkey': 'Registers a passkey on the device in use.',
  'generate-recovery-codes': 'Shows a fresh set of recovery codes once, replacing any held.',
  'update-profile': 'Asks the person to fill in every profile field that is still empty.',
};

export interface ActionOption {
  id: ApplicationAction;
  label: string;
  description: string;
  unavailable: null;
}

// The wording of each action is the subject entity's, handed in by the use case.
export function actionOptions(
  actions: readonly { action: ApplicationAction; label: string }[],
): ActionOption[] {
  return actions.map(({ action, label }) => ({
    id: action,
    label,
    description: ACTION_NOTES[action],
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
