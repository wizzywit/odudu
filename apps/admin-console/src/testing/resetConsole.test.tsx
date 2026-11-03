import { cleanup, render } from '@testing-library/react';
import { useEffect } from 'react';
import { expect, it, vi } from 'vitest';
import { loadDrafts } from '#/shared/api/adapter/draftStorage';
import { useDialogHost } from '#/shared/lib/repository/useDialogHost';
import { useDrafts } from '#/shared/lib/repository/useDrafts';
import { useToasts } from '#/shared/lib/repository/useToasts';
import { useUnsavedGuard } from '#/shared/lib/repository/useUnsavedGuard';
import { resetConsole } from '#/testing/resetConsole';

const dirtySource = {
  record: 'acme/clients/c1',
  section: 'general',
  dirty: () => true,
  fields: () => ({ name: { kind: 'plain' as const, value: 'Billing' } }),
  etag: () => '"e1"',
};

function leaveEverythingSet() {
  useToasts.getState().push({ tone: 'success', message: 'Saved' });
  useDialogHost.getState().opened();
  useUnsavedGuard.getState().setDirty('client/general', 'General');
  useUnsavedGuard.getState().request(vi.fn());
  useUnsavedGuard.getState().release();
  useUnsavedGuard.getState().leave();
  useDrafts.getState().register(dirtySource);
  useDrafts.getState().keepDirty('acme/s1');
}

it('puts every store back to the state it was created with', () => {
  leaveEverythingSet();
  expect(useToasts.getState()).not.toEqual(useToasts.getInitialState());
  expect(useDialogHost.getState()).not.toEqual(useDialogHost.getInitialState());
  expect(useUnsavedGuard.getState()).not.toEqual(useUnsavedGuard.getInitialState());
  expect(loadDrafts()).not.toBeNull();

  resetConsole();

  expect(useToasts.getState()).toEqual(useToasts.getInitialState());
  expect(useDialogHost.getState()).toEqual(useDialogHost.getInitialState());
  expect(useUnsavedGuard.getState()).toEqual(useUnsavedGuard.getInitialState());
  expect(loadDrafts()).toBeNull();
});

it("starts toast ids again, so a test never sees another test's count", () => {
  useToasts.getState().push({ tone: 'success', message: 'One' });
  const second = useToasts.getState().push({ tone: 'success', message: 'Two' });
  resetConsole();
  const first = useToasts.getState().push({ tone: 'success', message: 'One' });
  expect(first).not.toBe(second);
  expect(first).toBe('toast-1');
});

it('forgets a section a test registered and never unmounted', () => {
  useDrafts.getState().register(dirtySource);
  resetConsole();
  expect(useDrafts.getState().keepDirty('acme/s1')).toBe(0);
});

function Dialog() {
  const opened = useDialogHost((host) => host.opened);
  useEffect(() => opened(), [opened]);
  return null;
}

it('unmounts what is still on screen first, so a dialog closing after it cannot take the host below zero', () => {
  render(<Dialog />);
  expect(useDialogHost.getState().open).toBe(1);
  resetConsole();
  cleanup();
  expect(useDialogHost.getState().open).toBe(0);
});
