import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import rawCss from '#/shared/view/DataTable.module.css?raw';
import { DataTable, type Column } from '#/shared/view/DataTable.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

interface Client {
  readonly id: string;
  readonly name: string;
  readonly type: string;
}

const CLIENTS: readonly Client[] = [
  { id: 'c-1', name: 'Billing portal', type: 'confidential' },
  { id: 'c-2', name: 'Mobile app', type: 'public' },
];

const COLUMNS: readonly Column<Client>[] = [
  { id: 'name', header: 'Name', cell: (c) => c.name, isRowHeader: true },
  { id: 'type', header: 'Type', cell: (c) => c.type },
  { id: 'id', header: 'Client id', cell: (c) => c.id, secondary: true },
];

it('is a labelled table with a header row and one row per record', () => {
  render(<DataTable label="Clients" columns={COLUMNS} rows={CLIENTS} rowKey={(c) => c.id} />);
  const table = screen.getByRole('grid', { name: 'Clients' });
  const headers = within(table).getAllByRole('columnheader');
  expect(headers.map((h) => h.textContent)).toEqual(['Name', 'Type', 'Client id']);
  expect(within(table).getByRole('rowheader', { name: /Billing portal/u })).toBeInTheDocument();
  expect(within(table).getAllByRole('row')).toHaveLength(3);
});

it('labels each cell with its column for the stacked layout, out of the reading order', () => {
  render(<DataTable label="Clients" columns={COLUMNS} rows={CLIENTS} rowKey={(c) => c.id} />);
  const cell = screen.getByRole('gridcell', { name: 'confidential' });
  const label = within(cell).getByText('Type');
  expect(label).toHaveAttribute('aria-hidden', 'true');
});

it('opens a record from its row by pointer and by keyboard', async () => {
  const user = userEvent.setup();
  const onOpen = vi.fn();
  render(
    <DataTable
      label="Clients"
      columns={COLUMNS}
      rows={CLIENTS}
      rowKey={(c) => c.id}
      onRowAction={onOpen}
    />,
  );
  await user.click(screen.getByRole('rowheader', { name: /Mobile app/u }));
  expect(onOpen).toHaveBeenLastCalledWith('c-2');
  await user.keyboard('{ArrowUp}{Enter}');
  expect(onOpen).toHaveBeenLastCalledWith('c-1');
});

it('shows what it is given when there are no rows', () => {
  render(
    <DataTable
      label="Clients"
      columns={COLUMNS}
      rows={[]}
      rowKey={(c) => c.id}
      empty={<p>No clients yet</p>}
    />,
  );
  expect(screen.getByText('No clients yet')).toBeInTheDocument();
});

it('stacks its rows below 640 px and drops secondary columns below 720 px, by its own width', () => {
  const css = rawCss;
  expect(css).toMatch(/container:\s*data-table\s*\/\s*inline-size/u);
  expect(css).toMatch(/@container data-table \(width < 640px\)/u);
  expect(css).toMatch(/@container data-table \(width < 720px\)/u);
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => (
      <DataTable
        label="Clients"
        columns={COLUMNS}
        rows={CLIENTS}
        rowKey={(c) => c.id}
        onRowAction={vi.fn()}
      />
    )),
  ).toEqual({ light: [], dark: [] });
});
