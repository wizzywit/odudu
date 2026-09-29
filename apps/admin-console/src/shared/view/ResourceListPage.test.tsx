import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { ResourceListState } from '#/shared/service/resourceList.ts';
import { Button } from '#/shared/view/Button.tsx';
import type { Column } from '#/shared/view/DataTable.tsx';
import { ResourceListPage } from '#/shared/view/ResourceListPage.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

interface Row {
  readonly id: string;
  readonly name: string;
}

const COLUMNS: readonly Column<Row>[] = [
  { id: 'name', header: 'Name', cell: (row) => row.name, isRowHeader: true },
];

function state(overrides: Partial<ResourceListState<Row>> = {}): ResourceListState<Row> {
  return {
    status: 'ready',
    rows: [
      { id: 'c1', name: 'Billing portal' },
      { id: 'c2', name: 'Acme mobile app' },
    ],
    count: { count: 2, capped: false },
    search: null,
    filters: {},
    narrowed: false,
    trail: [],
    next: 'b2Zmc2V0LTE.dGFnMQ',
    loadingMore: false,
    loadMoreFailed: false,
    setSearch: vi.fn(),
    setFilter: vi.fn(),
    clear: vi.fn(),
    setTrail: vi.fn(),
    loadMore: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  };
}

function page(list: ResourceListState<Row>, onRowAction = vi.fn()) {
  return (
    <ResourceListPage
      list={list}
      kicker="acme"
      title="Clients"
      noun={{ one: 'client', other: 'clients' }}
      searchFields={[
        { id: 'name', label: 'name' },
        { id: 'client_id', label: 'client id' },
      ]}
      columns={COLUMNS}
      rowKey={(row) => row.id}
      onRowAction={onRowAction}
      capability="manage-clients"
      actions={<Button variant="primary">Create client</Button>}
      nothingYet="A client is an application people sign in to."
    />
  );
}

it('shows the rows with their count, and pages through them', async () => {
  const user = userEvent.setup();
  const list = state();
  const onRowAction = vi.fn();
  render(page(list, onRowAction));
  expect(screen.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible();
  expect(screen.getByText('2 clients')).toBeVisible();
  const table = screen.getByRole('grid', { name: 'Clients' });
  expect(within(table).getAllByRole('row')).toHaveLength(3);
  await user.click(screen.getByRole('button', { name: 'Next page' }));
  expect(list.setTrail).toHaveBeenCalledWith(['b2Zmc2V0LTE.dGFnMQ']);
  await user.click(screen.getByRole('button', { name: 'Load more clients' }));
  expect(list.loadMore).toHaveBeenCalledOnce();
  await user.click(within(table).getByText('Billing portal'));
  expect(onRowAction).toHaveBeenCalledWith('c1');
});

it('searches the field the person chose', async () => {
  const user = userEvent.setup();
  const list = state();
  render(page(list));
  await user.type(screen.getByRole('searchbox', { name: 'Search by name' }), 'bil{Enter}');
  expect(list.setSearch).toHaveBeenCalledWith({ field: 'name', query: 'bil' });
});

it('tells nothing yet apart from nothing matching', async () => {
  const user = userEvent.setup();
  const { rerender } = render(
    page(state({ rows: [], next: null, count: { count: 0, capped: false } })),
  );
  expect(screen.getByRole('heading', { name: 'No clients yet' })).toBeVisible();
  expect(screen.getByText('A client is an application people sign in to.')).toBeVisible();
  expect(screen.queryByRole('grid')).toBeNull();

  const narrowed = state({
    rows: [],
    next: null,
    search: { field: 'name', query: 'zz' },
    narrowed: true,
  });
  rerender(page(narrowed));
  expect(screen.getByRole('heading', { name: 'No clients match “zz”' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Show every client' }));
  expect(narrowed.clear).toHaveBeenCalledOnce();
});

it('says a list failed to load and offers to try again', async () => {
  const user = userEvent.setup();
  const list = state({ status: 'failed', rows: [], count: null });
  render(page(list));
  expect(screen.getByRole('alert')).toHaveTextContent('Clients could not be loaded');
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(list.retry).toHaveBeenCalledOnce();
});

it('names the capability a refused read needed', () => {
  render(page(state({ status: 'refused', rows: [], count: null })));
  expect(screen.getByRole('note')).toHaveTextContent(
    'Clients needs the manage-clients capability.',
  );
  expect(screen.queryByRole('search')).toBeNull();
});

it('says it is loading while the first page is on its way', () => {
  render(page(state({ status: 'loading', rows: [], count: null })));
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('Loading clients');
  const shape = status.querySelector('[data-shape="table"]');
  expect([...(shape?.querySelectorAll('th') ?? [])].map((th) => th.textContent)).toEqual(
    COLUMNS.map((column) => column.header),
  );
});

it('says a further page failed beside the pager, keeping the rows', () => {
  render(page(state({ loadMoreFailed: true })));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'More clients could not be loaded. Load more tries again.',
  );
  expect(screen.getByRole('grid', { name: 'Clients' })).toBeVisible();
});

it('passes axe in both themes, with rows and with none', async () => {
  expect(await axeInBothThemes(() => page(state()))).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(() => page(state({ rows: [], next: null, narrowed: true }))),
  ).toEqual({ light: [], dark: [] });
  expect(await axeInBothThemes(() => page(state({ status: 'failed', rows: [] })))).toEqual({
    light: [],
    dark: [],
  });
});

it('says what happened to a row just above the rows, from a notice the page gives it', () => {
  render(
    <ResourceListPage
      list={state()}
      title="Clients"
      noun={{ one: 'client', other: 'clients' }}
      columns={COLUMNS}
      rowKey={(row) => row.id}
      capability="manage-clients"
      notice={<p role="status">Billing portal still holds a secret.</p>}
    />,
  );
  const notice = screen.getByRole('status');
  const grid = screen.getByRole('grid', { name: 'Clients' });
  expect(notice).toHaveTextContent('Billing portal still holds a secret.');
  expect(notice.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
