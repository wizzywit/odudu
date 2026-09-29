import type { ListStatus } from '#/shared/service/resourceList.ts';

// A list to choose from inside a form: searched by name and paged by "Load
// more", its state kept here rather than in the address the page owns.
export interface PickerState<T> {
  readonly status: ListStatus;
  readonly options: readonly T[];
  readonly query: string;
  readonly search: (query: string) => void;
  readonly more: boolean;
  readonly loadingMore: boolean;
  readonly loadMore: () => void;
  readonly retry: () => void;
}
