import {
  createBrowserHistory,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  type RouterHistory,
} from '@tanstack/react-router';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { NavigationGuard } from '#/app/NavigationGuard.tsx';
import { Providers } from '#/app/Providers.tsx';
import { UnsavedGuardLayer } from '#/app/UnsavedGuardLayer.tsx';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';

afterEach(() => {
  useUnsavedGuard.getState().reset();
});

function mount(history: RouterHistory) {
  const root = createRootRoute({
    component: () => (
      <>
        <NavigationGuard />
        <Outlet />
      </>
    ),
  });
  const clients = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <h1>Clients</h1>,
  });
  const keys = createRoute({
    getParentRoute: () => root,
    path: '/keys',
    component: () => <h1>Signing keys</h1>,
  });
  const router = createRouter({ routeTree: root.addChildren([clients, keys]), history });
  render(
    <Providers>
      <RouterProvider router={router} />
      <UnsavedGuardLayer />
    </Providers>,
  );
  return router;
}

function makeDirty(): void {
  act(() => {
    useUnsavedGuard.getState().setDirty('client/general', 'General');
  });
}

describe('in-app navigation', () => {
  it('goes straight through when nothing is unsaved', async () => {
    const router = mount(createMemoryHistory({ initialEntries: ['/'] }));
    await screen.findByRole('heading', { name: 'Clients' });
    act(() => {
      router.history.push('/keys');
    });
    expect(await screen.findByRole('heading', { name: 'Signing keys' })).toBeVisible();
  });

  it('asks first, and stays when told to', async () => {
    const user = userEvent.setup();
    const router = mount(createMemoryHistory({ initialEntries: ['/'] }));
    await screen.findByRole('heading', { name: 'Clients' });
    makeDirty();
    act(() => {
      router.history.push('/keys');
    });
    await screen.findByRole('alertdialog', { name: 'Leave without saving?' });
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(screen.getByRole('heading', { name: 'Clients' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/');
    expect(useUnsavedGuard.getState().unsaved()).toEqual(['General']);
  });

  it('goes once the changes are discarded', async () => {
    const user = userEvent.setup();
    const router = mount(createMemoryHistory({ initialEntries: ['/'] }));
    await screen.findByRole('heading', { name: 'Clients' });
    makeDirty();
    act(() => {
      router.history.push('/keys');
    });
    await user.click(await screen.findByRole('button', { name: 'Discard changes and leave' }));
    expect(await screen.findByRole('heading', { name: 'Signing keys' })).toBeVisible();
  });
});

describe('the browser', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('asks before going back, and stays on the page when told to', async () => {
    const user = userEvent.setup();
    const router = mount(createBrowserHistory());
    await screen.findByRole('heading', { name: 'Clients' });
    act(() => {
      router.history.push('/keys');
    });
    await screen.findByRole('heading', { name: 'Signing keys' });
    makeDirty();

    act(() => {
      window.history.back();
    });

    await screen.findByRole('alertdialog', { name: 'Leave without saving?' });
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    await waitFor(() => {
      expect(window.location.pathname).toBe('/keys');
    });
    expect(screen.getByRole('heading', { name: 'Signing keys' })).toBeVisible();
  });

  function unload(): boolean {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }

  it('asks before a reload or a close only while something is unsaved', async () => {
    mount(createMemoryHistory({ initialEntries: ['/'] }));
    await screen.findByRole('heading', { name: 'Clients' });
    expect(unload()).toBe(false);
    makeDirty();
    expect(unload()).toBe(true);
  });

  it('stays quiet once the console itself is leaving the page', async () => {
    mount(createMemoryHistory({ initialEntries: ['/'] }));
    await screen.findByRole('heading', { name: 'Clients' });
    makeDirty();
    act(() => {
      useUnsavedGuard.getState().release();
    });
    expect(unload()).toBe(false);
  });
});
