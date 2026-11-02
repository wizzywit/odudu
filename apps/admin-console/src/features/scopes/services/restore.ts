import type { ListBuiltinScopesResponse } from '@odudu/contracts/admin';
import { refusedBy, writeFailureText } from '#/shared/services/failure';
import { andList, plural } from '#/shared/services/format';
import type { Read } from '#/shared/services/read';
import type { GatewayFailure } from '#/shared/services/result';

export type RestoreOffer =
  | { kind: 'reading' }
  | { kind: 'unknown' }
  | { kind: 'nothing' }
  | { kind: 'missing'; names: readonly string[] };

export function restoreOffer(read: Read<ListBuiltinScopesResponse>): RestoreOffer {
  if (read.status === 'loading') return { kind: 'reading' };
  if (read.status === 'failed') return { kind: 'unknown' };
  const names = read.data.items.filter((item) => !item.present).map((item) => item.name);
  return names.length === 0 ? { kind: 'nothing' } : { kind: 'missing', names };
}

export const RESTORE_DIALOG_TITLE = 'Restore built-in scopes?';
export const RESTORE_CONFIRM_LABEL = 'Restore';

export function restoreText(offer: RestoreOffer): string {
  switch (offer.kind) {
    case 'reading':
      return 'Checking which built-in scopes this tenant has.';
    case 'unknown':
      return 'Which built-in scopes this tenant has could not be read.';
    case 'nothing':
      return 'Every built-in scope is present, so there is nothing to restore.';
    case 'missing': {
      const one = offer.names.length === 1;
      const them = one ? 'it' : 'them';
      return (
        `${andList(offer.names)} ${plural(offer.names.length, 'is', 'are')} missing. ` +
        `Restoring creates ${them} again with the settings a new tenant is given. ` +
        `It does not bring back the client assignments and role mappings that went with ${them}: ` +
        `assign ${them} to clients and map roles again.`
      );
    }
  }
}

// A press could only do nothing until the read has named what is missing.
export function restoreHeld(offer: RestoreOffer): boolean {
  return offer.kind !== 'missing';
}

export function restoredText(created: readonly string[]): string {
  if (created.length === 0) return 'Every built-in scope was already present.';
  const them = created.length === 1 ? 'it' : 'them';
  return `Restored ${andList(created)}. Assign ${them} to clients and map roles again where ${plural(created.length, 'it is', 'they are')} needed.`;
}

export function restoreFailureText(failure: GatewayFailure): string {
  return writeFailureText(failure, {
    name: 'The restore of the built-in scopes',
    verb: 'done',
    lookAt: 'the scopes list',
    refused: refusedBy(),
  });
}
