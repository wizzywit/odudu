import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { json, problem } from '#/testing/fakeTransport';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { settingsRoutes } from '#/testing/settingsFixtures';
import { ACME_ADMIN } from '#/testing/tenantPaths';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/settings';
const LOCKOUTS = `DELETE ${ACME_ADMIN}/lockouts`;

async function zone() {
  return screen.findByRole('region', { name: 'Clear all lockouts' });
}

it('offers the clear below the brute-force settings, and says what it is for', async () => {
  renderConsoleAt(AT, settingsRoutes());
  const panel = await zone();
  expect(within(panel).getByText(/Forgets every failed sign-in on record/u)).toBeVisible();
  expect(within(panel).getByRole('button', { name: 'Clear all lockouts' })).toBeVisible();
});

it('clears once the tenant’s name is typed, and says how many accounts it cleared', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    settingsRoutes(undefined, {
      [LOCKOUTS]: json({ cleared: 3, beyond_ceiling: 1, remaining: 0 }),
    }),
  );
  await user.click(within(await zone()).getByRole('button', { name: 'Clear all lockouts' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Clear all lockouts in acme?' });
  expect(dialog).toHaveTextContent('every wrong password and every wrong second factor');
  const confirm = within(dialog).getByRole('button', { name: 'Clear all lockouts' });
  expect(confirm).toBeDisabled();
  await user.type(within(dialog).getByRole('textbox', { name: 'Type acme to confirm' }), 'acme');
  await user.click(confirm);
  expect(
    await screen.findByText(/Cleared the failed sign-ins of 3 accounts in acme\. 1 was kept/u),
  ).toBeVisible();
  expect(sent.filter((s) => s.method === 'DELETE')).toHaveLength(1);
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('keeps saying to clear again beside the button while more are left', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    settingsRoutes(undefined, {
      [LOCKOUTS]: json({ cleared: 10000, beyond_ceiling: 0, remaining: 40 }),
    }),
  );
  await user.click(within(await zone()).getByRole('button', { name: 'Clear all lockouts' }));
  const dialog = await screen.findByRole('alertdialog');
  await user.type(within(dialog).getByRole('textbox'), 'acme{Enter}');
  expect(
    await within(await zone()).findByText(
      'More failed sign-ins are left in acme: clear every lockout again to clear the next 10,000.',
    ),
  ).toBeVisible();
});

it('keeps the dialog and says why when the server refuses', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    settingsRoutes(undefined, { [LOCKOUTS]: problem(403, 'about:blank', 'Forbidden') }),
  );
  await user.click(within(await zone()).getByRole('button', { name: 'Clear all lockouts' }));
  const dialog = await screen.findByRole('alertdialog');
  await user.type(within(dialog).getByRole('textbox'), 'acme{Enter}');
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('manage-users');
});

it('tells a caller without manage-users what the clear needs, and offers no button', async () => {
  renderConsoleAt(AT, settingsRoutes(['manage-tenant']));
  const panel = await zone();
  expect(within(panel).getByRole('note')).toHaveTextContent(
    'Clearing every lockout needs the manage-users capability.',
  );
  expect(within(panel).queryByRole('button')).toBeNull();
});

it('passes axe in both themes, with the zone and with the confirmation open', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, settingsRoutes()).element,
      async () => {
        await zone();
      },
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, settingsRoutes()).element,
      async () => {
        await user.click(within(await zone()).getByRole('button', { name: 'Clear all lockouts' }));
        await screen.findByRole('alertdialog', { name: 'Clear all lockouts in acme?' });
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
