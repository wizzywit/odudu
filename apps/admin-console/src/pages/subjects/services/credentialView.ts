import type { Read } from '#/shared/services/read';
import { askToRemove, askToRevoke, type Asking } from '#/pages/subjects/services/credentialAsk';
import {
  credentialsOf,
  factorLabel,
  removeFactorLabel,
} from '#/pages/subjects/services/credentialList';
import { recoveryCodesText } from '#/pages/subjects/services/credentialOutcome';
import type { Credential } from '#/pages/subjects/types/credential';

export interface FactorRow {
  credential: Credential;
  label: string;
  removeLabel: string;
  // What the Remove button asks, against the factors held when it was shown.
  remove: Asking;
}

export interface HeldCredentials {
  password: Credential | null;
  factors: readonly FactorRow[];
  recoveryCodes: number | null;
  recoveryText: string;
  revoke: Asking;
}

// The credentials as the tab shows them, or null until they have been read.
export function heldCredentials(read: Read<Credential[]>, name: string): HeldCredentials | null {
  if (read.status !== 'ready') return null;
  const held = credentialsOf(read.data);
  return {
    password: held.password,
    factors: held.factors.map((credential) => ({
      credential,
      label: factorLabel(credential.type),
      removeLabel: removeFactorLabel(credential),
      remove: askToRemove(held.factors, credential),
    })),
    recoveryCodes: held.recoveryCodes,
    recoveryText: recoveryCodesText(name, held.recoveryCodes),
    revoke: askToRevoke(held.factors),
  };
}
