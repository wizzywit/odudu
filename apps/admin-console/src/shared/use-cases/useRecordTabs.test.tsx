import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it } from 'vitest';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard';
import { sectionKey } from '#/shared/services/record';
import { parseSearch, stringifySearch } from '#/shared/services/search';
import { useRecordTabs } from '#/shared/use-cases/useRecordTabs';
import { resetConsole } from '#/testing/resetConsole';

const TABS = ['general', 'roles', 'activity'] as const;
const RECORDS = {
  general: (id: string) => [`groups/${id}`],
  roles: (id: string) => [`groups/${id}/roles`],
  activity: () => [],
};

function Page() {
  const { tab, selectTab, dirty } = useRecordTabs(TABS, RECORDS, 'acme', 'g1');
  return (
    <>
      <p>{`tab ${tab}`}</p>
      <p>{`dirty ${[...dirty].join(',')}`}</p>
      <button
        type="button"
        onClick={() => {
          selectTab('roles');
        }}
      >
        Roles
      </button>
      <button
        type="button"
        onClick={() => {
          selectTab('nonsense');
        }}
      >
        Nonsense
      </button>
    </>
  );
}

function mount(url: string) {
  const root = createRootRoute();
  const page = createRoute({ getParentRoute: () => root, path: '/groups/g1', component: Page });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: [url] }),
    parseSearch,
    stringifySearch,
  });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  resetConsole();
});

it('opens on the tab the URL names and moves to one the record has', async () => {
  const router = mount('/groups/g1?tab=activity');
  expect(await screen.findByText('tab activity')).toBeVisible();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Roles' }));
  expect(await screen.findByText('tab roles')).toBeVisible();
  expect(router.state.location.href).toBe('/groups/g1?tab=roles');
});

it('ignores a name the record has no tab for', async () => {
  const router = mount('/groups/g1');
  expect(await screen.findByText('tab general')).toBeVisible();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Nonsense' }));
  expect(router.state.location.href).toBe('/groups/g1');
});

it('marks the tabs whose records hold unsaved edits, and only those', async () => {
  mount('/groups/g1');
  expect(await screen.findByText('dirty')).toBeVisible();
  act(() => {
    useUnsavedGuard.getState().setDirty(sectionKey('acme', 'groups/g1/roles', 'roles'), 'Roles');
    useUnsavedGuard.getState().setDirty(sectionKey('other', 'groups/g1', 'description'), 'Other');
  });
  expect(await screen.findByText('dirty roles')).toBeVisible();
});
