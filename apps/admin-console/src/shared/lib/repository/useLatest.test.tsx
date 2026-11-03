import { renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useLatest } from '#/shared/lib/repository/useLatest';

it('reads the value of the latest render, through the same function throughout', () => {
  const { result, rerender } = renderHook(({ value }) => useLatest(value), {
    initialProps: { value: 'first' },
  });
  const latest = result.current;
  expect(latest()).toBe('first');
  rerender({ value: 'second' });
  expect(result.current).toBe(latest);
  expect(latest()).toBe('second');
});
