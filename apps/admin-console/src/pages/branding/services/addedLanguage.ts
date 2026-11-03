import { LOCALISED_TEXT_ENTRIES_MAX } from '@odudu/contracts';
import { localeProblem } from '#/shared/lib/services/locales';

export const ADD_LABEL = 'Add a language';

export const ADD_NOTE =
  'Choose a language or type its tag, such as fr or pt-BR. Its pages use the English text unless a message override says otherwise.';

export const ADD_BUTTON = 'Add language';

export const ADD_NEEDED = 'Choose a language, or type a tag such as fr-CA.';

export const ADD_DUPLICATE = 'That language is already offered.';

const ADD_FULL = `A tenant offers at most ${String(LOCALISED_TEXT_ENTRIES_MAX)} languages.`;

export interface Added {
  // The supported languages with the new one, or null when it is refused.
  supported: string[] | null;
  problem: string | null;
}

// A typed or chosen tag joined to the supported languages, or why it cannot.
export function languageAdded(supported: readonly string[], text: string): Added {
  const tag = text.trim();
  const problem = tag === '' ? ADD_NEEDED : localeProblem(tag);
  if (problem !== null) return { supported: null, problem };
  if (supported.some((held) => held.toLowerCase() === tag.toLowerCase())) {
    return { supported: null, problem: ADD_DUPLICATE };
  }
  if (supported.length >= LOCALISED_TEXT_ENTRIES_MAX) return { supported: null, problem: ADD_FULL };
  return { supported: [...supported, tag], problem: null };
}

export interface AddedTo {
  // The problem with what was typed, or undefined to clear one shown.
  problem: (problem: string | undefined) => void;
  accepted: (supported: string[]) => void;
}

// Adds what was typed, or says why it cannot be.
export function addLanguage(supported: readonly string[], text: string, to: AddedTo): void {
  const added = languageAdded(supported, text);
  to.problem(added.problem ?? undefined);
  if (added.supported !== null) to.accepted(added.supported);
}

// Enter adds the typed tag, unless it is choosing an option the list points at
// that is not the one already chosen.
export function addsOnKey(key: string, choosing: boolean): boolean {
  return key === 'Enter' && !choosing;
}
