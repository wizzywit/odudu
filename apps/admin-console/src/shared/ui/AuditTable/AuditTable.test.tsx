import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { auditColumns, auditSummaryColumns, AuditTable } from '#/shared/ui/AuditTable/AuditTable';
import { auditEvent } from '#/testing/auditFixtures';
import { at } from '#/testing/at';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

const NOW = new Date('2026-09-28T14:03:22Z');

const ROWS = [
  auditEvent({ id: 'a1', request_id: 'req-aaaaaa', action: 'client.update' }),
  auditEvent({ id: 'a2', request_id: 'req-aaaaaa', action: 'client.amend', outcome: 'refused' }),
  auditEvent({ id: 'a3', request_id: 'req-bbbbbb', action: 'role.create' }),
  auditEvent({ id: 'a4', request_id: null, action: 'scope.delete' }),
];

function table(): HTMLElement {
  return screen.getByRole('grid', { name: 'Audit events' });
}

function rows(): HTMLElement[] {
  return within(table()).getAllByRole('row').slice(1);
}

it('lists the rows as given, newest first', () => {
  render(<AuditTable label="Audit events" rows={ROWS} now={NOW} />);
  expect(rows().map((row) => row.querySelector('code')?.textContent)).toEqual([
    'client.update',
    'client.amend',
    'role.create',
    'scope.delete',
  ]);
  expect(screen.getByRole('columnheader', { name: 'Correlation id' })).toBeVisible();
  expect(screen.queryByRole('columnheader', { name: 'Resource' })).toBeNull();
});

it('labels rows that share a request as one request, and counts only those loaded', () => {
  render(<AuditTable label="Audit events" rows={ROWS} now={NOW} />);
  const [first, second, third, fourth] = rows();
  expect(first).toHaveTextContent('request aaaaaa · 2 rows loaded');
  expect(second).toHaveTextContent('request aaaaaa · 2 rows loaded');
  expect(third).not.toHaveTextContent('rows loaded');
  expect(fourth).toHaveTextContent('none sent');
});

it('shows the resource with a link where there is a record to open', () => {
  render(
    <AuditTable
      label="Audit events"
      rows={ROWS.slice(0, 1)}
      now={NOW}
      withResource
      hrefs={{ resource: () => '/console/acme/clients/c1', actor: () => null }}
    />,
  );
  expect(screen.getByRole('columnheader', { name: 'Resource' })).toBeVisible();
  expect(screen.getByRole('link', { name: /c1.*client c1/u })).toHaveAttribute(
    'href',
    '/console/acme/clients/c1',
  );
});

it('opens every field of a row, and hands focus back to it when closed', async () => {
  const user = userEvent.setup();
  render(<AuditTable label="Audit events" rows={ROWS} now={NOW} />);
  const open = within(at(rows(), 1)).getByRole('button', {
    name: 'Details of client.amend',
  });
  await user.click(open);
  const dialog = await screen.findByRole('dialog', { name: 'Audit event' });
  expect(within(dialog).getByText('Event id', { selector: 'dt' })).toBeVisible();
  expect(dialog).toHaveTextContent('client.amend');
  await user.click(within(dialog).getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() => {
    expect(open).toHaveFocus();
  });
});

it('closes the detail with Escape', async () => {
  const user = userEvent.setup();
  render(<AuditTable label="Audit events" rows={ROWS} now={NOW} />);
  await user.click(at(screen.getAllByRole('button', { name: /^Details of/u }), 0));
  await screen.findByRole('dialog');
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('marks a caller from elsewhere and explains the mark once, below the rows', () => {
  render(
    <AuditTable
      label="Audit events"
      rows={[auditEvent({ actor_origin: 'system', actor_name: null })]}
      now={NOW}
    />,
  );
  expect(within(table()).getByText('from elsewhere')).toBeVisible();
  expect(screen.getByText(/cannot name them/u)).toBeVisible();
});

it('does not explain a mark that no row carries', () => {
  render(<AuditTable label="Audit events" rows={ROWS} now={NOW} />);
  expect(screen.queryByText(/cannot name them/u)).toBeNull();
});

it('passes axe in both themes, closed and with a detail open', async () => {
  const closed = await axeInBothThemes(() => (
    <AuditTable label="Audit events" rows={ROWS} now={NOW} withResource />
  ));
  expect(closed).toEqual({ light: [], dark: [] });
  const user = userEvent.setup();
  const open = await axeInBothThemes(
    () => <AuditTable label="Audit events" rows={ROWS} now={NOW} withResource />,
    async () => {
      await user.click(at(screen.getAllByRole('button', { name: /^Details of/u }), 0));
      await screen.findByRole('dialog', { name: 'Audit event' });
    },
  );
  expect(open).toEqual({ light: [], dark: [] });
});

it('draws the overview summary as the first four cells of the trail, the actor kept secondary', () => {
  const summary = auditSummaryColumns({ now: NOW });
  const trail = auditColumns({ now: NOW });
  expect(summary.map((column) => column.id)).toEqual(['when', 'action', 'outcome', 'actor']);
  expect(trail.slice(0, 4).map((column) => [column.id, column.header])).toEqual(
    summary.map((column) => [column.id, column.header]),
  );
  expect(summary.map((column) => column.secondary === true)).toEqual([false, false, false, true]);
  expect(trail.some((column) => column.secondary === true)).toBe(false);
});
