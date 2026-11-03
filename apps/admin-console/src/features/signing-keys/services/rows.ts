import type { SigningKey, SigningKeyAlg } from '@odudu/contracts/admin';
import type { Promotion } from '#/entities/signing-key';
import type { NamedDialog } from '#/shared/services/dialog';
import { dialogOf } from '#/features/signing-keys/services/confirm';
import type { KeyAction } from '#/features/signing-keys/services/outcome';
import type { PromotionReading } from '#/features/signing-keys/services/promotion';
import { defaultAlg } from '#/features/signing-keys/services/stage';

export interface KeyRow {
  key: SigningKey;
  // Only a rotating key can be promoted, and says whether it is ready.
  readiness: PromotionReading | null;
}

export interface Asking {
  action: KeyAction;
  key: SigningKey;
  dialog: NamedDialog;
}

// `readiness` is null for a lane whose keys cannot be promoted.
export function keyRows(
  keys: readonly SigningKey[],
  readiness: ((key: SigningKey) => PromotionReading) | null,
): KeyRow[] {
  return keys.map((key) => ({ key, readiness: readiness === null ? null : readiness(key) }));
}

// Staging offers the algorithm chosen, else the one the active key signs with.
export function shownAlg(
  chosen: SigningKeyAlg | null,
  active: { alg: SigningKeyAlg } | undefined,
): SigningKeyAlg {
  return chosen ?? defaultAlg(active);
}

export function askingOf(
  asked: { action: KeyAction; key: SigningKey } | null,
  current: SigningKey | undefined,
  promotionOf: (key: SigningKey) => Promotion,
): Asking | null {
  if (asked === null) return null;
  return { ...asked, dialog: dialogOf(asked.action, asked.key, current, promotionOf(asked.key)) };
}
