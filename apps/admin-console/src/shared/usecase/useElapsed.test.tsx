import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useElapsed } from '#/shared/usecase/useElapsed.ts';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it('is false until the delay has passed, then true', async () => {
  const { result } = renderHook(() => useElapsed(200));
  expect(result.current).toBe(false);
  await act(() => vi.advanceTimersByTimeAsync(199));
  expect(result.current).toBe(false);
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(result.current).toBe(true);
});

it('leaves no timer behind when it unmounts early', () => {
  const { unmount } = renderHook(() => useElapsed(200));
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
