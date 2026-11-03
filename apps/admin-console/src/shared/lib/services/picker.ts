import type { ListStatus } from '#/shared/lib/services/resourceList';

// A list to choose from inside a form: searched by name and paged by "Load
// more", its state kept here rather than in the address the page owns.
export interface PickerState<T> {
  status: ListStatus;
  options: readonly T[];
  query: string;
  search: (query: string) => void;
  more: boolean;
  loadingMore: boolean;
  loadLimited: boolean;
  loadMore: () => void;
  retry: () => void;
}

// A picker used to choose one, whose first id is the choice.
export function firstChosen(ids: readonly string[]): string | null {
  return ids[0] ?? null;
}

// A multiple-choice picker used to choose one reports every id it holds; the one chosen last is the choice.
export function lastChosen(ids: readonly string[]): string | null {
  return ids.at(-1) ?? null;
}
