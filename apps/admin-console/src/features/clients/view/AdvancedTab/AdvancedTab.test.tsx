import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { BILLING, C, clientRoutes } from '#/testing/clientsFixtures.ts';
import { json, problem } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/clients/c-bill?tab=advanced';
const SECRET = 'rotated-secret-0123456789';

async function open(): Promise<void> {
  await screen.findByRole('region', { name: 'Client authentication' });
  await screen.findByRole('button', { name: /Authentication method/u });
}
function patching(extra: Record<string, unknown>) {
  return clientRoutes(undefined, {
    [`PATCH ${C}/c-bill`]: json({ ...BILLING, ...extra }, 200, { etag: '"b2"' }),
  });
}

it('offers a confidential client every method but none, and a certificate subject for tls_client_auth', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, patching({ token_endpoint_auth_method: 'tls_client_auth' }));
  await open();
  const section = screen.getByRole('region', { name: 'Client authentication' });
  expect(within(section).queryByRole('textbox', { name: 'Certificate subject' })).toBeNull();
  await user.click(within(section).getByRole('button', { name: /Authentication method/u }));
  expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
    'Secret in a Basic header',
    'Secret in the request body',
    'Signed assertion (private_key_jwt)',
    'Client certificate (tls_client_auth)',
  ]);
  await user.click(screen.getByRole('option', { name: 'Client certificate (tls_client_auth)' }));
  await user.type(
    within(section).getByRole('textbox', { name: 'Certificate subject' }),
    'CN=billing,O=Example',
  );
  await user.click(within(section).getByRole('button', { name: 'Save Client authentication' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')).toMatchObject({
      ifMatch: '"c-bill-1"',
      body: {
        token_endpoint_auth_method: 'tls_client_auth',
        tls_client_auth_subject_dn: 'CN=billing,O=Example',
      },
    });
  });
});

it("shows the server's refusal of tls_client_auth under the method, in its words", async () => {
  const user = userEvent.setup();
  const refusal = 'tls_client_auth is unavailable: ODUDU_TRUST_PROXY is off on this deployment';
  renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`PATCH ${C}/c-bill`]: problem(400, 'about:blank', 'Bad Request', {
        detail: refusal,
        errors: [{ path: 'token_endpoint_auth_method', message: refusal }],
      }),
    }),
  );
  await open();
  const section = screen.getByRole('region', { name: 'Client authentication' });
  await user.click(within(section).getByRole('button', { name: /Authentication method/u }));
  await user.click(
    await screen.findByRole('option', { name: 'Client certificate (tls_client_auth)' }),
  );
  await user.type(within(section).getByRole('textbox', { name: 'Certificate subject' }), 'CN=a');
  await user.click(within(section).getByRole('button', { name: 'Save Client authentication' }));
  expect(await within(section).findByText(refusal)).toBeVisible();
});

it('says a public client authenticates with nothing, and offers no method and no secret', async () => {
  renderConsoleAt('/console/acme/clients/c-portal?tab=advanced', clientRoutes());
  expect(await screen.findByText(/A public client authenticates with nothing/u)).toBeVisible();
  expect(screen.queryByRole('button', { name: /Authentication method/u })).toBeNull();
  expect(screen.getByText('A public client has no secret to rotate.')).toBeVisible();
  expect(screen.queryByRole('button', { name: /^Rotate the secret/u })).toBeNull();
});

it('publishes a key set pasted here, and clears the address with it', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, patching({ jwks: { keys: [] } }));
  await open();
  const section = screen.getByRole('region', { name: 'Client keys' });
  await user.click(within(section).getByRole('button', { name: /Key source/u }));
  await user.click(await screen.findByRole('option', { name: 'A key set pasted here' }));
  const box = within(section).getByRole('textbox', { name: 'Key set' });
  await user.click(box);
  await user.paste('{"keys":[{"kty":"RSA","n":"abc","e":"AQAB"}]}');
  await user.click(within(section).getByRole('button', { name: 'Save Client keys' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toEqual({
      jwks: { keys: [{ kty: 'RSA', n: 'abc', e: 'AQAB' }] },
      jwks_uri: null,
    });
  });
});

it("refuses a key set carrying a private member, with the server's reason in the field", async () => {
  const user = userEvent.setup();
  const reason = 'jwks.keys[0] carries the private member d; register public keys only';
  const { sent } = renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`PATCH ${C}/c-bill`]: problem(400, 'about:blank', 'Bad Request', {
        detail: reason,
        errors: [{ path: 'jwks', message: reason }],
      }),
    }),
  );
  await open();
  const section = screen.getByRole('region', { name: 'Client keys' });
  await user.click(within(section).getByRole('button', { name: /Key source/u }));
  await user.click(await screen.findByRole('option', { name: 'A key set pasted here' }));
  const box = within(section).getByRole('textbox', { name: 'Key set' });
  await user.click(box);
  await user.paste('{"keys":[{"kty":"RSA","n":"abc","e":"AQAB","d":"private"}]}');
  await user.click(within(section).getByRole('button', { name: 'Save Client keys' }));
  expect(await within(section).findByText(reason)).toBeVisible();
  expect(box).toHaveAccessibleDescription(expect.stringContaining(reason));
  expect(box).toHaveAttribute('aria-invalid', 'true');
  expect(box).toHaveValue('{"keys":[{"kty":"RSA","n":"abc","e":"AQAB","d":"private"}]}');
  expect(sent.filter((s) => s.method === 'PATCH')).toHaveLength(1);
});

it('holds a pasted key set that is not JSON back, beside the field, without asking the server', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, clientRoutes());
  await open();
  const section = screen.getByRole('region', { name: 'Client keys' });
  await user.click(within(section).getByRole('button', { name: /Key source/u }));
  await user.click(await screen.findByRole('option', { name: 'A key set pasted here' }));
  await user.click(within(section).getByRole('textbox', { name: 'Key set' }));
  await user.paste('{"keys":');
  expect(within(section).getByText('This is not valid JSON.')).toBeVisible();
  expect(within(section).getByRole('button', { name: 'Save Client keys' })).toBeDisabled();
  expect(sent.filter((s) => s.method === 'PATCH')).toHaveLength(0);
});

it('publishes the keys by address, and clears a key set with it', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, patching({ jwks_uri: 'https://billing.example/jwks' }));
  await open();
  const section = screen.getByRole('region', { name: 'Client keys' });
  await user.click(within(section).getByRole('button', { name: /Key source/u }));
  await user.click(await screen.findByRole('option', { name: 'A JWKS URI' }));
  await user.type(
    within(section).getByRole('textbox', { name: 'JWKS URI' }),
    'https://billing.example/jwks',
  );
  await user.click(within(section).getByRole('button', { name: 'Save Client keys' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toEqual({
      jwks: null,
      jwks_uri: 'https://billing.example/jwks',
    });
  });
});

it('signs and encrypts the UserInfo response, the content encryption going with its algorithm', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, patching({ userinfo_signed_response_alg: 'ES256' }));
  await open();
  const section = screen.getByRole('region', { name: 'UserInfo response' });
  expect(within(section).queryByRole('button', { name: /Content encryption/u })).toBeNull();
  await user.click(within(section).getByRole('button', { name: /Signing algorithm/u }));
  await user.click(await screen.findByRole('option', { name: 'ES256' }));
  await user.click(within(section).getByRole('button', { name: /Encryption algorithm/u }));
  await user.click(await screen.findByRole('option', { name: 'ECDH-ES' }));
  await user.click(within(section).getByRole('button', { name: /Content encryption/u }));
  await user.click(await screen.findByRole('option', { name: 'A256GCM' }));
  await user.click(within(section).getByRole('button', { name: 'Save UserInfo response' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toEqual({
      userinfo_signed_response_alg: 'ES256',
      userinfo_encrypted_response_alg: 'ECDH-ES',
      userinfo_encrypted_response_enc: 'A256GCM',
    });
  });
});

it('edits the audiences, counted against the limit', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, patching({ audiences: ['https://api.example'] }));
  await open();
  const section = screen.getByRole('region', { name: 'Audiences' });
  expect(within(section).getByText(/0 of 200 audiences\./u)).toBeVisible();
  await user.click(within(section).getByRole('button', { name: 'Add audience' }));
  await user.type(
    within(section).getByRole('textbox', { name: 'Audience 1' }),
    'https://api.example',
  );
  await user.click(within(section).getByRole('button', { name: 'Save Audiences' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toEqual({
      audiences: ['https://api.example'],
    });
  });
});

it('allows impersonation in token exchange on its own save', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, patching({ token_exchange_impersonation_allowed: true }));
  await open();
  const section = screen.getByRole('region', { name: 'Token exchange' });
  await user.click(
    within(section).getByRole('switch', { name: 'Allow impersonation in token exchange' }),
  );
  await user.click(within(section).getByRole('button', { name: 'Save Token exchange' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toEqual({
      token_exchange_impersonation_allowed: true,
    });
  });
});

it('rotates the secret behind a confirmation, shows it once, and nowhere after', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`POST ${C}/c-bill/secret`]: json({ ...BILLING, client_secret: SECRET }),
    }),
  );
  await open();
  const section = screen.getByRole('region', { name: 'Client secret' });
  const grace = within(section).getByRole('textbox', { name: 'Grace period' });
  await user.clear(grace);
  await user.type(grace, '3600');
  await user.tab();
  expect(within(section).getByText('3600 s · 1 hour')).toBeVisible();
  await user.click(within(section).getByRole('button', { name: 'Rotate the secret of Billing' }));
  const confirm = await screen.findByRole('alertdialog', { name: 'Rotate the secret of Billing?' });
  expect(confirm).toHaveTextContent('keeps working for 3600 s · 1 hour, then stops');
  expect(sent.filter((s) => s.method === 'POST')).toHaveLength(0);
  await user.click(within(confirm).getByRole('button', { name: 'Rotate secret' }));
  const dialog = await screen.findByRole('dialog', { name: 'New client secret for Billing' });
  expect(dialog).toHaveTextContent(SECRET);
  expect(dialog).toHaveTextContent('previous secret keeps working for 3600 s · 1 hour');
  expect(sent.find((s) => s.method === 'POST')?.search.get('grace_seconds')).toBe('3600');
  await user.click(within(dialog).getByText(/^I have stored the client secret/u));
  await user.click(within(dialog).getByRole('button', { name: 'Close' }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(document.body.textContent).not.toContain(SECRET);
  expect(sessionStorage.length).toBe(0);
});

it('rotates with no grace, the previous secret ending at once', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`POST ${C}/c-bill/secret`]: json({ ...BILLING, client_secret: SECRET }),
    }),
  );
  await open();
  await user.click(screen.getByRole('button', { name: 'Rotate the secret of Billing' }));
  const confirm = await screen.findByRole('alertdialog');
  expect(confirm).toHaveTextContent('stops working at once');
  await user.click(within(confirm).getByRole('button', { name: 'Rotate secret' }));
  await screen.findByRole('dialog', { name: 'New client secret for Billing' });
  expect(sent.find((s) => s.method === 'POST')?.search.get('grace_seconds')).toBe('0');
});

it('says when the previous secret stops, once a rotation kept one', async () => {
  renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`GET ${C}/c-bill`]: json(
        { ...BILLING, previous_secret_expires_at: '2099-01-01T00:00:00.000Z' },
        200,
        { etag: '"c-bill-1"' },
      ),
    }),
  );
  await open();
  expect(await screen.findByText(/The previous secret authenticates until/u)).toBeVisible();
});

it('says what a refused rotation was, and shows no secret', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`POST ${C}/c-bill/secret`]: problem(409, 'about:blank', 'Conflict', { detail: 'no' }),
    }),
  );
  await open();
  await user.click(screen.getByRole('button', { name: 'Rotate the secret of Billing' }));
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Rotate secret' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The secret of Billing was not rotated: no',
  );
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('states what is fixed by design as text', async () => {
  renderConsoleAt(AT, clientRoutes());
  const section = await screen.findByRole('region', { name: 'Fixed by design' });
  expect(within(section).getByText('Response type')).toBeVisible();
  expect(within(section).getByText('code')).toBeVisible();
  expect(within(section).getByText('PKCE')).toBeVisible();
  expect(within(section).getByText('S256')).toBeVisible();
  expect(within(section).queryByRole('button')).toBeNull();
});

it('shows every field as text, and no rotation, when the service account holds what the caller does not', async () => {
  renderConsoleAt(
    AT,
    clientRoutes(['manage-clients'], {
      [`GET ${C}/c-bill`]: json(
        {
          ...BILLING,
          audiences: ['https://api.example'],
          service_account_admin_reach: ['manage-users'],
        },
        200,
        { etag: '"c-bill-1"' },
      ),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Audiences' });
  expect(within(section).getByText('https://api.example')).toBeVisible();
  expect(within(section).queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('button', { name: /^Rotate/u })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Client secret' })).toBeNull();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, clientRoutes()).element,
      () => open(),
    ),
  ).toEqual({ light: [], dark: [] });
});

it('passes axe in both themes with the secret shown, and with the confirmation asked', async () => {
  const routes = clientRoutes(undefined, {
    [`POST ${C}/c-bill/secret`]: json({ ...BILLING, client_secret: SECRET }),
  });
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, routes).element,
      async () => {
        await open();
        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: 'Rotate the secret of Billing' }));
        await screen.findByRole('alertdialog');
      },
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, routes).element,
      async () => {
        await open();
        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: 'Rotate the secret of Billing' }));
        await user.click(
          within(await screen.findByRole('alertdialog')).getByRole('button', {
            name: 'Rotate secret',
          }),
        );
        await screen.findByRole('dialog', { name: 'New client secret for Billing' });
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
