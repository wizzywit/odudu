import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { DeleteZone } from '#/shared/ui/DeleteZone';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

function deletion(overrides: Partial<Parameters<typeof DeleteZone>[0]['deletion']> = {}) {
  return {
    confirming: false,
    busy: false,
    problem: null,
    ask: vi.fn(),
    cancel: vi.fn(),
    confirm: vi.fn(),
    ...overrides,
  };
}

it('offers the delete, and asks for it through the deletion it is given', async () => {
  const user = userEvent.setup();
  const own = deletion();
  render(<DeleteZone name="billing" deletion={own} consequence="It is gone." />);
  expect(screen.getByRole('region', { name: 'Delete' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Delete billing' }));
  expect(own.ask).toHaveBeenCalled();
});

it('names the button apart from the dialog it opens', () => {
  render(
    <DeleteZone
      name="/eng"
      label="Delete /eng and every group beneath it"
      deletion={deletion()}
      consequence="Everything beneath it goes too."
    />,
  );
  expect(
    screen.getByRole('button', { name: 'Delete /eng and every group beneath it' }),
  ).toBeVisible();
});

it('says what is lost in the dialog, titled for the record', () => {
  render(
    <DeleteZone
      name="/eng"
      deletion={deletion({ confirming: true })}
      consequence="Everything beneath it goes too."
    />,
  );
  const dialog = screen.getByRole('alertdialog', { name: 'Delete /eng?' });
  expect(dialog).toHaveTextContent('Everything beneath it goes too.');
});

it('holds the confirmation until the typed text matches, and shows what the server refused', async () => {
  const user = userEvent.setup();
  const own = deletion({ confirming: true, problem: 'It is still in use.' });
  render(<DeleteZone name="Ledger" typed="ledger" deletion={own} consequence="Gone." />);
  const confirm = screen.getByRole('button', { name: 'Delete Ledger', description: /./u });
  expect(screen.getByText('It is still in use.')).toBeVisible();
  expect(confirm).toBeDisabled();
  await user.type(screen.getByRole('textbox'), 'ledger');
  expect(confirm).toBeEnabled();
  await user.click(confirm);
  expect(own.confirm).toHaveBeenCalled();
});

it('shows the note in place of the button', () => {
  render(
    <DeleteZone
      name="billing"
      deletion={deletion()}
      consequence="Gone."
      lead={<p>Why it matters.</p>}
      note={<p>Checking what it nests…</p>}
    />,
  );
  expect(screen.getByText('Why it matters.')).toBeVisible();
  expect(screen.getByText('Checking what it nests…')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Delete billing' })).toBeNull();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => (
      <main>
        <h1>Role</h1>
        <DeleteZone name="billing" deletion={deletion()} consequence="Gone." lead={<p>Lead.</p>} />
      </main>
    )),
  ).toEqual({ light: [], dark: [] });
});
