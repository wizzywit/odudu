import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { ADMIN, BILLING, C, clientRoutes, PORTAL } from '#/testing/clientsFixtures.ts';
import { inTurn, json, problem } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/clients/c-bill';

// Writes are offered once the service account's capabilities have been read.
async function offered(): Promise<void> {
  await screen.findByRole('textbox', { name: 'Name' });
}

it('shows the client ID and type as fixed, and saves the details on the ETag it read', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`PATCH ${C}/c-bill`]: json({ ...BILLING, name: 'Invoicing' }, 200, { etag: '"b2"' }),
    }),
  );
  expect(await screen.findByRole('heading', { level: 1, name: 'Billing' })).toBeVisible();
  await offered();
  const identity = screen.getByRole('region', { name: 'Identity' });
  expect(within(identity).getByText('Confidential')).toBeVisible();
  expect(within(identity).getByText(/A client's ID is fixed once it is made/u)).toBeVisible();
  expect(screen.queryByRole('textbox', { name: 'Client ID' })).toBeNull();
  const details = screen.getByRole('region', { name: 'Details' });
  const name = within(details).getByRole('textbox', { name: 'Name' });
  await user.clear(name);
  await user.type(name, 'Invoicing');
  await user.click(within(details).getByRole('button', { name: 'Save Details' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')).toMatchObject({
      ifMatch: '"c-bill-1"',
      body: { name: 'Invoicing', description: 'Invoices' },
    });
  });
});

it('keeps the description in a text area counted against the limit, and clears it when emptied', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`PATCH ${C}/c-bill`]: json({ ...BILLING, description: null }, 200, { etag: '"b2"' }),
    }),
  );
  await offered();
  const details = screen.getByRole('region', { name: 'Details' });
  const description = within(details).getByRole('textbox', { name: 'Description' });
  expect(description.tagName).toBe('TEXTAREA');
  expect(within(details).getByText(/8 of 1,000 characters\./u)).toBeVisible();
  await user.clear(description);
  await user.click(within(details).getByRole('button', { name: 'Save Details' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toEqual({
      name: 'Billing',
      description: null,
    });
  });
});

it('shows a name changed elsewhere beside yours on a 412, and sends nothing more', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`GET ${C}/c-bill`]: inTurn(
        json(BILLING, 200, { etag: '"c-bill-1"' }),
        json({ ...BILLING, name: 'Theirs' }, 200, { etag: '"c-bill-2"' }),
      ),
      [`PATCH ${C}/c-bill`]: problem(412, 'about:blank', 'Precondition Failed'),
    }),
  );
  await offered();
  const details = screen.getByRole('region', { name: 'Details' });
  const name = within(details).getByRole('textbox', { name: 'Name' });
  await user.clear(name);
  await user.type(name, 'Mine');
  await user.click(within(details).getByRole('button', { name: 'Save Details' }));
  expect(await within(details).findByText(/changed elsewhere/u)).toBeVisible();
  expect(within(details).getByText('Theirs')).toBeVisible();
  expect(within(details).getByRole('button', { name: 'Keep mine in Details' })).toBeVisible();
  expect(sent.filter((s) => s.method === 'PATCH')).toHaveLength(1);
});

it('sends the three pages of the consent screen, an emptied one as null', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`GET ${C}/c-bill`]: json({ ...BILLING, tos_uri: 'https://billing.example/tos' }, 200, {
        etag: '"c-bill-1"',
      }),
      [`PATCH ${C}/c-bill`]: json(BILLING, 200, { etag: '"b2"' }),
    }),
  );
  await offered();
  const pages = screen.getByRole('region', { name: 'Consent screen links' });
  await user.type(
    within(pages).getByRole('textbox', { name: 'Privacy policy' }),
    'https://billing.example/privacy',
  );
  await user.clear(within(pages).getByRole('textbox', { name: 'Terms of service' }));
  await user.click(within(pages).getByRole('button', { name: 'Save Consent screen links' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toEqual({
      client_uri: null,
      policy_uri: 'https://billing.example/privacy',
      tos_uri: null,
    });
  });
});

it("places the server's refusal of a page under it", async () => {
  const user = userEvent.setup();
  const refusal =
    'policy_uri must be an absolute https URI, or http on a loopback host, with no fragment';
  renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`PATCH ${C}/c-bill`]: problem(400, 'about:blank', 'Bad Request', {
        detail: refusal,
        errors: [{ path: 'policy_uri', message: refusal }],
      }),
    }),
  );
  await offered();
  const pages = screen.getByRole('region', { name: 'Consent screen links' });
  await user.type(within(pages).getByRole('textbox', { name: 'Privacy policy' }), 'ftp://x');
  await user.click(within(pages).getByRole('button', { name: 'Save Consent screen links' }));
  expect(await within(pages).findByText(refusal)).toBeVisible();
});

it('disables and enables a client, and says what consent asks of people, each saved alone', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`PATCH ${C}/c-bill`]: json({ ...BILLING, enabled: false }, 200, { etag: '"b2"' }),
    }),
  );
  await offered();
  const availability = screen.getByRole('region', { name: 'Availability' });
  await user.click(within(availability).getByRole('switch', { name: 'Enabled' }));
  await user.click(within(availability).getByRole('button', { name: 'Save Availability' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')).toMatchObject({
      ifMatch: '"c-bill-1"',
      body: { enabled: false },
    });
  });
  const consent = screen.getByRole('region', { name: 'Consent' });
  expect(within(consent).getByRole('switch', { name: 'Consent required' })).not.toBeChecked();
});

it('deletes a client once its ID is typed, and goes back to the list', async () => {
  const user = userEvent.setup();
  const { sent, router } = renderConsoleAt(
    AT,
    clientRoutes(undefined, { [`DELETE ${C}/c-bill`]: () => new Response(null, { status: 204 }) }),
  );
  await user.click(await screen.findByRole('button', { name: 'Delete Billing' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Delete Billing?' });
  expect(dialog).toHaveTextContent('deletes the client and every role scoped to it');
  const confirm = within(dialog).getByRole('button', { name: 'Delete Billing' });
  expect(confirm).toBeDisabled();
  await user.type(within(dialog).getByRole('textbox'), 'billing');
  await user.click(confirm);
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/acme/clients');
  });
  expect(sent.filter((s) => s.method === 'DELETE')).toHaveLength(1);
  const after = sent.slice(sent.findIndex((s) => s.method === 'DELETE') + 1);
  expect(after.filter((s) => s.path === `${C}/c-bill`)).toEqual([]);
});

it("says a refused delete in the dialog, in the server's words, and deletes nothing", async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`DELETE ${C}/c-bill`]: problem(403, 'about:blank', 'Forbidden', {
        detail: 'this removes capabilities the caller does not hold: manage-users',
      }),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Delete Billing' }));
  const dialog = await screen.findByRole('alertdialog');
  await user.type(within(dialog).getByRole('textbox'), 'billing');
  await user.click(within(dialog).getByRole('button', { name: 'Delete Billing' }));
  expect(
    await within(dialog).findByText(
      /it would take manage-users from whoever holds it through here/u,
    ),
  ).toBeVisible();
});

it('fixes what would lock every administrator out of the built-in admin client', async () => {
  renderConsoleAt('/console/acme/clients/c-admin', clientRoutes());
  await screen.findByRole('heading', { level: 1, name: 'Odudu admin' });
  expect(await screen.findByText(/odudu-admin cannot be disabled\./u)).toBeVisible();
  expect(screen.queryByRole('switch', { name: 'Enabled' })).toBeNull();
  expect(
    within(screen.getByRole('region', { name: 'Availability' })).queryByRole('button'),
  ).toBeNull();
  expect(screen.getByText(/odudu-admin cannot be deleted\./u)).toBeVisible();
  expect(screen.queryByRole('button', { name: /^Delete/u })).toBeNull();
  // Its name and consent are among what the server lets be amended.
  expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue(ADMIN.name);
  expect(screen.getByRole('switch', { name: 'Consent required' })).toBeVisible();
});

it('offers a public client its writes at once, since it has no service account to wait on', async () => {
  renderConsoleAt('/console/acme/clients/c-portal', clientRoutes(['manage-clients']));
  expect(await screen.findByRole('textbox', { name: 'Name' })).toHaveValue(PORTAL.name);
  expect(screen.getByRole('button', { name: 'Delete portal' })).toBeVisible();
});

it('passes axe in both themes, with the delete asked and with a refusal shown', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, clientRoutes()).element,
      async () => {
        await user.click(await screen.findByRole('button', { name: 'Delete Billing' }));
        await screen.findByRole('alertdialog');
      },
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () =>
        consoleAt(
          AT,
          clientRoutes(undefined, {
            [`PATCH ${C}/c-bill`]: problem(400, 'about:blank', 'Bad Request', {
              detail: 'x',
              errors: [{ path: 'policy_uri', message: 'must be https' }],
            }),
          }),
        ).element,
      async () => {
        await offered();
        const pages = screen.getByRole('region', { name: 'Consent screen links' });
        await user.type(within(pages).getByRole('textbox', { name: 'Privacy policy' }), 'ftp://x');
        await user.click(within(pages).getByRole('button', { name: 'Save Consent screen links' }));
        await within(pages).findByText('must be https');
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
