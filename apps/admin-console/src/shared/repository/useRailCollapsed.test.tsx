import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useRailCollapsed } from '#/shared/repository/useRailCollapsed.ts';

afterEach(() => {
  localStorage.clear();
});

it('starts from the remembered choice and remembers each new one', () => {
  localStorage.setItem('odudu.console.rail', 'collapsed');
  const { result } = renderHook(() => useRailCollapsed());
  expect(result.current[0]).toBe(true);
  act(() => {
    result.current[1](false);
  });
  expect(result.current[0]).toBe(false);
  expect(localStorage.getItem('odudu.console.rail')).toBeNull();
});
