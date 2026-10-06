import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import {
  A,
  BILLING,
  C,
  clientRoutes,
  client,
  heldBy,
  serviceAccountOf,
} from '#/testing/clientsFixtures.ts';
import { json, problem } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/clients/c-bill?tab=redirects';

async function open(): Promise<void> {
  await screen.findByRole('group', { name: 'Redirect URIs' });
  await screen.findByRole('button', { name: 'Add redirect URI' });
}

it('lists the redirect URIs and web origins, each against the limit the server holds', async () => {
  renderConsoleAt(AT, clientRoutes());
  await open();
  const redirects = screen.getByRole('region', { name: 'Redirect URIs' });
  expect(within(redirects).getByRole('textbox', { name: 'Redirect URI 1' })).toHaveValue(
    'https://billing.example/callback',
  );
  expect(within(redirects).getByText(/1 of 200 redirect URIs\./u)).toBeVisible();
  const origins = screen.getByRole('region', { name: 'Web origins' });
  expect(within(origins).getByRole('textbox', { name: 'Web origin 1' })).toHaveValue(
    'https://billing.example',
  );
  expect(within(origins).getByText(/1 of 200 web origins\./u)).toBeVisible();
});

it('says how far over the limit a list is, and never draws more than the client holds', async () => {
  const many = Array.from({ length: 201 }, (_, i) => `https://rp.example/cb/${String(i)}`);
  renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`GET ${C}/c-bill`]: json(client('c-bill', 'billing', { redirect_uris: many }), 200, {
        etag: '"c-bill-1"',
      }),
    }),
  );
  await open();
  const redirects = screen.getByRole('region', { name: 'Redirect URIs' });
  expect(within(redirects).getByText(/1 over the limit of 200 redirect URIs\./u)).toBeVisible();
  expect(within(redirects).getAllByRole('textbox')).toHaveLength(201);
});

it('adds a redirect URI and saves the whole list on the ETag it read', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`PATCH ${C}/c-bill`]: json(
        { ...BILLING, redirect_uris: ['https://billing.example/callback', 'https://b.example/cb'] },
        200,
        { etag: '"b2"' },
      ),
    }),
  );
  await open();
  const redirects = screen.getByRole('region', { name: 'Redirect URIs' });
  await user.click(within(redirects).getByRole('button', { name: 'Add redirect URI' }));
  await user.type(
    within(redirects).getByRole('textbox', { name: 'Redirect URI 2' }),
    'https://b.example/cb',
  );
  await user.click(within(redirects).getByRole('button', { name: 'Save Redirect URIs' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')).toMatchObject({
      ifMatch: '"c-bill-1"',
      body: { redirect_uris: ['https://billing.example/callback', 'https://b.example/cb'] },
    });
  });
  expect(await within(redirects).findByText(/2 of 200 redirect URIs\./u)).toBeVisible();
});

it('removes a web origin and saves the list without it', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`PATCH ${C}/c-bill`]: json({ ...BILLING, web_origins: [] }, 200, { etag: '"b2"' }),
    }),
  );
  await open();
  const origins = screen.getByRole('region', { name: 'Web origins' });
  await user.click(
    within(origins).getByRole('button', {
      name: /Remove web origin 1, https:\/\/billing.example/u,
    }),
  );
  await user.click(within(origins).getByRole('button', { name: 'Save Web origins' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toEqual({ web_origins: [] });
  });
});

it("shows the server's refusal of a non-canonical origin under web origins, in its words", async () => {
  const user = userEvent.setup();
  const refusal =
    'web_origins entry "https://app.example/" is not an origin: expected a scheme and host with no path, or "+" for every registered redirect URI\'s origin';
  const { sent } = renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`PATCH ${C}/c-bill`]: problem(400, 'about:blank', 'Bad Request', {
        detail: refusal,
        errors: [{ path: 'web_origins', message: refusal }],
      }),
    }),
  );
  await open();
  const origins = screen.getByRole('region', { name: 'Web origins' });
  await user.click(within(origins).getByRole('button', { name: 'Add web origin' }));
  await user.type(
    within(origins).getByRole('textbox', { name: 'Web origin 2' }),
    'https://app.example/',
  );
  await user.click(within(origins).getByRole('button', { name: 'Save Web origins' }));
  expect(await within(origins).findByText(refusal)).toBeVisible();
  expect(within(origins).getByRole('group', { name: 'Web origins' })).toHaveAccessibleDescription(
    expect.stringContaining(refusal),
  );
  // The list stays as typed, to correct; the other section is untouched.
  expect(within(origins).getByRole('textbox', { name: 'Web origin 2' })).toHaveValue(
    'https://app.example/',
  );
  expect(sent.filter((s) => s.method === 'PATCH')).toHaveLength(1);
  expect(
    within(screen.getByRole('region', { name: 'Redirect URIs' })).queryByText(/is not an origin/u),
  ).toBeNull();
});

it("shows the server's refusal of a redirect URI under redirect URIs", async () => {
  const user = userEvent.setup();
  const refusal = 'redirect_uris entry http://billing.example/cb is not valid';
  renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`PATCH ${C}/c-bill`]: problem(400, 'about:blank', 'Bad Request', {
        detail: refusal,
        errors: [{ path: 'redirect_uris', message: refusal }],
      }),
    }),
  );
  await open();
  const redirects = screen.getByRole('region', { name: 'Redirect URIs' });
  await user.click(within(redirects).getByRole('button', { name: 'Add redirect URI' }));
  await user.type(
    within(redirects).getByRole('textbox', { name: 'Redirect URI 2' }),
    'http://billing.example/cb',
  );
  await user.click(within(redirects).getByRole('button', { name: 'Save Redirect URIs' }));
  expect(await within(redirects).findByText(refusal)).toBeVisible();
});

it('says the limit the server enforces when it refuses a list that is too long', async () => {
  const user = userEvent.setup();
  const refusal = 'web_origins holds 201 entries, at most 200';
  renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`PATCH ${C}/c-bill`]: problem(400, 'about:blank', 'Bad Request', {
        detail: refusal,
        errors: [{ path: 'web_origins', message: refusal }],
      }),
    }),
  );
  await open();
  const origins = screen.getByRole('region', { name: 'Web origins' });
  await user.click(within(origins).getByRole('button', { name: 'Add web origin' }));
  await user.type(within(origins).getByRole('textbox', { name: 'Web origin 2' }), 'https://a.test');
  await user.click(within(origins).getByRole('button', { name: 'Save Web origins' }));
  expect(await within(origins).findByText(refusal)).toBeVisible();
});

it('points to Logout for the post-logout URIs, which are not listed here', async () => {
  renderConsoleAt(AT, clientRoutes());
  await open();
  expect(screen.getByRole('link', { name: 'Open Logout' })).toHaveAttribute(
    'href',
    '/console/acme/clients/c-bill?tab=logout',
  );
  expect(screen.queryByRole('group', { name: /Post-logout/u })).toBeNull();
});

it("shows the built-in admin client's lists as fixed text, with the reason", async () => {
  renderConsoleAt('/console/acme/clients/c-admin?tab=redirects', clientRoutes());
  expect(
    await screen.findByText(/odudu-admin's redirect URIs and web origins cannot be changed/u),
  ).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Add redirect URI' })).toBeNull();
});

it('shows the lists as text, with no way to add or remove, where the ceiling holds the client back', async () => {
  renderConsoleAt(
    AT,
    clientRoutes(['manage-clients', 'view-users'], {
      [`GET ${A}/subjects/${serviceAccountOf('c-bill')}/admin-capabilities`]: json(
        heldBy(['manage-users']),
      ),
    }),
  );
  expect(await screen.findByText(/service account holds manage-users/u)).toBeVisible();
  const redirects = screen.getByRole('region', { name: 'Redirect URIs' });
  expect(redirects).toHaveTextContent('https://billing.example/callback');
  expect(screen.queryByRole('button', { name: 'Add redirect URI' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Add web origin' })).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
});

it('passes axe in both themes, with the lists and with a refusal shown', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, clientRoutes()).element,
      () => open(),
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
              errors: [{ path: 'web_origins', message: 'is not an origin' }],
            }),
          }),
        ).element,
      async () => {
        await open();
        const origins = screen.getByRole('region', { name: 'Web origins' });
        await user.click(within(origins).getByRole('button', { name: 'Add web origin' }));
        await user.type(within(origins).getByRole('textbox', { name: 'Web origin 2' }), 'x/');
        await user.click(within(origins).getByRole('button', { name: 'Save Web origins' }));
        await within(origins).findByText('is not an origin');
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
