import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useDirtySections } from '#/shared/repository/useDirtySections.ts';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';

afterEach(() => {
  useUnsavedGuard.getState().reset();
});

it("names the sections of one record that hold unsaved edits, and no other record's", () => {
  const { result } = renderHook(() => useDirtySections('acme', 'clients/c1'));
  expect([...result.current]).toEqual([]);
  act(() => {
    const { setDirty } = useUnsavedGuard.getState();
    setDirty('acme/clients/c1#general', 'General');
    setDirty('acme/clients/c10#tokens', 'Tokens');
    setDirty('globex/clients/c1#logout', 'Logout');
  });
  expect([...result.current]).toEqual(['general']);
  act(() => {
    useUnsavedGuard.getState().setDirty('acme/clients/c1#general', null);
  });
  expect([...result.current]).toEqual([]);
});

it('names nothing for a record there is not, however much else is unsaved', () => {
  const { result } = renderHook(() => useDirtySections('acme', null));
  act(() => {
    useUnsavedGuard.getState().setDirty('acme/subjects//roles#serviceRoles', 'Roles');
  });
  expect([...result.current]).toEqual([]);
});
