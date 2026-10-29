import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, it } from 'vitest';
import { PreviewShell } from '#/features/branding/view/PreviewShell';
import { InlineFields, SelectField } from '#/shared/view/Field';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

const SCHEMES = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

function Shell() {
  const [scheme, setScheme] = useState('light');
  return (
    <PreviewShell
      title="Preview"
      summary={`Sign in · ${scheme}`}
      lead="The saved draft, drawn by the real page."
      controls={
        <InlineFields>
          <SelectField
            label="Colour scheme"
            options={SCHEMES}
            value={scheme}
            onChange={setScheme}
          />
        </InlineFields>
      }
      frame={{
        title: 'Preview of the page',
        src: '/preview?scheme=light',
        frameKey: 'k',
        loading: false,
        onLoaded: () => undefined,
      }}
    />
  );
}

it('says what the strip shows and offers to open it', () => {
  render(<Shell />);
  expect(screen.getByText('Sign in · light')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open preview' })).toBeVisible();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('opens a named sheet with the same sandboxed frame and the switches as native selects', async () => {
  const user = userEvent.setup();
  render(<Shell />);
  await user.click(screen.getByRole('button', { name: 'Open preview' }));
  const sheet = await screen.findByRole('dialog', { name: 'Page preview' });
  const frame = within(sheet).getByTitle('Preview of the page, full size');
  expect(frame).toHaveAttribute('sandbox', '');
  expect(frame).toHaveAttribute('src', '/preview?scheme=light');
  await user.selectOptions(within(sheet).getByRole('combobox', { name: 'Colour scheme' }), 'dark');
  expect(screen.getAllByText('Sign in · dark').length).toBeGreaterThan(0);
});

it('keeps the strip’s frame out of the tab order and the sheet’s in it, named apart', async () => {
  const user = userEvent.setup();
  render(<Shell />);
  expect(screen.getByTitle('Preview of the page')).toHaveAttribute('tabindex', '-1');
  await user.click(screen.getByRole('button', { name: 'Open preview' }));
  const sheet = await screen.findByRole('dialog', { name: 'Page preview' });
  expect(within(sheet).getByTitle('Preview of the page, full size')).not.toHaveAttribute(
    'tabindex',
  );
});

it('moves focus into the sheet, keeps it there, and gives it back to Open on Escape', async () => {
  const user = userEvent.setup();
  render(<Shell />);
  const open = screen.getByRole('button', { name: 'Open preview' });
  await user.click(open);
  const sheet = await screen.findByRole('dialog', { name: 'Page preview' });
  await waitFor(() => {
    expect(sheet.contains(document.activeElement)).toBe(true);
  });
  await user.tab({ shift: true });
  await user.tab({ shift: true });
  await user.tab({ shift: true });
  await user.tab({ shift: true });
  expect(sheet.contains(document.activeElement)).toBe(true);
  await user.keyboard('{Escape}');
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  await waitFor(() => {
    expect(open).toHaveFocus();
  });
});

it('closes from its Close button', async () => {
  const user = userEvent.setup();
  render(<Shell />);
  await user.click(screen.getByRole('button', { name: 'Open preview' }));
  const sheet = await screen.findByRole('dialog', { name: 'Page preview' });
  await user.click(within(sheet).getByRole('button', { name: 'Close preview' }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => <Shell />, undefined, { frames: false })).toEqual({
    light: [],
    dark: [],
  });
});
