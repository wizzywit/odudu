import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { AppShell } from '#/shared/view/AppShell.tsx';
import { ContextBar } from '#/shared/view/ContextBar.tsx';
import { Rail } from '#/shared/view/Rail.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

const rail = <Rail label="acme" groups={[{ items: [{ href: '#overview', label: 'Overview' }] }]} />;

function shell() {
  return (
    <AppShell rail={rail} contextBar={<ContextBar tenant="acme" />}>
      <h1>Overview</h1>
    </AppShell>
  );
}

it('lays out the rail, the context bar and the main content', () => {
  render(shell());
  expect(screen.getByRole('navigation', { name: 'acme' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'System authority' })).toBeInTheDocument();
  expect(within(screen.getByRole('main')).getByRole('heading', { name: 'Overview' })).toBeVisible();
});

it('skips straight to the main content', async () => {
  const user = userEvent.setup();
  render(shell());
  await user.tab();
  const skip = screen.getByRole('link', { name: 'Skip to content' });
  expect(skip).toHaveFocus();
  expect(skip).toHaveAttribute('href', '#main');
  expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
});

it('opens the rail as a sheet from the menu, and returns focus when it closes', async () => {
  const user = userEvent.setup();
  render(shell());
  const menu = screen.getByRole('button', { name: 'Menu' });
  await user.click(menu);
  const sheet = screen.getByRole('dialog', { name: 'Navigation' });
  expect(within(sheet).getByRole('link', { name: 'Overview' })).toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await waitFor(() => {
    expect(menu).toHaveFocus();
  });
});

it('closes the sheet once a destination is chosen', async () => {
  const user = userEvent.setup();
  render(shell());
  await user.click(screen.getByRole('button', { name: 'Menu' }));
  const sheet = screen.getByRole('dialog', { name: 'Navigation' });
  await user.click(within(sheet).getByRole('link', { name: 'Overview' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(shell)).toEqual({ light: [], dark: [] });
});

it('puts the narrow top bar in a banner, so none of the shell sits outside a landmark', () => {
  render(shell());
  const banner = screen.getByRole('banner');
  expect(within(banner).getByText('Odudu')).toBeInTheDocument();
  expect(within(banner).getByRole('button', { name: 'Menu' })).toBeInTheDocument();
});
