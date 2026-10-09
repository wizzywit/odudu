import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { inTurn, json, problem } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';
import { ADMIN, systemRoutes, tenant } from '#/testing/tenantsFixtures.ts';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const ACME = tenant('acme', { display_name: 'Acme' });

function routes(extra = {}) {
  return systemRoutes({ [`GET ${ADMIN}/acme`]: json(ACME, 200, { etag: '"t1"' }), ...extra });
}

async function displayName() {
  return screen.findByRole('textbox', { name: 'Display name' });
}

it('saves the display name on the ETag it was read with, and an emptied one as none', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    '/console/system/tenants/acme',
    routes({
      [`PATCH ${ADMIN}/acme`]: inTurn(
        json({ ...ACME, display_name: 'Acme Europe' }, 200, { etag: '"t2"' }),
        json({ ...ACME, display_name: null }, 200, { etag: '"t3"' }),
      ),
    }),
  );
  const field = await displayName();
  await user.clear(field);
  await user.type(field, 'Acme Europe');
  await user.click(screen.getByRole('button', { name: 'Save General' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')).toMatchObject({
      ifMatch: '"t1"',
      body: { display_name: 'Acme Europe' },
    });
  });
  expect(await screen.findByRole('heading', { level: 2, name: 'General' })).toHaveFocus();

  await user.clear(await displayName());
  await user.click(screen.getByRole('button', { name: 'Save General' }));
  await waitFor(() => {
    expect(sent.filter((s) => s.method === 'PATCH')[1]).toMatchObject({
      ifMatch: '"t2"',
      body: { display_name: null },
    });
  });
});

it('shows a 412 as the other value beside yours', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    '/console/system/tenants/acme',
    routes({
      [`GET ${ADMIN}/acme`]: inTurn(
        json(ACME, 200, { etag: '"t1"' }),
        json({ ...ACME, display_name: 'Acme Holdings' }, 200, { etag: '"t9"' }),
      ),
      [`PATCH ${ADMIN}/acme`]: problem(412, 'about:blank', 'Precondition Failed'),
    }),
  );
  const field = await displayName();
  await user.clear(field);
  await user.type(field, 'Acme Europe');
  await user.click(screen.getByRole('button', { name: 'Save General' }));
  const notice = await screen.findByText(/Display name in General changed elsewhere/u);
  expect(notice).toBeVisible();
  expect(screen.getByRole('button', { name: 'Keep mine in General' })).toBeVisible();
  const table = screen.getByRole('table', { name: 'Changed in General since you opened it' });
  expect(within(table).getByRole('row', { name: /Display name/u })).toHaveTextContent(
    'Acme HoldingsAcme Europe',
  );
});

it('disables a tenant only once its name is typed, and offers to enable it again', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    '/console/system/tenants/acme',
    routes({
      [`PATCH ${ADMIN}/acme`]: inTurn(
        json({ ...ACME, enabled: false }, 200, { etag: '"t2"' }),
        json(ACME, 200, { etag: '"t3"' }),
      ),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Disable acme' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Disable acme?' });
  const confirm = within(dialog).getByRole('button', { name: 'Disable acme' });
  expect(confirm).toBeDisabled();
  await user.type(within(dialog).getByRole('textbox', { name: 'Type acme to confirm' }), 'acme');
  await user.click(confirm);
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')).toMatchObject({
      ifMatch: '"t1"',
      body: { enabled: false },
    });
  });
  const enable = await screen.findByRole('button', { name: 'Enable acme' });
  expect(screen.queryByRole('alertdialog')).toBeNull();
  await user.click(enable);
  await waitFor(() => {
    expect(sent.filter((s) => s.method === 'PATCH')[1]).toMatchObject({
      ifMatch: '"t2"',
      body: { enabled: true },
    });
  });
});

it('says beside the action when the tenant changed elsewhere', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    '/console/system/tenants/acme',
    routes({ [`PATCH ${ADMIN}/acme`]: problem(412, 'about:blank', 'Precondition Failed') }),
  );
  await user.click(await screen.findByRole('button', { name: 'Disable acme' }));
  const dialog = await screen.findByRole('alertdialog');
  await user.type(within(dialog).getByRole('textbox'), 'acme{Enter}');
  expect(await screen.findByText(/acme changed elsewhere since you opened it/u)).toBeVisible();
});

it('shows the system tenant as one that cannot be disabled, with the reason', async () => {
  renderConsoleAt('/console/system/tenants/system', {
    ...systemRoutes(),
    [`GET ${ADMIN}/system`]: json(tenant('system'), 200, { etag: '"s1"' }),
  });
  expect(await screen.findByText(/system cannot be disabled/u)).toBeVisible();
  expect(screen.queryByRole('button', { name: /Disable/u })).toBeNull();
});

it('passes axe in both themes, with the confirmation open', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () => consoleAt('/console/system/tenants/acme', routes()).element,
      async () => {
        await user.click(await screen.findByRole('button', { name: 'Disable acme' }));
        await screen.findByRole('alertdialog');
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
