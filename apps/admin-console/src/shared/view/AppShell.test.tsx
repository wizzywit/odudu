import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
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

function Collapsible({ initially = false }: { readonly initially?: boolean }) {
  const [collapsed, setCollapsed] = useState(initially);
  return (
    <AppShell
      rail={rail}
      contextBar={<ContextBar tenant="acme" />}
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
    >
      <h1>Overview</h1>
      <label>
        Search
        <input />
      </label>
    </AppShell>
  );
}

describe('collapsing the rail for full width', () => {
  it('offers a labelled control at the rail foot, with its shortcut shown beside it', () => {
    render(<Collapsible />);
    const collapse = screen.getByRole('button', { name: 'Collapse menu' });
    expect(collapse).toHaveAttribute('aria-keyshortcuts', '[');
    expect(collapse.parentElement).toHaveTextContent('[');
    expect(screen.getByRole('region', { name: 'Menu' })).toContainElement(collapse);
    expect(screen.queryByRole('button', { name: 'Expand menu' })).toBeNull();
  });

  it('hides the rail entirely and gives the page the top bar, context bar kept', async () => {
    const user = userEvent.setup();
    render(<Collapsible />);
    await user.click(screen.getByRole('button', { name: 'Collapse menu' }));

    expect(screen.queryByRole('navigation', { name: 'acme' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Collapse menu' })).toBeNull();
    const banner = screen.getByRole('banner');
    const expand = within(banner).getByRole('button', { name: 'Expand menu' });
    expect(expand).toHaveAttribute('aria-keyshortcuts', '[');
    expect(expand).toHaveFocus();
    expect(screen.getByRole('region', { name: 'System authority' })).toBeInTheDocument();

    await user.click(within(banner).getByRole('button', { name: 'Menu' }));
    const sheet = screen.getByRole('dialog', { name: 'Navigation' });
    expect(within(sheet).getByRole('navigation', { name: 'acme' })).toBeInTheDocument();
  });

  it('restores the rail from the top bar', async () => {
    const user = userEvent.setup();
    render(<Collapsible initially />);
    await user.click(screen.getByRole('button', { name: 'Expand menu' }));
    expect(screen.getByRole('navigation', { name: 'acme' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse menu' })).toHaveFocus();
  });

  it('toggles on [ from anywhere but a field being typed in', async () => {
    const user = userEvent.setup();
    render(<Collapsible />);
    await user.keyboard('[[');
    expect(screen.getByRole('button', { name: 'Expand menu' })).toBeInTheDocument();
    await user.click(screen.getByRole('textbox', { name: 'Search' }));
    await user.keyboard('[[');
    expect(screen.getByRole('textbox', { name: 'Search' })).toHaveValue('[');
    expect(screen.getByRole('button', { name: 'Expand menu' })).toBeInTheDocument();
    await user.click(screen.getByRole('heading', { name: 'Overview' }));
    await user.keyboard('[[');
    expect(screen.getByRole('button', { name: 'Collapse menu' })).toBeInTheDocument();
  });

  it('offers no collapse where the page does not ask for one', async () => {
    const user = userEvent.setup();
    render(shell());
    expect(screen.queryByRole('button', { name: 'Collapse menu' })).toBeNull();
    await user.keyboard('[[');
    expect(screen.queryByRole('button', { name: 'Expand menu' })).toBeNull();
  });

  it('passes axe in both themes, collapsed', async () => {
    expect(await axeInBothThemes(() => <Collapsible initially />)).toEqual({ light: [], dark: [] });
  });
});
