// One option of a select, which the view draws.
export interface Choice {
  id: string;
  label: string;
}

// A select cannot hold "no choice" as an empty id, so it holds this, and the
// server is sent null for it.
export const AUTO = 'auto';

export function choiceOf(stored: string | null): string {
  return stored ?? AUTO;
}

export function sentOf(choice: string): string | null {
  return choice === AUTO ? null : choice;
}
