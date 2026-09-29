import type { AuditEvent } from '@odudu/contracts/admin';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { ResourceListState } from '#/shared/service/resourceList.ts';
import { ActivityTab } from '#/shared/view/ActivityTab.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

const NOW = new Date('2026-09-28T14:03:22Z');

const EVENT: AuditEvent = {
  id: 'a1',
  occurred_at: '2026-09-28T13:41:05Z',
  event_type: 'admin_mutation',
  action: 'client.update',
  outcome: 'allowed',
  actor_tenant_id: 't1',
  actor_subject_id: '0192f7a4-5c1e-7b3a-9d2e-6f8a1b2c3d4e',
  actor_client_id: null,
  resource_type: 'client',
  resource_id: 'c1',
  request_id: 'req-7f3a9c',
  ip: '203.0.113.9',
  detail: {},
};

function state(overrides: Partial<ResourceListState<AuditEvent>> = {}) {
  const list: ResourceListState<AuditEvent> = {
    status: 'ready',
    rows: [
      EVENT,
      { ...EVENT, id: 'a2', outcome: 'refused', request_id: null, actor_subject_id: null },
    ],
    count: null,
    search: null,
    filters: {},
    narrowed: false,
    trail: [],
    next: null,
    loadingMore: false,
    setSearch: vi.fn(),
    setFilter: vi.fn(),
    clear: vi.fn(),
    setTrail: vi.fn(),
    loadMore: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  };
  return list;
}

it("lists the record's audit rows, newest first as the API sends them", () => {
  render(<ActivityTab list={state()} noun="client" now={NOW} />);
  const table = screen.getByRole('grid', { name: 'Activity on this client' });
  const rows = within(table).getAllByRole('row').slice(1);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent('client.update');
  expect(rows[0]).toHaveTextContent('allowed');
  expect(rows[1]).toHaveTextContent('refused');
  expect(rows[1]).toHaveTextContent('none sent');
});

it('labels the request id a correlation, not evidence', () => {
  render(<ActivityTab list={state()} noun="client" now={NOW} />);
  expect(screen.getByRole('columnheader', { name: 'Correlation id' })).toBeVisible();
  expect(
    screen.getByText(
      /links rows written for one request. The caller can set it, so it is a correlation, not evidence/u,
    ),
  ).toBeVisible();
});

it('names view-audit when the trail is refused', () => {
  render(<ActivityTab list={state({ status: 'refused', rows: [] })} noun="client" now={NOW} />);
  expect(screen.getByRole('note')).toHaveTextContent('Activity needs the view-audit capability.');
});

it('says when nothing has happened to the record yet', () => {
  render(<ActivityTab list={state({ rows: [] })} noun="client" now={NOW} />);
  expect(screen.getByRole('heading', { name: 'No activity on this client yet' })).toBeVisible();
});

it('pages on through older rows', async () => {
  const user = userEvent.setup();
  const list = state({ next: 'b2Zmc2V0LTE.dGFnMQ' });
  render(<ActivityTab list={list} noun="client" now={NOW} />);
  await user.click(screen.getByRole('button', { name: 'Load more activity' }));
  expect(list.loadMore).toHaveBeenCalledOnce();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => (
      <ActivityTab list={state({ next: 'b2Zmc2V0LTE.dGFnMQ' })} noun="client" now={NOW} />
    )),
  ).toEqual({ light: [], dark: [] });
});
