import { CONSENT_TEXT_MAX } from '@odudu/contracts/admin';

export type Checked<T> = { kind: 'ok'; value: T } | { kind: 'invalid'; message: string };

const INTEGER_CEILING = 2_147_483_647;

/** A scope's consent text, held to `client_scopes_consent_text_length` (0090). */
export function checkConsentText(value: unknown): Checked<string | null> {
  if (value === null) return { kind: 'ok', value: null };
  if (typeof value !== 'string' || value.length === 0) {
    return { kind: 'invalid', message: 'consent_text must be a non-empty string or null' };
  }
  return value.length > CONSENT_TEXT_MAX
    ? {
        kind: 'invalid',
        message: `consent_text must be at most ${String(CONSENT_TEXT_MAX)} characters`,
      }
    : { kind: 'ok', value };
}

/** A scope's place on the consent screen, held to `client_scopes_display_order_floor`. */
export function checkDisplayOrder(value: unknown): Checked<number> {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= INTEGER_CEILING
    ? { kind: 'ok', value }
    : { kind: 'invalid', message: 'display_order must be an integer of at least 0' };
}
