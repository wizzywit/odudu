import { vi } from 'vitest';
import type { PickerState } from '#/shared/services/picker';

// A picker with its options loaded and nothing typed, its callbacks spies.
export function pickerState<T>(
  options: readonly T[],
  overrides: Partial<PickerState<T>> = {},
): PickerState<T> {
  return {
    status: 'ready',
    options,
    query: '',
    search: vi.fn(),
    more: false,
    loadingMore: false,
    loadLimited: false,
    loadMore: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  };
}
