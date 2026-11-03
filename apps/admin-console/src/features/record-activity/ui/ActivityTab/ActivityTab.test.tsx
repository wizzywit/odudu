import type { AuditEvent } from '#/entities/audit-event';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { ResourceListState } from '#/shared/services/resourceList';
import { ActivityTab } from '#/features/record-activity/ui/ActivityTab/ActivityTab';
import { activityWords } from '#/features/record-activity/services/activityWords';
import { auditEvent } from '#/testing/auditFixtures';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

const NOW = new Date('2026-09-28T14:03:22Z');

const EVENT = auditEvent();

function state(overrides: Partial<ResourceListState<AuditEvent>> = {}) {
  const list: ResourceListState<AuditEvent> = {
    status: 'ready',
    rows: [
      EVENT,
      {
        ...EVENT,
        id: 'a2',
        outcome: 'refused',
        request_id: null,
        actor_subject_id: null,
        actor_origin: null,
      },
    ],
    count: null,
    search: null,
    filters: {},
    narrowed: false,
    trail: [],
    next: null,
    loadingMore: false,
    loadLimited: false,
    loadMoreFailed: false,
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
  render(<ActivityTab list={state()} words={activityWords('client')} now={NOW} />);
  const table = screen.getByRole('grid', { name: 'Activity on this client' });
  const rows = within(table).getAllByRole('row').slice(1);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent('client.update');
  expect(rows[0]).toHaveTextContent('allowed');
  expect(rows[1]).toHaveTextContent('refused');
  expect(rows[1]).toHaveTextContent('none sent');
});

it("names each row's actor, and marks a caller from elsewhere", () => {
  const rows = [
    { ...EVENT, actor_name: 'grace' },
    { ...EVENT, id: 'a3', actor_origin: 'system' as const },
  ];
  render(<ActivityTab list={state({ rows })} words={activityWords('client')} now={NOW} />);
  const table = screen.getByRole('grid', { name: 'Activity on this client' });
  const [named, system] = within(table).getAllByRole('row').slice(1);
  expect(within(named ?? table).getByText('grace')).toHaveAttribute(
    'title',
    EVENT.actor_subject_id,
  );
  expect(system).toHaveTextContent('a system administrator');
  expect(system).toHaveTextContent('from elsewhere');
});

it('labels the request id a correlation, not evidence', () => {
  render(<ActivityTab list={state()} words={activityWords('client')} now={NOW} />);
  expect(screen.getByRole('columnheader', { name: 'Correlation id' })).toBeVisible();
  expect(
    screen.getByText(
      /links rows written for one request. The caller can set it, so it is a correlation, not evidence/u,
    ),
  ).toBeVisible();
});

it('draws the trail it will fill while it loads', () => {
  render(
    <ActivityTab
      list={state({ status: 'loading', rows: [] })}
      words={activityWords('client')}
      now={NOW}
    />,
  );
  const shape = screen.getByRole('status').querySelector('[data-shape="table"]');
  expect(shape).toHaveTextContent('Correlation id');
});

it('names view-audit when the trail is refused', () => {
  render(
    <ActivityTab
      list={state({ status: 'refused', rows: [] })}
      words={activityWords('client')}
      now={NOW}
    />,
  );
  expect(screen.getByRole('note')).toHaveTextContent('Activity needs the view-audit capability.');
});

it('says when nothing has happened to the record yet', () => {
  render(<ActivityTab list={state({ rows: [] })} words={activityWords('client')} now={NOW} />);
  expect(screen.getByRole('heading', { name: 'No activity on this client yet' })).toBeVisible();
});

it('pages on through older rows', async () => {
  const user = userEvent.setup();
  const list = state({ next: 'b2Zmc2V0LTE.dGFnMQ' });
  render(<ActivityTab list={list} words={activityWords('client')} now={NOW} />);
  await user.click(screen.getByRole('button', { name: 'Load more activity' }));
  expect(list.loadMore).toHaveBeenCalledOnce();
});

it('says a further page of activity failed', () => {
  render(
    <ActivityTab
      list={state({ loadMoreFailed: true })}
      words={activityWords('client')}
      now={NOW}
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'More activity could not be loaded. Load more tries again.',
  );
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => (
      <ActivityTab
        list={state({ next: 'b2Zmc2V0LTE.dGFnMQ' })}
        words={activityWords('client')}
        now={NOW}
      />
    )),
  ).toEqual({ light: [], dark: [] });
});
