import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { useSignIn } from '#/entities/session/use-cases/useSignIn';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard';
import { hookHarness } from '#/testing/hookHarness';
import { mountAtRoute } from '#/testing/mountAtRoute';
import { resetConsole } from '#/testing/resetConsole';

afterEach(() => {
  resetConsole();
});

function SignIn() {
  const signIn = useSignIn();
  return (
    <button
      type="button"
      onClick={() => {
        signIn('acme', '/console/acme/clients');
      }}
    >
      Sign in
    </button>
  );
}

function mount() {
  const { transport, queryClient, leavePage } = hookHarness({});
  mountAtRoute('/page', '/page', SignIn, { providers: { transport, queryClient } });
  return { leavePage };
}

it('goes to the tenant’s sign-in at once when nothing is unsaved', async () => {
  const { leavePage } = mount();
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Sign in' }));
  const url = new URL(leavePage.mock.calls[0]?.[0] ?? '', location.origin);
  expect(url.pathname).toBe('/console/auth/login');
  expect(url.searchParams.get('return_to')).toBe('/console/acme/clients');
});

it('waits on the guard while an edit is unsaved, and goes once it is let go', async () => {
  const { leavePage } = mount();
  useUnsavedGuard.getState().setDirty('client/general', 'General');
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Sign in' }));
  expect(leavePage).not.toHaveBeenCalled();
  expect(useUnsavedGuard.getState().pending).not.toBeNull();
  act(() => {
    useUnsavedGuard.getState().leave();
  });
  await waitFor(() => {
    expect(leavePage).toHaveBeenCalledOnce();
  });
});
