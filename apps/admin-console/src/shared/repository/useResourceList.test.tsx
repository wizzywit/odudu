import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  countResponseSchema,
  listSubjectsResponseSchema,
  type Subject,
} from '@odudu/contracts/admin';
import { expect, it } from 'vitest';
import { createReadCache } from '#/shared/repository/readCache';
import { ROW_BUDGET } from '#/shared/services/resourceList';
import { useResourceList } from '#/shared/repository/useResourceList';
import type { Gateway } from '#/shared/transport/gateway';
import { fakeTransport, json, pending, problem, type Answer } from '#/testing/fakeTransport';
import { mountAtRoute } from '#/testing/mountAtRoute';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const LIST = `GET ${ACME_ADMIN}/subjects`;
const COUNT = `GET ${ACME_ADMIN}/subjects/count`;
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
      <p>{list.loadMoreFailed ? 'more failed' : 'more ok'}</p>
      <p>{`load limit ${String(list.loadLimited)}`}</p>
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
  const { router } = mountAtRoute(url, '/acme/subjects', Subjects, {
    basepath: '/console',
    providers: { transport: fake.transport, queryClient: createReadCache() },
  });
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

it('stops appending at the row budget and says so, while Next still pages on', async () => {
  const user = userEvent.setup();
  const half = ROW_BUDGET / 2;
  const rows = (from: number) =>
    Array.from({ length: half }, (_, index) => subject(`u${String(from + index)}`));
  const pages: Record<string, unknown> = {
    '': { items: rows(0), next: CURSOR },
    [CURSOR]: { items: rows(half), next: LATER },
    [LATER]: { items: [subject('last')] },
  };
  const { asked } = mount('/console/acme/subjects', {
    [LIST]: (request) => json(pages[request.search.get('cursor') ?? ''])(request),
    [COUNT]: json({ count: 3000, capped: false }),
  });
  await screen.findByText('u0');
  expect(screen.getByText('load limit false')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  expect(await screen.findByText('load limit true')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  expect(asked(LIST)).toEqual(['', `cursor=${CURSOR}`]);
  expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
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

it('says when a further page could not be loaded, keeping the rows it has', async () => {
  const user = userEvent.setup();
  mount('/console/acme/subjects', {
    [LIST]: (request) =>
      request.search.get('cursor') === CURSOR
        ? problem(500, 'about:blank', 'Internal Server Error')(request)
        : json({ items: [subject('ada')], next: CURSOR })(request),
    [COUNT]: json({ count: 2, capped: false }),
  });
  await screen.findByText('ada');
  expect(screen.getByText('more ok')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  expect(await screen.findByText('more failed')).toBeVisible();
  expect(screen.getByText('ada')).toBeVisible();
  expect(screen.getByText('status ready')).toBeVisible();
});

it('says it is loading until the first page answers', async () => {
  mount('/console/acme/subjects', { [LIST]: pending(), [COUNT]: pending() });
  expect(await screen.findByText('status loading')).toBeVisible();
  expect(screen.getByText('count none')).toBeVisible();
});

it('does not ask for the next page again while one is on its way', async () => {
  const user = userEvent.setup();
  const { asked } = mount('/console/acme/subjects', {
    [LIST]: (request) =>
      request.search.get('cursor') === CURSOR
        ? pending()(request)
        : json({ items: [subject('ada')], next: CURSOR })(request),
    [COUNT]: json({ count: 2, capped: false }),
  });
  await screen.findByText('ada');
  const more = screen.getByRole('button', { name: 'Load more' });
  await user.click(more);
  await user.click(more);
  await waitFor(() => {
    expect(asked(LIST)).toEqual(['', `cursor=${CURSOR}`]);
  });
});

function Defaulted() {
  const list = useResourceList({
    tenant: 'acme',
    resource: 'subjects',
    filters: ['enabled'],
    defaults: { enabled: 'true' },
    read: readSubjects,
  });
  return <p>{`narrowed ${String(list.narrowed)} rows ${String(list.rows.length)}`}</p>;
}

it('reads a filter the address does not set as its default, without calling that narrowing', async () => {
  const fake = fakeTransport({ [LIST]: json({ items: [subject('ada')] }) });
  mountAtRoute('/console/acme/subjects', '/acme/subjects', Defaulted, {
    basepath: '/console',
    providers: { transport: fake.transport, queryClient: createReadCache() },
  });
  expect(await screen.findByText('narrowed false rows 1')).toBeVisible();
  expect(fake.sent.map((request) => request.search.toString())).toEqual(['enabled=true']);
});

it('lets the address override a default', async () => {
  const fake = fakeTransport({ [LIST]: json({ items: [subject('ada')] }) });
  mountAtRoute('/console/acme/subjects?enabled=false', '/acme/subjects', Defaulted, {
    basepath: '/console',
    providers: { transport: fake.transport, queryClient: createReadCache() },
  });
  expect(await screen.findByText('narrowed true rows 1')).toBeVisible();
  expect(fake.sent.map((request) => request.search.toString())).toEqual(['enabled=false']);
});
