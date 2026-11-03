import type { SigningKey } from '#/entities/signing-key';
import type { Promotion } from '#/entities/signing-key';
import type { NamedDialog } from '#/shared/lib/services/dialog';
import type { KeyAction } from '#/pages/signing-keys/services/outcome';
import { promoteWarning } from '#/pages/signing-keys/services/promotion';

export function promoteConsequence(
  key: SigningKey,
  active: SigningKey | undefined,
  promotion: Promotion,
): string {
  const replaced =
    active === undefined
      ? ''
      : ` The ${active.alg} key ${active.kid} it replaces stays published, as rotating, until you retire it.`;
  const warning = promoteWarning(promotion);
  return `From now on this ${key.alg} key signs every new token.${replaced}${warning === null ? '' : ` ${warning}`}`;
}

// The kid names exactly one key, which an algorithm or a date does not.
export function retireTyped(key: SigningKey): string {
  return key.kid;
}

export function retireConsequence(key: SigningKey): string {
  return `The ${key.alg} key ${key.kid} is no longer published, so a token it signed stops verifying at once. Retire it only when no token it signed can still be in use. The token this console holds for you may be one of them. If it is, this console session ends and you are signed in again, or asked to sign in; the confirmation of this retire may then not be shown.`;
}

export function deleteKeyConsequence(key: SigningKey): string {
  return `The record of the ${key.alg} key ${key.kid} is removed for good. It is published nowhere and signs nothing, so no token depends on it. This cannot be undone.`;
}

export function dialogOf(
  action: KeyAction,
  key: SigningKey,
  active: SigningKey | undefined,
  promotion: Promotion,
): NamedDialog {
  switch (action) {
    case 'promote':
      return {
        title: 'Promote this key?',
        consequence: promoteConsequence(key, active, promotion),
        confirmLabel: 'Promote key',
        tone: 'primary',
      };
    case 'retire':
      return {
        title: 'Retire this key?',
        consequence: retireConsequence(key),
        confirmLabel: 'Retire key',
        tone: 'danger',
        typed: retireTyped(key),
      };
    case 'delete':
      return {
        title: 'Delete this key?',
        consequence: deleteKeyConsequence(key),
        confirmLabel: 'Delete key',
        tone: 'danger',
      };
  }
}
