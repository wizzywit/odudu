import { CONSENT_TEXT_MAX } from '@odudu/contracts/admin';
import { nullWhenBlank } from '#/shared/service/format';
import { DESCRIPTION_MAX } from '#/shared/service/labels';
import type { Choice } from '#/shared/service/choice';
import type { Translations } from '#/shared/service/localised';

export const CONSENT_RULE = `What the consent screen says in place of the scope's name. At most ${String(CONSENT_TEXT_MAX)} characters; leave it empty for none.`;

export const DESCRIPTION_LANGUAGES_LABEL = 'Description by language';
export const DESCRIPTION_LANGUAGES_NOTE = `What the scope is for in another language, shown wherever it is chosen in that language. At most ${String(DESCRIPTION_MAX)} characters in each; a language left empty shows the description above.`;

export const CONSENT_LANGUAGES_LABEL = 'Consent text by language';
export const CONSENT_LANGUAGES_NOTE = `What the consent screen says in another language. At most ${String(CONSENT_TEXT_MAX)} characters in each; a language left empty shows the consent text above, or the scope's name.`;
export const CONSENT_LIMIT = CONSENT_TEXT_MAX;

export const NAME_FIXED =
  "A scope's name is the token a client asks for and a token carries, so it is fixed once the scope is made. Make a new scope and assign it instead.";

export const ID_TOKEN_LABEL = 'In the ID token';
export const ACCESS_TOKEN_LABEL = 'In the access token';
export const NEW_CLIENT_LABEL = 'For a client made from now on';

export const NEW_CLIENT_CHOICES: readonly Choice[] = [
  { id: 'none', label: 'Not assigned' },
  { id: 'default', label: 'Assigned as default' },
  { id: 'optional', label: 'Assigned as optional' },
];

export function assignmentName(value: unknown): string {
  return NEW_CLIENT_CHOICES.find((choice) => choice.id === value)?.label ?? String(value);
}

const DISPLAY_ORDER_MAX = 2_147_483_647;

// Null when the text is a display order the server accepts.
export function displayOrderProblem(text: string): string | null {
  if (!/^\d+$/u.test(text)) return 'Enter a whole number, zero or more.';
  return Number(text) > DISPLAY_ORDER_MAX ? `Enter at most ${String(DISPLAY_ORDER_MAX)}.` : null;
}

// The consent section's guard: a display order that is not a number holds Save
// and is said under its field once it has been edited, beside what the server
// said of any field and any reason Save was already held.
function consentGuard(
  order: string,
  changed: readonly string[],
  fieldErrors: Readonly<Partial<Record<string, string>>>,
  blocked: string | undefined,
): { fieldErrors: Readonly<Partial<Record<string, string>>>; blocked: string | undefined } {
  const problem = displayOrderProblem(order);
  return {
    fieldErrors: {
      ...(problem !== null && changed.includes('display_order') ? { display_order: problem } : {}),
      ...fieldErrors,
    },
    blocked: problem ?? blocked,
  };
}

interface Guarded {
  values: { display_order: string };
  changed: readonly string[];
  fieldErrors: Readonly<Partial<Record<string, string>>>;
  blocked: string | undefined;
}

// The consent section as the page shows it: the section's own state with the
// guard's field errors and held-Save reason laid over it.
export function guardedConsent<S extends Guarded>(consent: S): S {
  return {
    ...consent,
    ...consentGuard(
      consent.values.display_order,
      consent.changed,
      consent.fieldErrors,
      consent.blocked,
    ),
  };
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
