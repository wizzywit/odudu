import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { Conflict } from '#/shared/service/conflict.ts';
import { ConflictPanel } from '#/shared/view/ConflictPanel/ConflictPanel.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

const CONFLICTS: readonly Conflict[] = [
  { field: 'name', label: 'Name', theirs: 'Payments', yours: 'Billing', secret: false },
  {
    field: 'redirect_uris',
    label: 'Redirect URIs',
    theirs: ['https://a.example/cb'],
    yours: [],
    secret: false,
  },
  { field: 'password', label: 'Password', theirs: '', yours: 'hunter2', secret: true },
];

function panel(overrides: Partial<Parameters<typeof ConflictPanel>[0]> = {}) {
  return (
    <ConflictPanel
      section="General"
      conflicts={CONFLICTS}
      onKeepMine={vi.fn()}
      onTakeTheirs={vi.fn()}
      {...overrides}
    />
  );
}

it('shows theirs beside yours, field by field', () => {
  render(panel());
  const table = screen.getByRole('table', { name: 'Changed in General since you opened it' });
  const rows = within(table).getAllByRole('row');
  expect(rows.map((row) => row.textContent)).toEqual([
    'FieldTheirs, saved nowYours, not saved',
    'NamePaymentsBilling',
    'Redirect URIshttps://a.example/cbnone',
    'Passwordhiddenhidden',
  ]);
});

it('never shows a secret, not even the one being typed', () => {
  render(panel());
  expect(screen.queryByText('hunter2')).toBeNull();
});

it('offers keeping mine or taking theirs, named for the section', async () => {
  const user = userEvent.setup();
  const onKeepMine = vi.fn();
  const onTakeTheirs = vi.fn();
  render(panel({ onKeepMine, onTakeTheirs }));
  await user.click(screen.getByRole('button', { name: 'Keep mine in General' }));
  await user.click(screen.getByRole('button', { name: 'Take theirs in General' }));
  expect(onKeepMine).toHaveBeenCalledOnce();
  expect(onTakeTheirs).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Keep mine in General' })).toHaveAccessibleDescription(
    'Saves your values over theirs.',
  );
});

it('holds both choices while a save is in flight', () => {
  render(panel({ busy: true }));
  expect(screen.getByRole('button', { name: 'Keep mine in General' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Take theirs in General' })).toBeDisabled();
});

it('renders nothing when nothing conflicts', () => {
  const { container } = render(panel({ conflicts: [] }));
  expect(container).toBeEmptyDOMElement();
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => panel())).toEqual({ light: [], dark: [] });
});

it('reads a value the way its field says to', () => {
  render(
    panel({
      conflicts: [
        {
          field: 'access_token_ttl',
          label: 'Access token lifetime',
          theirs: 900,
          yours: 600,
          secret: false,
          describe: (value) => `${String(value)} s`,
        },
      ],
    }),
  );
  expect(screen.getAllByRole('row')[1]).toHaveTextContent('Access token lifetime900 s600 s');
});

it('does not claim somebody changed fields when kept edits meet a newer record', () => {
  render(panel({ source: 'kept' }));
  expect(screen.getByText(/The record changed after these edits were kept/u)).toBeVisible();
  expect(screen.queryByText(/Somebody else saved/u)).toBeNull();
});
