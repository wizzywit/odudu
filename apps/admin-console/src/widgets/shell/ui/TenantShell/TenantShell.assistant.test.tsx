import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { json, offline, pending, problem, type Answer } from '#/testing/fakeTransport';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, GRACE, renderConsoleAt, ROOT, whoami } from '#/testing/renderConsole';
import { ACME_ADMIN } from '#/testing/tenantPaths';

afterEach(() => {
  resetConsole();
  vi.unstubAllGlobals();
});

const STATUS = `${ACME_ADMIN}/assistant/status`;
const ON = {
  enabled: true,
  slots: { fast: 'model-f', standard: 'model-s', deep: 'model-d' },
  modes: ['ask'],
  defaultMode: 'ask',
  modelChoices: ['model-s'],
  provider: { kind: 'anthropic' },
};

function routes(who: Answer, status?: Answer): Record<string, Answer> {
  return {
    'GET /console/api/session': json(GRACE),
    [`GET ${ACME_ADMIN}/whoami`]: who,
    ...(status === undefined ? {} : { [`GET ${STATUS}`]: status }),
  };
}

const OPEN = whoami(['use-assistant'], false, true);

async function shellReady() {
  await screen.findByRole('navigation', { name: 'Areas of acme' });
}

async function assistantButton(): Promise<HTMLElement> {
  const [first] = await screen.findAllByRole('button', { name: 'Ask the assistant' });
  if (first === undefined) throw new Error('no assistant button');
  return first;
}

function assistantCalls(paths: readonly { path: string }[]): string[] {
  return paths.map((call) => call.path).filter((path) => path.includes('/assistant/'));
}

it('draws no assistant control and asks nothing when the deployment has no assistant', async () => {
  const view = renderConsoleAt('/console/acme', routes(whoami(['use-assistant'], false, false)));
  await shellReady();
  await waitFor(() => {
    expect(view.calls.length).toBeGreaterThan(1);
  });
  expect(screen.queryByRole('button', { name: 'Ask the assistant' })).toBeNull();
  expect(assistantCalls(view.calls)).toEqual([]);
});

it('draws no assistant control and asks nothing of a caller who may not use it', async () => {
  const view = renderConsoleAt(
    '/console/acme',
    routes(whoami(['read-assistant-activity', 'manage-assistant'], false, true), json(ON)),
  );
  await shellReady();
  await waitFor(() => {
    expect(view.calls.length).toBeGreaterThan(1);
  });
  expect(screen.queryByRole('button', { name: 'Ask the assistant' })).toBeNull();
  expect(assistantCalls(view.calls)).toEqual([]);
});

describe('for a system administrator in another tenant', () => {
  const OPERATOR = whoami(['use-assistant', 'manage-tenants'], true, true);
  const at = (who: Answer, status: Answer) => ({
    ...routes(who, status),
    'GET /console/api/session': json(ROOT),
  });

  it('draws no control and asks nothing without manage-tenants', async () => {
    const view = renderConsoleAt(
      '/console/acme',
      at(whoami(['use-assistant'], true, true), json(ON)),
    );
    await shellReady();
    await waitFor(() => {
      expect(view.calls.length).toBeGreaterThan(1);
    });
    expect(screen.queryByRole('button', { name: 'Ask the assistant' })).toBeNull();
    expect(assistantCalls(view.calls)).toEqual([]);
  });

  it('draws no control and asks nothing where the deployment has no assistant', async () => {
    const view = renderConsoleAt(
      '/console/acme',
      at(whoami(['use-assistant', 'manage-tenants'], true, false), json(ON)),
    );
    await shellReady();
    await waitFor(() => {
      expect(view.calls.length).toBeGreaterThan(1);
    });
    expect(screen.queryByRole('button', { name: 'Ask the assistant' })).toBeNull();
    expect(assistantCalls(view.calls)).toEqual([]);
  });

  it('draws nothing for a tenant that switched the assistant off', async () => {
    const view = renderConsoleAt('/console/acme', at(OPERATOR, json({ enabled: false })));
    await shellReady();
    await waitFor(() => {
      expect(assistantCalls(view.calls)).toEqual([STATUS]);
    });
    expect(screen.queryByRole('button', { name: 'Ask the assistant' })).toBeNull();
  });

  it('draws the control when the tenant has it on, and the panel names the tenant it acts in', async () => {
    vi.stubGlobal('innerWidth', 1400);
    const user = userEvent.setup();
    renderConsoleAt('/console/acme', at(OPERATOR, json(ON)));
    await user.click(await assistantButton());
    const panel = await screen.findByRole('complementary', { name: 'Assistant panel' });
    expect(within(panel).getByText('Acting in acme')).toBeVisible();
  });

  it('names no tenant for an administrator in their own', async () => {
    vi.stubGlobal('innerWidth', 1400);
    const user = userEvent.setup();
    renderConsoleAt('/console/acme', routes(OPEN, json(ON)));
    await user.click(await assistantButton());
    const panel = await screen.findByRole('complementary', { name: 'Assistant panel' });
    expect(within(panel).queryByText(/Acting in/u)).toBeNull();
  });
});

it('draws nothing and asks nothing while whoami is still being asked', async () => {
  const view = renderConsoleAt('/console/acme', routes(pending(), json(ON)));
  await shellReady();
  expect(screen.queryByRole('button', { name: 'Ask the assistant' })).toBeNull();
  expect(assistantCalls(view.calls)).toEqual([]);
});

it('draws nothing and asks nothing when whoami failed', async () => {
  const view = renderConsoleAt(
    '/console/acme',
    routes(problem(500, 'about:blank', 'Internal Server Error'), json(ON)),
  );
  await shellReady();
  await screen.findByRole('link', { name: 'Subjects' });
  expect(screen.queryByRole('button', { name: 'Ask the assistant' })).toBeNull();
  expect(assistantCalls(view.calls)).toEqual([]);
});

it('draws no control, panel or shortcut for a tenant that switched the assistant off', async () => {
  const user = userEvent.setup();
  const view = renderConsoleAt('/console/acme', routes(OPEN, json({ enabled: false })));
  await shellReady();
  await waitFor(() => {
    expect(assistantCalls(view.calls)).toEqual([STATUS]);
  });
  expect(screen.queryByRole('button', { name: 'Ask the assistant' })).toBeNull();
  await user.keyboard('{Control>}k{/Control}');
  expect(screen.queryByRole('complementary', { name: 'Assistant panel' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Assistant' })).toBeNull();
  expect(assistantCalls(view.calls)).toEqual([STATUS]);
});

it('draws nothing when the status read fails or is refused', async () => {
  for (const status of [offline(), problem(403, 'about:blank', 'Forbidden'), json({ x: 1 })]) {
    const view = renderConsoleAt('/console/acme', routes(OPEN, status));
    await shellReady();
    await waitFor(() => {
      expect(assistantCalls(view.calls)).toContain(STATUS);
    });
    expect(screen.queryByRole('button', { name: 'Ask the assistant' })).toBeNull();
    view.unmount();
    resetConsole();
  }
});

it('offers a labelled button with its shortcut when the assistant is on', async () => {
  renderConsoleAt('/console/acme', routes(OPEN, json(ON)));
  const button = await assistantButton();
  expect(button).toHaveAttribute('aria-keyshortcuts', 'Control+K');
  expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getAllByText(/or press/u).length).toBeGreaterThan(0);
});

// The shell is as wide as the window, which jsdom has no layout for: 1400 gives
// the panel a column of its own beside the page, and 800 lays it over the page.
const PLACES = [
  ['beside the page', 1400, 'complementary'],
  ['over the page', 800, 'dialog'],
] as const;

it.each(PLACES)(
  'opens the panel from the button %s, moves focus to it, and gives focus back on Escape',
  async (_place, width, role) => {
    vi.stubGlobal('innerWidth', width);
    const user = userEvent.setup();
    renderConsoleAt('/console/acme', routes(OPEN, json(ON)));
    const button = await assistantButton();
    await user.click(button);
    const panel = await screen.findByRole(role, { name: 'Assistant panel' });
    expect(within(panel).getByRole('heading', { name: 'Assistant' })).toHaveFocus();
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole(role, { name: 'Assistant panel' })).toBeNull();
    });
    expect(button).toHaveFocus();
  },
);

it('opens the panel on the shortcut, and focuses it when it is already open', async () => {
  vi.stubGlobal('innerWidth', 1400);
  const user = userEvent.setup();
  renderConsoleAt('/console/acme', routes(OPEN, json(ON)));
  await screen.findAllByRole('button', { name: 'Ask the assistant' });
  await user.keyboard('{Control>}k{/Control}');
  const panel = await screen.findByRole('complementary', { name: 'Assistant panel' });
  const heading = within(panel).getByRole('heading', { name: 'Assistant' });
  expect(heading).toHaveFocus();
  screen.getByRole('main').focus();
  await user.keyboard('{Control>}k{/Control}');
  expect(heading).toHaveFocus();
});

it('keeps the page behind the panel out of reach while it lies over the page', async () => {
  vi.stubGlobal('innerWidth', 800);
  const user = userEvent.setup();
  renderConsoleAt('/console/acme', routes(OPEN, json(ON)));
  await user.click(await assistantButton());
  await screen.findByRole('dialog', { name: 'Assistant panel' });
  expect(screen.queryByRole('navigation', { name: 'Areas of acme' })).toBeNull();
  expect(screen.queryByRole('main')).toBeNull();
});

it('does nothing on the shortcut behind a dialog, whether a field or a button has the focus', async () => {
  const user = userEvent.setup();
  renderConsoleAt('/console/acme', routes(OPEN, json(ON)));
  await screen.findAllByRole('button', { name: 'Ask the assistant' });
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  const field = document.createElement('input');
  const cancel = document.createElement('button');
  dialog.append(field, cancel);
  document.body.append(dialog);
  for (const target of [field, cancel]) {
    target.focus();
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.queryByRole('complementary', { name: 'Assistant panel' })).toBeNull();
  }
  dialog.remove();
});

it.each(PLACES)(
  'passes axe in both themes with the control drawn and the panel open %s',
  async (_place, width, role) => {
    vi.stubGlobal('innerWidth', width);
    const user = userEvent.setup();
    const shell = () => consoleAt('/console/acme', routes(OPEN, json(ON)));
    expect(
      await axeInBothThemes(
        () => shell().element,
        async () => {
          await user.click(await assistantButton());
          return screen.findByRole(role, { name: 'Assistant panel' });
        },
      ),
    ).toEqual({ light: [], dark: [] });
  },
);
