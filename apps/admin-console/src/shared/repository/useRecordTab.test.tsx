import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { useRecordTab } from '#/shared/repository/useRecordTab.ts';
import { parseSearch, stringifySearch } from '#/shared/service/search.ts';
import { Tabs } from '#/shared/view/Tabs';

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
        { id: 'general', label: 'General', panel: <p>General panel</p> },
        { id: 'tokens', label: 'Tokens', panel: <p>Tokens panel</p> },
      ]}
    />
  );
}

function mount(url: string) {
  const root = createRootRoute();
  const client = createRoute({
    getParentRoute: () => root,
    path: '/clients/c1',
    component: Client,
  });
  const router = createRouter({
    routeTree: root.addChildren([client]),
    history: createMemoryHistory({ initialEntries: [url] }),
    parseSearch,
    stringifySearch,
  });
  render(<RouterProvider router={router} />);
  return router;
}

it("keeps the chosen tab in the URL, and leaves the last tab's list behind", async () => {
  const user = userEvent.setup();
  const router = mount('/clients/c1?q=x&after=b2Zmc2V0LTE.dGFnMQ');
  expect(await screen.findByText('General panel')).toBeVisible();
  await user.click(screen.getByRole('tab', { name: 'Tokens' }));
  expect(await screen.findByText('Tokens panel')).toBeVisible();
  expect(router.state.location.href).toBe('/clients/c1?tab=tokens');
});

it('opens on the tab the URL names', async () => {
  mount('/clients/c1?tab=tokens');
  expect(await screen.findByText('Tokens panel')).toBeVisible();
});

it('falls back to the first tab for a name the record does not have', async () => {
  mount('/clients/c1?tab=nonsense');
  expect(await screen.findByText('General panel')).toBeVisible();
});
