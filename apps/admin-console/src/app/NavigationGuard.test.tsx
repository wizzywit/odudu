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
import { useDirtySection } from '#/shared/repository/useDirtySection.ts';
import { useRecordTab } from '#/shared/repository/useRecordTab.ts';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';
import { Tabs } from '#/shared/view/Tabs';

afterEach(() => {
  useUnsavedGuard.getState().reset();
});

function DirtyGeneral() {
  useDirtySection('client/general', 'General', true);
  return <p>General panel</p>;
}

function Client() {
  const { tab, selectTab } = useRecordTab(['general', 'tokens'] as const);
  return (
    <Tabs
      label="Client"
      selectedKey={tab}
      onSelectionChange={(id) => {
        if (id === 'general' || id === 'tokens') selectTab(id);
      }}
      tabs={[
        { id: 'general', label: 'General', dirty: true, panel: <DirtyGeneral /> },
        { id: 'tokens', label: 'Tokens', panel: <p>Tokens panel</p> },
      ]}
    />
  );
}

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
  const client = createRoute({ getParentRoute: () => root, path: '/client', component: Client });
  const router = createRouter({ routeTree: root.addChildren([clients, keys, client]), history });
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

describe('a tab change inside a record', () => {
  it('asks first, keeping the tab and its work on stay, and changes tab on discard', async () => {
    const user = userEvent.setup();
    mount(createMemoryHistory({ initialEntries: ['/client'] }));
    await screen.findByText('General panel');

    await user.click(screen.getByRole('tab', { name: 'Tokens' }));
    await user.click(
      await screen
        .findByRole('alertdialog', { name: 'Leave without saving?' })
        .then(() => screen.getByRole('button', { name: 'Stay' })),
    );
    expect(screen.getByRole('tab', { name: 'General, unsaved changes' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('General panel')).toBeVisible();

    await user.click(screen.getByRole('tab', { name: 'Tokens' }));
    await user.click(await screen.findByRole('button', { name: 'Discard changes and leave' }));
    expect(await screen.findByText('Tokens panel')).toBeVisible();
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

  it('asks again when the page comes back from the back-forward cache', async () => {
    mount(createMemoryHistory({ initialEntries: ['/'] }));
    await screen.findByRole('heading', { name: 'Clients' });
    makeDirty();
    act(() => {
      useUnsavedGuard.getState().release();
    });
    expect(unload()).toBe(false);
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
    expect(unload()).toBe(false);
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
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
