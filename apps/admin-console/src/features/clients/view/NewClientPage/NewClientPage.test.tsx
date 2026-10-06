import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { BILLING, C, clientRoutes, PORTAL } from '#/testing/clientsFixtures.ts';
import { json, offline, problem } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/clients/new';
const SECRET = 'dxCFsBxC72NKaBpbgeg4esoXJVPiAmnxX4VTgQwzJuk';

async function fill(user: ReturnType<typeof userEvent.setup>, clientId: string, uri: string) {
  await user.type(await screen.findByRole('textbox', { name: 'Client ID' }), clientId);
  await user.type(screen.getByRole('textbox', { name: 'Redirect URI 1' }), uri);
}

it('creates a confidential client, shows its secret once, and lands on its page', async () => {
  const user = userEvent.setup();
  const { sent, router } = renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`POST ${C}`]: json({ ...BILLING, client_secret: SECRET }, 201, { etag: '"b1"' }),
    }),
  );
  await fill(user, 'billing', 'https://billing.example/callback');
  await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Billing');
  await user.click(screen.getByRole('button', { name: 'Create client' }));
  const dialog = await screen.findByRole('dialog', { name: 'Client secret for Billing' });
  expect(within(dialog).getByText(SECRET)).toBeVisible();
  expect(sent.find((s) => s.method === 'POST')?.body).toEqual({
    client_id: 'billing',
    name: 'Billing',
    token_endpoint_auth_method: 'client_secret_basic',
    redirect_uris: ['https://billing.example/callback'],
  });
  // Nothing moves on until it has been acknowledged.
  expect(router.state.location.pathname).toBe('/acme/clients/new');
  await user.click(within(dialog).getByRole('checkbox'));
  await user.click(within(dialog).getByRole('button', { name: 'Close' }));
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/acme/clients/c-bill');
  });
  expect(document.body.textContent).not.toContain(SECRET);
});

it('creates a public client with no secret, and lands on its page at once', async () => {
  const user = userEvent.setup();
  const { sent, router } = renderConsoleAt(
    AT,
    clientRoutes(undefined, { [`POST ${C}`]: json(PORTAL, 201, { etag: '"p1"' }) }),
  );
  await user.click(await screen.findByRole('button', { name: /Web application/u }));
  await user.click(await screen.findByRole('option', { name: 'Public application' }));
  await fill(user, 'portal', 'https://portal.example/cb');
  await user.click(screen.getByRole('button', { name: 'Create client' }));
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/acme/clients/c-portal');
  });
  expect(sent.find((s) => s.method === 'POST')?.body).toMatchObject({
    token_endpoint_auth_method: 'none',
  });
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('creates a service with the client credentials grant and no redirect URI, and shows its secret once', async () => {
  const user = userEvent.setup();
  const { sent, router } = renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`POST ${C}`]: json({ ...BILLING, client_secret: SECRET }, 201, { etag: '"b1"' }),
    }),
  );
  await user.click(await screen.findByRole('button', { name: /Web application/u }));
  await user.click(await screen.findByRole('option', { name: 'Service' }));
  expect(screen.queryByRole('group', { name: 'Redirect URIs' })).toBeNull();
  await user.type(screen.getByRole('textbox', { name: 'Client ID' }), 'worker');
  await user.click(screen.getByRole('button', { name: 'Create client' }));
  const dialog = await screen.findByRole('dialog', { name: /^Client secret for/u });
  expect(within(dialog).getByText(SECRET)).toBeVisible();
  expect(sent.find((s) => s.method === 'POST')?.body).toEqual({
    client_id: 'worker',
    token_endpoint_auth_method: 'client_secret_basic',
    grant_types: ['client_credentials'],
  });
  expect(router.state.location.pathname).toBe('/acme/clients/new');
  await user.click(within(dialog).getByRole('checkbox'));
  await user.click(within(dialog).getByRole('button', { name: 'Close' }));
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/acme/clients/c-bill');
  });
});

it('asks for a client ID before sending anything', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, clientRoutes());
  await user.click(await screen.findByRole('button', { name: 'Create client' }));
  expect(await screen.findByText('Enter a client ID.')).toBeVisible();
  expect(sent.filter((s) => s.method === 'POST')).toEqual([]);
});

it("puts the server's refusal of a redirect URI under that field, in the server's words", async () => {
  const user = userEvent.setup();
  const refusal = 'redirect_uris entry http://billing.example/cb is not valid';
  renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`POST ${C}`]: problem(400, 'about:blank', 'Bad Request', {
        detail: refusal,
        errors: [{ path: 'redirect_uris', message: refusal }],
      }),
    }),
  );
  await fill(user, 'billing', 'http://billing.example/cb');
  await user.click(screen.getByRole('button', { name: 'Create client' }));
  expect(await screen.findByText(refusal)).toBeVisible();
  expect(screen.getByRole('group', { name: 'Redirect URIs' })).toHaveAccessibleDescription(
    expect.stringContaining(refusal),
  );
});

it('says a client ID is taken beside the ID', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`POST ${C}`]: problem(409, 'about:blank', 'Conflict', {
        detail: 'the client_id "billing" is already in use',
      }),
    }),
  );
  await fill(user, 'billing', 'https://billing.example/callback');
  await user.click(screen.getByRole('button', { name: 'Create client' }));
  expect(await screen.findByText('The client_id "billing" is already in use.')).toBeVisible();
});

it('looks for a client whose creation was not confirmed instead of sending it again', async () => {
  const user = userEvent.setup();
  const { sent, router } = renderConsoleAt(
    AT,
    clientRoutes(undefined, { [`POST ${C}`]: offline() }),
  );
  await fill(user, 'billing', 'https://billing.example/callback');
  await user.click(screen.getByRole('button', { name: 'Create client' }));
  const look = await screen.findByRole('button', { name: 'Look for billing' });
  expect(sent.filter((s) => s.method === 'POST')).toHaveLength(1);
  await user.click(look);
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/acme/clients/c-bill');
  });
  expect(sent.filter((s) => s.method === 'POST')).toHaveLength(1);
});

it('passes axe in both themes, with and without a refusal', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, clientRoutes()).element,
      () => screen.findByRole('textbox', { name: 'Client ID' }),
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, clientRoutes(['view-users'])).element,
      () => screen.findByRole('note'),
    ),
  ).toEqual({ light: [], dark: [] });
});
