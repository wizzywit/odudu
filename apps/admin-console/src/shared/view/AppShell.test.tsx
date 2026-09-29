import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { AppShell } from '#/shared/view/AppShell.tsx';
import { ContextBar } from '#/shared/view/ContextBar.tsx';
import { Rail } from '#/shared/view/Rail.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import shellCss from '#/shared/view/AppShell.module.css?raw';

const rail = <Rail label="acme" groups={[{ items: [{ href: '#overview', label: 'Overview' }] }]} />;

function shell() {
  return (
    <AppShell
      rail={rail}
      contextBar={<ContextBar tenant="acme" backHref="/console/system/tenants/acme" />}
    >
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

it('closes the sheet on an action in the rail, so no dialog opens over it', async () => {
  const user = userEvent.setup();
  render(
    <AppShell
      rail={
        <Rail
          label="acme"
          groups={[{ items: [{ href: '#overview', label: 'Overview' }] }]}
          footer={<button type="button">Sign out</button>}
        />
      }
    >
      <h1>Overview</h1>
    </AppShell>,
  );
  await user.click(screen.getByRole('button', { name: 'Menu' }));
  const sheet = screen.getByRole('dialog', { name: 'Navigation' });
  await user.click(within(sheet).getByRole('button', { name: 'Sign out' }));
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

function Collapsible({
  initially = false,
  paused = false,
}: {
  initially?: boolean;
  paused?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(initially);
  return (
    <AppShell
      rail={rail}
      shortcutsPaused={paused}
      contextBar={<ContextBar tenant="acme" backHref="/console/system/tenants/acme" />}
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

  it('moves focus from inside the rail to Expand menu as the rail goes', async () => {
    const user = userEvent.setup();
    render(<Collapsible />);
    screen.getByRole('link', { name: 'Overview' }).focus();
    await user.keyboard('[[');
    expect(screen.getByRole('button', { name: 'Expand menu' })).toHaveFocus();
  });

  it('ignores the shortcut while its own menu sheet is open', async () => {
    const user = userEvent.setup();
    render(<Collapsible />);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    fireEvent.keyDown(document.body, { key: '[' });
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Collapse menu' })).toBeInTheDocument();
  });

  it('ignores the shortcut while a dialog is open', async () => {
    const user = userEvent.setup();
    render(<Collapsible paused />);
    await user.keyboard('[[');
    expect(screen.getByRole('button', { name: 'Collapse menu' })).toBeInTheDocument();
  });

  it.each([
    ['AltGr, which reports Control with Alt', { ctrlKey: true, altKey: true }, true],
    ['Option alone', { altKey: true }, true],
    ['Control alone', { ctrlKey: true }, false],
    ['Command', { metaKey: true }, false],
  ])(
    'decides by the modifiers whether [ typed with %s is the shortcut',
    (_, modifiers, toggles) => {
      render(<Collapsible />);
      fireEvent.keyDown(document.body, { key: '[', ...modifiers });
      expect(screen.queryByRole('button', { name: 'Expand menu' }) !== null).toBe(toggles);
    },
  );

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

it('fills the width beside the rail, and centres the page only past its cap', () => {
  const source = shellCss.replace(/\/\*[\s\S]*?\*\//gu, '');
  const main = /(?:^|\n)\.main\s*\{([^}]*)\}/u.exec(source)?.[1] ?? '';
  expect(main).toMatch(/inline-size:\s*100%/u);
  expect(main).toMatch(/max-inline-size:\s*1600px/u);
  expect(main).toMatch(/margin-inline:\s*auto/u);
  expect(source).not.toMatch(/max-inline-size:\s*1200px/u);
});
