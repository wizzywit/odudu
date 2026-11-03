import { CONSENT_TEXT_MAX } from '@odudu/contracts/admin';
import { DESCRIPTION_MAX } from '#/shared/lib/services/labels';
import { displayOrderProblem } from '#/pages/scopes/services/scopeDetails';

export const CONSENT_RULE = `What the consent screen says in place of the scope's name. At most ${String(CONSENT_TEXT_MAX)} characters; leave it empty for none.`;

export const DESCRIPTION_LANGUAGES_LABEL = 'Description by language';
export const DESCRIPTION_LANGUAGES_NOTE = `What the scope is for in another language, shown wherever it is chosen in that language. At most ${String(DESCRIPTION_MAX)} characters in each; a language left empty shows the description above.`;

export const CONSENT_LANGUAGES_LABEL = 'Consent text by language';
export const CONSENT_LANGUAGES_NOTE = `What the consent screen says in another language. At most ${String(CONSENT_TEXT_MAX)} characters in each; a language left empty shows the consent text above, or the scope's name.`;
export const CONSENT_LIMIT = CONSENT_TEXT_MAX;

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
