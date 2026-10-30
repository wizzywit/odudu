import { BIDI_REFUSED_MESSAGE, checkLocalisedText, refusesBidi } from '@odudu/contracts';
import { CONSENT_TEXT_MAX, DESCRIPTION_MAX } from '@odudu/contracts/admin';

export type Checked<T> = { kind: 'ok'; value: T } | { kind: 'invalid'; message: string };

const INTEGER_CEILING = 2_147_483_647;

/** A scope's consent text, held to `client_scopes_consent_text_length` (0090). */
export function checkConsentText(value: unknown, current?: string | null): Checked<string | null> {
  if (value === null) return { kind: 'ok', value: null };
  if (typeof value !== 'string' || value.length === 0) {
    return { kind: 'invalid', message: 'consent_text must be a non-empty string or null' };
  }
  if (refusesBidi(value, current)) return { kind: 'invalid', message: BIDI_REFUSED_MESSAGE };
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

export type ScopeLocalisedField = 'description_i18n' | 'consent_text_i18n';

/**
 * A scope's per-language text, each value held to its base column's limit
 * (the consent text's CHECK; the description's own bound) and, when the
 * tenant's languages are known, each language to one of them.
 */
export function checkScopeLocalised(
  field: ScopeLocalisedField,
  value: unknown,
  options: { supported?: readonly string[]; current?: Readonly<Record<string, string>> },
): Checked<Record<string, string>> {
  const checked = checkLocalisedText(field, value, {
    max: field === 'consent_text_i18n' ? CONSENT_TEXT_MAX : DESCRIPTION_MAX,
    ...options,
  });
  return checked.kind === 'ok'
    ? { kind: 'ok', value: checked.value }
    : { kind: 'invalid', message: checked.message };
}
