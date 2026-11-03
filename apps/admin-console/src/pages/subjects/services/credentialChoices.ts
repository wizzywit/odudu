import { type Asking } from '#/pages/subjects/services/credentialAsk';

export interface Choices {
  newSet: boolean;
  endSessions: boolean;
}

export type ChoiceKey = keyof Choices;

// A new set is asked for unless the operator says otherwise: revoking a set
// from somebody who keeps a factor would otherwise leave them without a way
// back and without a prompt. Ending sessions is never the default, because
// whether the factor was lost is something only the operator knows.
export const CHOICE_DEFAULTS: Choices = { newSet: true, endSessions: false };

export function choicesWith(choices: Choices, key: ChoiceKey, checked: boolean): Choices {
  return { ...choices, [key]: checked };
}

export function choiceKeyOf(asking: Asking | null): ChoiceKey | null {
  if (asking === null) return null;
  if (asking.kind === 'factor') return asking.last ? 'endSessions' : null;
  if (asking.kind === 'recovery-codes') return asking.hasFactor ? 'newSet' : null;
  return null;
}

export interface ChoiceControl {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

// What the dialog draws for the choice the ask offers, or nothing.
export function choiceControl(
  asking: Asking | null,
  choices: Choices,
  set: (next: Choices) => void,
): ChoiceControl | null {
  const key = choiceKeyOf(asking);
  if (key === null) return null;
  return {
    checked: choices[key],
    onChange: (checked) => {
      set(choicesWith(choices, key, checked));
    },
  };
}
