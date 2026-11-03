import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { json, problem } from '#/testing/fakeTransport';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { builtinsPresent, SC, scopeRoutes } from '#/testing/scopesFixtures';

afterEach(() => {
  resetConsole();
});

const AT = '/console/acme/scopes';

async function openRestore(extra: Record<string, ReturnType<typeof json>> = {}) {
  const user = userEvent.setup();
  const rendered = renderConsoleAt(AT, scopeRoutes(undefined, extra));
  await user.click(await screen.findByRole('button', { name: 'Restore built-in scopes' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Restore built-in scopes?' });
  return { user, dialog, ...rendered };
}

it('names the built-in scopes a tenant has lost, and creates them again on confirmation', async () => {
  const { user, dialog, sent } = await openRestore({
    [`GET ${SC}/builtins`]: json(builtinsPresent(['roles', 'groups'])),
    [`POST ${SC}/restore-builtins`]: json({ created: ['roles', 'groups'] }),
  });
  expect(await within(dialog).findByText(/roles and groups are missing/u)).toBeVisible();
  expect(dialog).toHaveTextContent(
    'does not bring back the client assignments and role mappings that went with them',
  );
  await user.click(within(dialog).getByRole('button', { name: 'Restore' }));
  await waitFor(() => {
    expect(sent.some((s) => s.method === 'POST' && s.path === `${SC}/restore-builtins`)).toBe(true);
  });
  expect(await screen.findByText(/Restored roles and groups\./u)).toBeVisible();
  expect(screen.queryByRole('alertdialog')).toBeNull();
  const listReads = () => sent.filter((s) => s.method === 'GET' && s.path === SC);
  await waitFor(() => {
    expect(listReads().length).toBeGreaterThan(1);
  });
});

it('says there is nothing to restore when every built-in is present, and sends nothing', async () => {
  const { user, dialog, sent } = await openRestore();
  expect(await within(dialog).findByText(/nothing to restore/u)).toBeVisible();
  const restore = within(dialog).getByRole('button', { name: 'Restore' });
  expect(restore).toBeDisabled();
  await user.click(restore);
  expect(sent.some((s) => s.method === 'POST')).toBe(false);
});

it('never offers a restore it could not name when the built-ins cannot be read', async () => {
  const { dialog } = await openRestore({
    [`GET ${SC}/builtins`]: problem(500, 'about:blank', 'Internal Server Error'),
  });
  expect(await within(dialog).findByText(/could not be read/u)).toBeVisible();
  expect(within(dialog).getByRole('button', { name: 'Restore' })).toBeDisabled();
});

it("says the server's reason in the dialog when a restore is refused, and stays open", async () => {
  const { user, dialog } = await openRestore({
    [`GET ${SC}/builtins`]: json(builtinsPresent(['roles'])),
    [`POST ${SC}/restore-builtins`]: problem(409, 'about:blank', 'Conflict', {
      detail: 'a tenant defines at most 1000 scopes',
    }),
  });
  await within(dialog).findByText(/roles is missing/u);
  await user.click(within(dialog).getByRole('button', { name: 'Restore' }));
  expect(
    await within(dialog).findByText(/was not done: a tenant defines at most 1000 scopes/u),
  ).toBeVisible();
});

it('reads which built-ins are missing each time the dialog is opened', async () => {
  const { user, dialog, sent } = await openRestore();
  await within(dialog).findByText(/nothing to restore/u);
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await user.click(screen.getByRole('button', { name: 'Restore built-in scopes' }));
  await waitFor(() => {
    expect(sent.filter((s) => s.path === `${SC}/builtins`)).toHaveLength(2);
  });
});

it('passes axe in both themes, with the restore dialog open', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () =>
        consoleAt(
          AT,
          scopeRoutes(undefined, { [`GET ${SC}/builtins`]: json(builtinsPresent(['roles'])) }),
        ).element,
      async () => {
        await user.click(await screen.findByRole('button', { name: 'Restore built-in scopes' }));
        const dialog = await screen.findByRole('alertdialog', { name: 'Restore built-in scopes?' });
        await within(dialog).findByText(/roles is missing/u);
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
