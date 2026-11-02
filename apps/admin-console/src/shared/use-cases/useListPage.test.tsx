import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import type { ResourceListState } from '#/shared/services/resourceList';
import { useListPage } from '#/shared/use-cases/useListPage';
import { mountAtRoute } from '#/testing/mountAtRoute';

const LIST: ResourceListState<{ id: string }> = {
  status: 'ready',
  rows: [{ id: 'x1' }],
  count: null,
  search: null,
  filters: {},
  narrowed: false,
  trail: [],
  next: null,
  loadingMore: false,
  loadLimited: false,
  loadMoreFailed: false,
  setSearch: () => undefined,
  setFilter: () => undefined,
  clear: () => undefined,
  setTrail: () => undefined,
  loadMore: () => undefined,
  retry: () => undefined,
};

function Page() {
  const page = useListPage(LIST, '/console/acme/things/new', (id) => `/console/acme/things/${id}`);
  return (
    <>
      <a href={page.createHref}>New</a>
      <button
        type="button"
        onClick={() => {
          page.open('x1');
        }}
      >
        Open
      </button>
    </>
  );
}

it('carries the list and the create address, and opens a row through the router', async () => {
  const { router } = mountAtRoute('/console/acme/things', '/acme/things', Page, {
    basepath: '/console',
  });
  expect(await screen.findByRole('link', { name: 'New' })).toHaveAttribute(
    'href',
    '/console/acme/things/new',
  );
  await userEvent.setup().click(screen.getByRole('button', { name: 'Open' }));
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/acme/things/x1');
  });
});
