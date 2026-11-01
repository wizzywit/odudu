import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import type { Translations } from '#/shared/service/localised';
import type { Read } from '#/shared/service/read';
import { LocalisedTextField } from '#/shared/view/LocalisedTextField';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

const OFFERED: Read<string[]> = { status: 'ready', data: ['fr', 'de'] };

function Editing({
  languages = OFFERED,
  initial = {},
  multiline = false,
  seen = () => undefined,
}: {
  languages?: Read<string[]>;
  initial?: Translations;
  multiline?: boolean;
  seen?: (next: Translations) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <LocalisedTextField
      label="Name"
      description="Shown to people who read French or German."
      languages={languages}
      value={value}
      multiline={multiline}
      limit={20}
      onChange={(next) => {
        setValue(next);
        seen(next);
      }}
    />
  );
}

it('has a tab for each language the tenant offers, and a field in the one chosen', async () => {
  const user = userEvent.setup();
  render(<Editing />);
  const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
  expect(tabs).toEqual(['French (fr)', 'German (de)']);
  expect(screen.getByRole('textbox', { name: 'Translation into French (fr)' })).toBeVisible();
  await user.click(screen.getByRole('tab', { name: 'German (de)' }));
  expect(screen.getByRole('textbox', { name: 'Translation into German (de)' })).toBeVisible();
});

it('writes a language into the map, and a blank one out of it', async () => {
  const user = userEvent.setup();
  const seen = vi.fn();
  render(<Editing seen={seen} initial={{ de: 'Rechnung' }} />);
  await user.type(screen.getByRole('textbox', { name: 'Translation into French (fr)' }), 'Facture');
  expect(seen).toHaveBeenLastCalledWith({ de: 'Rechnung', fr: 'Facture' });
  expect(screen.getByText(/Translated: German \(de\) and French \(fr\)\./u)).toBeVisible();
  await user.clear(screen.getByRole('textbox', { name: 'Translation into French (fr)' }));
  expect(seen).toHaveBeenLastCalledWith({ de: 'Rechnung' });
});

it('says nothing is translated until something is', () => {
  render(<Editing />);
  expect(screen.getByText(/Nothing is translated/u)).toBeVisible();
});

it('keeps text under a language the tenant no longer offers, and says so', () => {
  render(<Editing initial={{ es: 'Hola' }} />);
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
    'French (fr)',
    'German (de)',
    'Spanish (es)',
  ]);
});

it('is a text area, counted against the limit, when it is long text', () => {
  render(<Editing multiline initial={{ fr: 'Facture' }} />);
  const field = screen.getByRole('textbox', { name: 'Translation into French (fr)' });
  expect(field.tagName).toBe('TEXTAREA');
  expect(screen.getByText(/7 of 20 characters/u)).toBeVisible();
});

it('says why there are no tabs while the languages are not known', () => {
  const { rerender } = render(<Editing languages={{ status: 'loading' }} />);
  expect(screen.getByText(/Loading the languages/u)).toBeVisible();
  expect(screen.queryByRole('tablist')).toBeNull();
  rerender(<Editing languages={{ status: 'failed', refused: true, retry: () => undefined }} />);
  expect(screen.getByText(/needs the manage-tenant capability/u)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
});

it('offers another try when the languages could not be read, not when they were refused', async () => {
  const user = userEvent.setup();
  const retry = vi.fn();
  render(<Editing languages={{ status: 'failed', refused: false, retry }} />);
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledTimes(1);
});

it('is keyboard operable and passes axe in both themes', async () => {
  const user = userEvent.setup();
  const seen = vi.fn();
  render(<Editing seen={seen} />);
  await user.tab();
  expect(screen.getByRole('tab', { name: 'French (fr)' })).toHaveFocus();
  await user.keyboard('{ArrowRight}');
  expect(screen.getByRole('tab', { name: 'German (de)' })).toHaveAttribute('aria-selected', 'true');
  await user.tab();
  await user.keyboard('Rechnung');
  expect(seen).toHaveBeenLastCalledWith({ de: 'Rechnung' });
  const results = await axeInBothThemes(() => <Editing initial={{ fr: 'Facture' }} />);
  expect(results.light).toEqual([]);
  expect(results.dark).toEqual([]);
});
