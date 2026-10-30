import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { PreviewShell } from '#/features/branding/view/PreviewShell';
import { InlineFields, SelectField } from '#/shared/view/Field';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { stubContainerWidth } from '#/testing/narrowContainer';

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

describe('where the panel has the width', () => {
  stubContainerWidth(1000);

  it('leaves the preview frame in the tab order, so a keyboard can scroll it', () => {
    render(
      <div data-narrow-container>
        <Shell />
      </div>,
    );
    expect(screen.getByTitle('Preview of the page')).not.toHaveAttribute('tabindex');
  });
});

describe('where the editor is stacked and the preview is a strip', () => {
  const container = stubContainerWidth(400);

  it('puts the sheet away when the screen is widened under it', async () => {
    const user = userEvent.setup();
    render(
      <div data-narrow-container>
        <Shell />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Open preview' }));
    await screen.findByRole('dialog', { name: 'Page preview' });
    container.set(1000);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    container.set(400);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the miniature out of the tab order, and the sheet’s frame in it, named apart', async () => {
    const user = userEvent.setup();
    render(
      <div data-narrow-container>
        <Shell />
      </div>,
    );
    expect(screen.getByTitle('Preview of the page')).toHaveAttribute('tabindex', '-1');
    await user.click(screen.getByRole('button', { name: 'Open preview' }));
    const sheet = await screen.findByRole('dialog', { name: 'Page preview' });
    expect(within(sheet).getByTitle('Preview of the page, full size')).not.toHaveAttribute(
      'tabindex',
    );
  });

  it('does not load the miniature while the sheet shows the page, and does again after', async () => {
    const user = userEvent.setup();
    render(
      <div data-narrow-container>
        <Shell />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Open preview' }));
    await screen.findByRole('dialog', { name: 'Page preview' });
    expect(screen.queryByTitle('Preview of the page')).toBeNull();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.getByTitle('Preview of the page')).toBeInTheDocument();
    });
  });
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
