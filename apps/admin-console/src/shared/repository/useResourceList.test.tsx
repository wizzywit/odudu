import { QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  countResponseSchema,
  listSubjectsResponseSchema,
  type Subject,
} from '@odudu/contracts/admin';
import { expect, it } from 'vitest';
import { createQueryClient } from '#/shared/repository/queryClient.ts';
import { useResourceList } from '#/shared/repository/useResourceList.ts';
import { parseSearch, stringifySearch } from '#/shared/service/search.ts';
import type { Gateway } from '#/shared/transport/gateway.ts';
import { TransportContext } from '#/shared/transport/useTransport.ts';
import { fakeTransport, json, problem, type Answer } from '#/testing/fakeTransport.ts';

const LIST = 'GET /console/api/admin/tenants/acme/subjects';
const COUNT = 'GET /console/api/admin/tenants/acme/subjects/count';
const CURSOR = 'b2Zmc2V0LTE.dGFnMQ';
const LATER = 'b2Zmc2V0LTI.dGFnMg';

function subject(username: string): Subject {
  return {
    id: `id-${username}`,
    type: 'user',
    username,
    email: `${username}@acme.example`,
    enabled: true,
    created_at: '2026-09-28T13:41:05Z',
  };
}

const readSubjects = (gateway: Gateway, query: URLSearchParams) =>
  gateway.request('GET', `admin/tenants/acme/subjects?${query.toString()}`, {
    schema: listSubjectsResponseSchema,
  });

const countSubjects = (gateway: Gateway, query: URLSearchParams) =>
  gateway.request('GET', `admin/tenants/acme/subjects/count?${query.toString()}`, {
    schema: countResponseSchema,
  });

function Subjects() {
  const list = useResourceList({
    tenant: 'acme',
    resource: 'subjects',
    search: ['username', 'email'],
    filters: ['enabled'],
    read: readSubjects,
    count: countSubjects,
  });
  return (
    <>
      <p>{`status ${list.status}`}</p>
      <p>{`count ${list.count === null ? 'none' : String(list.count.count)}`}</p>
      <ul aria-label="Subjects">
        {list.rows.map((row) => (
          <li key={row.id}>{row.username}</li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => {
          list.setSearch({ field: 'email', query: 'gr' });
        }}
      >
        Search email
      </button>
      <button
        type="button"
        onClick={() => {
          list.setFilter('enabled', 'false');
        }}
      >
        Disabled only
      </button>
      <button type="button" onClick={list.clear}>
        Clear
      </button>
      <button type="button" disabled={list.next === null} onClick={list.loadMore}>
        Load more
      </button>
      <button
        type="button"
        disabled={list.next === null}
        onClick={() => {
          if (list.next !== null) list.setTrail([...list.trail, list.next]);
        }}
      >
        Next
      </button>
    </>
  );
}

function mount(url: string, routes: Record<string, Answer>) {
  const fake = fakeTransport(routes);
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/acme/subjects',
    component: Subjects,
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: [url] }),
    basepath: '/console',
    parseSearch,
    stringifySearch,
  });
  render(
    <TransportContext value={fake.transport}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </TransportContext>,
  );
  const asked = (key: string) =>
    fake.sent
      .filter((request) => `${request.method} ${request.path}` === key)
      .map((request) => request.search.toString());
  return { ...fake, router, asked };
}

it('asks the API for what the address says, and counts the same narrowing', async () => {
  const { asked } = mount(`/console/acme/subjects?q=ad&enabled=true&after=${CURSOR}`, {
    [LIST]: json({ items: [subject('ada')] }),
    [COUNT]: json({ count: 1, capped: false }),
  });
  expect(await screen.findByText('ada')).toBeVisible();
  expect(screen.getByText('count 1')).toBeVisible();
  expect(asked(LIST)).toEqual([`username=ad&enabled=true&cursor=${CURSOR}`]);
  expect(asked(COUNT)).toEqual(['username=ad&enabled=true']);
});

it('writes a new search into the address and starts again from the first page', async () => {
  const user = userEvent.setup();
  const { router, asked } = mount(`/console/acme/subjects?q=ad&after=${CURSOR}`, {
    [LIST]: json({ items: [subject('grace')] }),
    [COUNT]: json({ count: 1, capped: false }),
  });
  await screen.findByText('grace');
  await user.click(screen.getByRole('button', { name: 'Search email' }));
  await waitFor(() => {
    expect(router.state.location.searchStr).toBe('?q=gr&by=email');
  });
  await waitFor(() => {
    expect(asked(LIST).at(-1)).toBe('email=gr');
  });
  await user.click(screen.getByRole('button', { name: 'Disabled only' }));
  await waitFor(() => {
    expect(router.state.location.searchStr).toBe('?q=gr&by=email&enabled=false');
  });
  await user.click(screen.getByRole('button', { name: 'Clear' }));
  await waitFor(() => {
    expect(router.state.location.searchStr).toBe('');
  });
});

it('loads more in place, and pages by the cursor trail in the address', async () => {
  const user = userEvent.setup();
  const pages: Record<string, unknown> = {
    '': { items: [subject('ada')], next: CURSOR },
    [CURSOR]: { items: [subject('grace')], next: LATER },
    [LATER]: { items: [subject('linus')] },
  };
  const { router, asked } = mount('/console/acme/subjects', {
    [LIST]: (request) => json(pages[request.search.get('cursor') ?? ''])(request),
    [COUNT]: json({ count: 3, capped: false }),
  });
  await screen.findByText('ada');
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  expect(await screen.findByText('grace')).toBeVisible();
  expect(screen.getByText('ada')).toBeVisible();
  expect(router.state.location.searchStr).toBe('');

  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('linus')).toBeVisible();
  expect(screen.queryByText('ada')).toBeNull();
  expect(router.state.location.searchStr).toBe(`?after=${LATER}`);
  expect(asked(LIST)).toEqual(['', `cursor=${CURSOR}`, `cursor=${LATER}`]);
  expect(screen.getByRole('button', { name: 'Load more' })).toBeDisabled();
});

it('says a read the server refused is refused, not a failure to load', async () => {
  mount('/console/acme/subjects', {
    [LIST]: problem(403, 'about:blank', 'Forbidden'),
    [COUNT]: problem(403, 'about:blank', 'Forbidden'),
  });
  expect(await screen.findByText('status refused')).toBeVisible();
  expect(screen.getByText('count none')).toBeVisible();
});

it('says a read that failed failed', async () => {
  mount('/console/acme/subjects', {
    [LIST]: problem(500, 'about:blank', 'Internal Server Error'),
    [COUNT]: json({ count: 0, capped: false }),
  });
  expect(await screen.findByText('status failed')).toBeVisible();
});
