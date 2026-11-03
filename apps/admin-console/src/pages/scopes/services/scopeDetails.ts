import { nullWhenBlank } from '#/shared/services/format';
import type { Translations } from '#/shared/services/localised';

export const NEW_SCOPE_TITLE = 'Create a scope';

// Names a scope's page before its record is read, and the area's trail.
export const SCOPE_TITLE = 'Scope';

export const NAME_FIXED =
  "A scope's name is the token a client asks for and a token carries, so it is fixed once the scope is made. Make a new scope and assign it instead.";

const DISPLAY_ORDER_MAX = 2_147_483_647;

// Null when the text is a display order the server accepts.
export function displayOrderProblem(text: string): string | null {
  if (!/^\d+$/u.test(text)) return 'Enter a whole number, zero or more.';
  return Number(text) > DISPLAY_ORDER_MAX ? `Enter at most ${String(DISPLAY_ORDER_MAX)}.` : null;
}

export interface GeneralValues {
  description?: string;
  include_in_id_token?: boolean;
  include_in_access_token?: boolean;
  default_client_assignment?: string;
  consent_text?: string;
  display_order?: string;
  description_i18n?: Translations;
  consent_text_i18n?: Translations;
}

interface Patch {
  description?: string | null;
  consent_text?: string | null;
  include_in_id_token?: boolean;
  include_in_access_token?: boolean;
  default_client_assignment?: string | null;
  display_order?: number;
  description_i18n?: Translations;
  consent_text_i18n?: Translations;
}

// The body of an amendment: an emptied text field clears the value, and a
// number is sent as one.
export function generalPatch(changes: GeneralValues): Patch {
  const body: Patch = {};
  if (changes.description !== undefined) body.description = nullWhenBlank(changes.description);
  if (changes.consent_text !== undefined) body.consent_text = nullWhenBlank(changes.consent_text);
  if (changes.include_in_id_token !== undefined) {
    body.include_in_id_token = changes.include_in_id_token;
  }
  if (changes.include_in_access_token !== undefined) {
    body.include_in_access_token = changes.include_in_access_token;
  }
  if (changes.default_client_assignment !== undefined) {
    body.default_client_assignment =
      changes.default_client_assignment === 'none' ? null : changes.default_client_assignment;
  }
  if (changes.display_order !== undefined) body.display_order = Number(changes.display_order);
  if (changes.description_i18n !== undefined) body.description_i18n = changes.description_i18n;
  if (changes.consent_text_i18n !== undefined) body.consent_text_i18n = changes.consent_text_i18n;
  return body;
}

export const scopeFailureFields: readonly string[] = [
  'name',
  'description',
  'include_in_id_token',
  'include_in_access_token',
  'default_client_assignment',
  'consent_text',
  'display_order',
  'description_i18n',
  'consent_text_i18n',
];
