import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { A, BILLING, C, clientRoutes, type ClientAnswer } from '#/testing/clientsFixtures.ts';
import { json, problem } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/clients/c-bill?tab=tokens';

async function open(): Promise<void> {
  await screen.findByRole('region', { name: 'Token lifetimes' });
  await screen.findByRole('switch', { name: "Use the tenant's access token lifetime" });
}

function answering(extra: Partial<ClientAnswer>) {
  return {
    [`GET ${C}/c-bill`]: json({ ...BILLING, ...extra }, 200, { etag: '"c-bill-1"' }),
  };
}

it('shows each lifetime as the tenant default until the client is given one of its own', async () => {
  renderConsoleAt(AT, clientRoutes(undefined, answering({ access_token_ttl_seconds: 600 })));
  await open();
  const section = screen.getByRole('region', { name: 'Token lifetimes' });
  expect(
    within(section).getByRole('textbox', { name: 'Access token lifetime, in seconds' }),
  ).toHaveValue('600');
  expect(within(section).getByText('600 s · 10 minutes')).toBeVisible();
  expect(within(section).getAllByText(/Takes the tenant's/u)).toHaveLength(2);
  expect(within(section).getAllByText('Between 1 s and 3600 s · 1 hour.')).toHaveLength(2);
  expect(within(section).getByText('At least 1 s.')).toBeVisible();
});

it("changes a lifetime and saves all three on the ETag it read, null handing one back to the tenant's", async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      ...answering({ access_token_ttl_seconds: 600 }),
      [`PATCH ${C}/c-bill`]: json({ ...BILLING, access_token_ttl_seconds: 900 }, 200, {
        etag: '"b2"',
      }),
    }),
  );
  await open();
  const section = screen.getByRole('region', { name: 'Token lifetimes' });
  const field = within(section).getByRole('textbox', { name: 'Access token lifetime, in seconds' });
  await user.clear(field);
  await user.type(field, '900');
  await user.tab();
  await user.click(within(section).getByRole('button', { name: 'Save Token lifetimes' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')).toMatchObject({
      ifMatch: '"c-bill-1"',
      body: {
        access_token_ttl_seconds: 900,
        id_token_ttl_seconds: null,
        refresh_token_ttl_seconds: null,
      },
    });
  });
});

it('gives a lifetime a value to start from when the tenant default is turned off', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`PATCH ${C}/c-bill`]: json({ ...BILLING, refresh_token_ttl_seconds: 86400 }, 200, {
        etag: '"b2"',
      }),
    }),
  );
  await open();
  const section = screen.getByRole('region', { name: 'Token lifetimes' });
  await user.click(
    within(section).getByRole('switch', { name: "Use the tenant's refresh token lifetime" }),
  );
  expect(
    within(section).getByRole('textbox', { name: 'Refresh token lifetime, in seconds' }),
  ).toHaveValue('86400');
  expect(within(section).getByText('86400 s · 1 day')).toBeVisible();
  await user.click(within(section).getByRole('button', { name: 'Save Token lifetimes' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toMatchObject({
      refresh_token_ttl_seconds: 86400,
    });
  });
});

it("shows the server's refusal of a lifetime under it", async () => {
  const user = userEvent.setup();
  const detail = 'access_token_ttl_seconds must be between 1 and 3600';
  renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      ...answering({ access_token_ttl_seconds: 600 }),
      [`PATCH ${C}/c-bill`]: problem(400, 'about:blank', 'Bad Request', {
        detail,
        errors: [{ path: 'access_token_ttl_seconds', message: detail }],
      }),
    }),
  );
  await open();
  const section = screen.getByRole('region', { name: 'Token lifetimes' });
  const field = within(section).getByRole('textbox', { name: 'Access token lifetime, in seconds' });
  await user.clear(field);
  await user.type(field, '900');
  await user.tab();
  await user.click(within(section).getByRole('button', { name: 'Save Token lifetimes' }));
  expect(await within(section).findByText(detail)).toBeVisible();
});

it('chooses grant types, and saves them in the order the server lists them', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`PATCH ${C}/c-bill`]: json(
        { ...BILLING, grant_types: ['authorization_code', 'refresh_token'] },
        200,
        { etag: '"b2"' },
      ),
    }),
  );
  await open();
  const section = screen.getByRole('region', { name: 'Grant types' });
  await user.click(within(section).getByRole('checkbox', { name: /Refresh token/u }));
  await user.click(within(section).getByRole('button', { name: 'Save Grant types' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')).toMatchObject({
      ifMatch: '"c-bill-1"',
      body: { grant_types: ['authorization_code', 'refresh_token'] },
    });
  });
});

it('keeps client credentials from a public client, naming why', async () => {
  renderConsoleAt('/console/acme/clients/c-portal?tab=tokens', clientRoutes());
  const section = await screen.findByRole('region', { name: 'Grant types' });
  const option = within(section).getByRole('checkbox', { name: /Client credentials/u });
  expect(option).toBeDisabled();
  expect(option).toHaveAccessibleDescription(/no secret/u);
});

it('holds the grants back while a client with no redirect URI would hold more than client credentials', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, clientRoutes(undefined, answering({ redirect_uris: [] })));
  await open();
  const section = screen.getByRole('region', { name: 'Grant types' });
  await user.click(within(section).getByRole('checkbox', { name: /Refresh token/u }));
  expect(within(section).getByRole('button', { name: 'Save Grant types' })).toBeDisabled();
  expect(within(section).getByText(/no redirect URI/u)).toBeVisible();
});

it('edits the scopes client credentials may carry, counted against the limit', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`PATCH ${C}/c-bill`]: json(
        { ...BILLING, client_credentials_scopes: ['reports:read'] },
        200,
        {
          etag: '"b2"',
        },
      ),
    }),
  );
  await open();
  const section = screen.getByRole('region', { name: 'Client credentials' });
  expect(within(section).getByText(/0 of 200 scope names\./u)).toBeVisible();
  await user.click(within(section).getByRole('button', { name: 'Add scope name' }));
  await user.type(within(section).getByRole('textbox', { name: 'Scope name 1' }), 'reports:read');
  await user.click(within(section).getByRole('button', { name: 'Save Client credentials' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toEqual({
      client_credentials_scopes: ['reports:read'],
    });
  });
});

it('turns on every role in a token, on its own save', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`PATCH ${C}/c-bill`]: json({ ...BILLING, full_scope_allowed: true }, 200, { etag: '"b2"' }),
    }),
  );
  await open();
  const section = screen.getByRole('region', { name: 'Roles in tokens' });
  await user.click(
    within(section).getByRole('switch', { name: 'Carry every role the subject holds' }),
  );
  await user.click(within(section).getByRole('button', { name: 'Save Roles in tokens' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toEqual({ full_scope_allowed: true });
  });
});

it('saves the ID token algorithm, maximum age and auth_time together, a default sent as null', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`PATCH ${C}/c-bill`]: json(
        {
          ...BILLING,
          id_token_signed_response_alg: 'ES256',
          default_max_age: 3600,
          require_auth_time: true,
        },
        200,
        { etag: '"b2"' },
      ),
    }),
  );
  await open();
  const section = screen.getByRole('region', { name: 'ID token' });
  await user.click(within(section).getByRole('button', { name: /ID token signing algorithm/u }));
  await user.click(await screen.findByRole('option', { name: 'ES256' }));
  await user.click(within(section).getByRole('switch', { name: 'No default' }));
  expect(
    within(section).getByRole('textbox', {
      name: 'Default maximum authentication age, in seconds',
    }),
  ).toHaveValue('3600');
  await user.click(within(section).getByRole('switch', { name: 'Include auth_time' }));
  await user.click(within(section).getByRole('button', { name: 'Save ID token' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toEqual({
      id_token_signed_response_alg: 'ES256',
      default_max_age: 3600,
      require_auth_time: true,
    });
  });
});

it("sends the tenant's own signing key as null", async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      ...answering({ id_token_signed_response_alg: 'RS256' }),
      [`PATCH ${C}/c-bill`]: json({ ...BILLING }, 200, { etag: '"b2"' }),
    }),
  );
  await open();
  const section = screen.getByRole('region', { name: 'ID token' });
  await user.click(within(section).getByRole('button', { name: /ID token signing algorithm/u }));
  await user.click(await screen.findByRole('option', { name: "The tenant's active signing key" }));
  await user.click(within(section).getByRole('button', { name: 'Save ID token' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toMatchObject({
      id_token_signed_response_alg: null,
    });
  });
});

it('shows every field as text when the service account holds what the caller does not', async () => {
  renderConsoleAt(
    AT,
    clientRoutes(['manage-clients'], answering({ service_account_admin_reach: ['manage-users'] })),
  );
  const section = await screen.findByRole('region', { name: 'Token lifetimes' });
  expect(within(section).queryByRole('textbox')).toBeNull();
  expect(within(section).queryByRole('switch')).toBeNull();
  expect(screen.queryByRole('button', { name: /^Save/u })).toBeNull();
  expect(within(section).getAllByText(/Takes the tenant's/u, { selector: 'dd' })).toHaveLength(3);
});

it('passes axe in both themes, editable and as text', async () => {
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
          clientRoutes(
            ['manage-clients'],
            answering({ service_account_admin_reach: ['manage-users'] }),
          ),
        ).element,
      () => screen.findByText(/service account holds manage-users/u),
    ),
  ).toEqual({ light: [], dark: [] });
});

it('reads the client again, and nothing else, for the section it saved', async () => {
  const { sent } = renderConsoleAt(AT, clientRoutes());
  await open();
  expect(sent.every((s) => s.method === 'GET')).toBe(true);
  expect(sent.some((s) => s.path === `${A}/whoami`)).toBe(true);
});
