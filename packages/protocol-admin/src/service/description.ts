import {
  BIDI_REFUSED_MESSAGE,
  containsNul,
  NUL_REFUSED_MESSAGE,
  refusesBidi,
} from '@odudu/contracts';
import { DESCRIPTION_MAX } from '@odudu/contracts/admin';

export type CheckedDescription =
  { kind: 'ok'; value: string | null } | { kind: 'invalid'; message: string };

/** A description an amendment or an import supplies, held to its column's CHECK. */
export function checkDescription(value: unknown, current?: string | null): CheckedDescription {
  if (value === null) return { kind: 'ok', value: null };
  if (typeof value !== 'string') {
    return { kind: 'invalid', message: 'description must be a string or null' };
  }
  if (containsNul(value)) {
    return { kind: 'invalid', message: `description ${NUL_REFUSED_MESSAGE}` };
  }
  if (refusesBidi(value, current)) return { kind: 'invalid', message: BIDI_REFUSED_MESSAGE };
  return value.length > DESCRIPTION_MAX
    ? {
        kind: 'invalid',
        message: `description must be at most ${String(DESCRIPTION_MAX)} characters`,
      }
    : { kind: 'ok', value };
}
