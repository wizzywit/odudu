import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { useDirtySection } from '#/shared/repository/useDirtySection.ts';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';

beforeEach(() => {
  useUnsavedGuard.getState().reset();
});

const unsaved = () => useUnsavedGuard.getState().unsaved();

it('tells the guard while the section has changes, and stops when it has none', () => {
  const { rerender } = renderHook(
    ({ dirty }) => {
      useDirtySection('client/general', 'General', dirty);
    },
    { initialProps: { dirty: true } },
  );
  expect(unsaved()).toEqual(['General']);
  rerender({ dirty: false });
  expect(unsaved()).toEqual([]);
});

it('forgets the section when it goes', () => {
  const { unmount } = renderHook(() => {
    useDirtySection('client/general', 'General', true);
  });
  unmount();
  expect(unsaved()).toEqual([]);
});

it('going does not let a departure held for its edits through', () => {
  const { unmount } = renderHook(() => {
    useDirtySection('client/general', 'General', true);
  });
  let left = false;
  act(() => {
    useUnsavedGuard.getState().request(() => {
      left = true;
    });
  });
  unmount();
  expect(left).toBe(false);
  expect(useUnsavedGuard.getState().pending).not.toBeNull();
});

it('says so again after a leave that did not take it off the screen', () => {
  renderHook(() => {
    useDirtySection('client/general', 'General', true);
  });
  act(() => {
    useUnsavedGuard.getState().request(() => undefined);
    useUnsavedGuard.getState().leave();
  });
  expect(unsaved()).toEqual(['General']);
});
