import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { draftsKept } from '#/testing/consoleState';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { inTurn, json, offline, problem } from '#/testing/fakeTransport';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { BILLING, C } from '#/testing/clientsFixtures';
import { emailRoutes, NO_SMTP, OWN_SMTP, SM, smtpAnswer } from '#/testing/settingsFixtures';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/email';

function relay() {
  return screen.findByRole('region', { name: 'Mail relay' });
}

function sentPut(sent: readonly { method: string; body: unknown }[]) {
  return sent.find((s) => s.method === 'PUT')?.body as Record<string, unknown> | undefined;
}

it('says whose relay the mail goes through, and shows the stored relay without its password', async () => {
  renderConsoleAt(AT, emailRoutes());
  const form = await relay();
  expect(await screen.findByText(/sends its mail through its own relay/u)).toBeVisible();
  expect(within(form).getByRole('textbox', { name: 'Host' })).toHaveValue('smtp.example');
  expect(within(form).getByRole('textbox', { name: 'Port' })).toHaveValue('587');
  expect(within(form).getByRole('textbox', { name: 'Sender address' })).toHaveValue(
    'noreply@example',
  );
  expect(within(form).getByRole('textbox', { name: 'Username' })).toHaveValue('mailer');
  const password = within(form).getByLabelText('New password');
  expect(password).toHaveValue('');
  expect(within(form).getByText(/A password is stored and never shown/u)).toBeVisible();
});

it('keeps the stored password when another field is saved: the password is left out', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    emailRoutes(undefined, {
      [`PUT ${SM}`]: smtpAnswer({ ...OWN_SMTP, from_address: 'ops@example' }, '"m2"'),
    }),
  );
  const form = await relay();
  const sender = within(form).getByRole('textbox', { name: 'Sender address' });
  await user.clear(sender);
  await user.type(sender, 'ops@example');
  await user.click(within(form).getByRole('button', { name: 'Save Mail relay' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PUT')?.ifMatch).toBe('"m1"');
  });
  const body = sentPut(sent);
  expect(body).toMatchObject({ host: 'smtp.example', port: 587, from_address: 'ops@example' });
  expect(Object.hasOwn(body ?? {}, 'password')).toBe(false);
});

it('replaces the password with the one typed, which is never shown again', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    emailRoutes(undefined, { [`PUT ${SM}`]: smtpAnswer(OWN_SMTP, '"m2"') }),
  );
  const form = await relay();
  await user.type(within(form).getByLabelText('New password'), 'n3w-secret');
  await user.click(within(form).getByRole('button', { name: 'Save Mail relay' }));
  await waitFor(() => {
    expect(sentPut(sent)?.password).toBe('n3w-secret');
  });
  await waitFor(() => {
    expect(within(form).getByLabelText('New password')).toHaveValue('');
  });
  expect(document.body.innerHTML).not.toContain('n3w-secret');
});

it('clears the stored password by sending null', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    emailRoutes(undefined, {
      [`PUT ${SM}`]: smtpAnswer({ ...OWN_SMTP, password_set: false }, '"m2"'),
    }),
  );
  const form = await relay();
  await user.click(within(form).getByRole('switch', { name: 'Remove the stored password' }));
  expect(within(form).getByLabelText('New password')).toBeDisabled();
  await user.click(within(form).getByRole('button', { name: 'Save Mail relay' }));
  await waitFor(() => {
    expect(sentPut(sent)).toHaveProperty('password', null);
  });
});

it('keeps an edit as a draft but never the password typed beside it', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, emailRoutes());
  const form = await relay();
  const host = within(form).getByRole('textbox', { name: 'Host' });
  await user.clear(host);
  await user.type(host, 'draft.example');
  await user.type(within(form).getByLabelText('New password'), 'typed-secret');
  // What a session ending mid-edit keeps.
  const { sections, stored: kept } = draftsKept('s1');
  expect(sections).toBe(1);
  expect(kept).toContain('draft.example');
  expect(kept).not.toContain('typed-secret');
});

it('says a new host will not reuse the stored password, and puts the server’s refusal under it', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    emailRoutes(undefined, {
      [`PUT ${SM}`]: problem(400, 'about:blank', 'Bad Request', {
        detail: 'password must be sent again when host, port or username changes',
        errors: [
          { path: 'password', message: 'must be sent again when host, port or username changes' },
        ],
      }),
    }),
  );
  const form = await relay();
  const host = within(form).getByRole('textbox', { name: 'Host' });
  await user.clear(host);
  await user.type(host, 'other.example');
  expect(within(form).getByText(/only kept for the host, port and username/u)).toBeVisible();
  await user.click(within(form).getByRole('button', { name: 'Save Mail relay' }));
  expect(
    await within(form).findByText('must be sent again when host, port or username changes'),
  ).toBeVisible();
  expect(within(form).getByLabelText('New password')).toHaveAttribute('aria-invalid', 'true');
});

it('puts the refusal to send credentials in the clear under the TLS switch', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    emailRoutes(undefined, {
      [`PUT ${SM}`]: problem(400, 'about:blank', 'Bad Request', {
        errors: [
          { path: 'starttls', message: 'must be true when a username or password is configured' },
        ],
      }),
    }),
  );
  const form = await relay();
  await user.click(within(form).getByRole('switch', { name: 'Require TLS (STARTTLS)' }));
  await user.click(within(form).getByRole('button', { name: 'Save Mail relay' }));
  expect(
    await within(form).findByText('must be true when a username or password is configured'),
  ).toBeVisible();
});

it('holds Save, saying why, while the port is not one', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, emailRoutes());
  const form = await relay();
  const port = within(form).getByRole('textbox', { name: 'Port' });
  await user.clear(port);
  await user.type(port, '70000');
  const save = within(form).getByRole('button', { name: 'Save Mail relay' });
  expect(save).toBeDisabled();
  expect(within(form).getByText(/The port is not valid/u)).toBeVisible();
  expect(sent.some((s) => s.method === 'PUT')).toBe(false);
});

it('starts a tenant with no relay on the submission port, and offers no test and no removal', async () => {
  renderConsoleAt(AT, emailRoutes(undefined, { [`GET ${SM}`]: smtpAnswer(NO_SMTP) }));
  const form = await relay();
  expect(await screen.findByText(/only written to the server’s log/u)).toBeVisible();
  expect(within(form).getByRole('textbox', { name: 'Port' })).toHaveValue('587');
  expect(within(form).getByText(/Leave it empty if the relay needs none/u)).toBeVisible();
  const test = screen.getByRole('region', { name: 'Test message' });
  expect(within(test).getByRole('button', { name: 'Send test message' })).toBeDisabled();
  expect(within(test).getByText(/Save a relay of this tenant’s own first/u)).toBeVisible();
  expect(screen.queryByRole('region', { name: 'Remove the relay' })).toBeNull();
});

it('says the deployment’s sender is in use when the tenant has none of its own', async () => {
  renderConsoleAt(
    AT,
    emailRoutes(undefined, { [`GET ${SM}`]: smtpAnswer({ ...NO_SMTP, effective: 'deployment' }) }),
  );
  expect(await screen.findByText(/through the deployment’s sender/u)).toBeVisible();
});

it('sends a test message through the saved relay and says what the server answered', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    emailRoutes(undefined, { [`POST ${SM}/test`]: json({ sent: true }) }),
  );
  const test = await screen.findByRole('region', { name: 'Test message' });
  await user.type(within(test).getByRole('textbox', { name: 'Send to' }), 'a@b.example');
  await user.click(within(test).getByRole('button', { name: 'Send test message' }));
  expect(await within(test).findByRole('status')).toHaveTextContent(
    'The relay accepted a test message for a@b.example',
  );
  expect(sent.find((s) => s.method === 'POST')?.body).toEqual({
    to: 'a@b.example',
    client_id: 'c-admin',
  });
});

async function sendTestMessage(
  routes: ReturnType<typeof emailRoutes>,
  choose: (region: HTMLElement, user: ReturnType<typeof userEvent.setup>) => Promise<void> | void,
) {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, routes);
  const test = await screen.findByRole('region', { name: 'Test message' });
  await within(test).findByText(/Sent as Odudu admin|Sent in the tenant’s own look/u);
  await choose(test, user);
  await user.type(within(test).getByRole('textbox', { name: 'Send to' }), 'a@b.example');
  await user.click(within(test).getByRole('button', { name: 'Send test message' }));
  await within(test).findByText(/The relay accepted/u);
  return sent.find((s) => s.method === 'POST')?.body;
}

const SENT_OK = { [`POST ${SM}/test`]: json({ sent: true }) };

it('starts the test as the client the administrator signed in with, and says so', async () => {
  await sendTestMessage(emailRoutes(undefined, SENT_OK), async (test) => {
    expect(
      await within(test).findByText('Sent as Odudu admin, the client you signed in with.'),
    ).toBeVisible();
  });
});

it('sends the tenant’s own look, with no client, once that is chosen', async () => {
  const body = await sendTestMessage(emailRoutes(undefined, SENT_OK), async (test, user) => {
    await user.click(within(test).getByRole('button', { name: 'Use the tenant’s own look' }));
    expect(within(test).getByText('Sent in the tenant’s own look.')).toBeVisible();
  });
  expect(body).toEqual({ to: 'a@b.example' });
});

it('sends another client of the tenant once it is picked', async () => {
  const body = await sendTestMessage(emailRoutes(undefined, SENT_OK), async (test, user) => {
    await user.click(await within(test).findByRole('option', { name: /Billing/u }));
    expect(within(test).getByText('Sent as Billing.')).toBeVisible();
  });
  expect(body).toEqual({ to: 'a@b.example', client_id: 'c-bill' });
});

it('starts on the tenant’s own look when the list holds no console client', async () => {
  const body = await sendTestMessage(
    emailRoutes(undefined, { ...SENT_OK, [`GET ${C}`]: json({ items: [BILLING] }) }),
    () => undefined,
  );
  expect(body).toEqual({ to: 'a@b.example' });
});

it('sends no client, and says why the choice is closed, without the capability to read clients', async () => {
  const body = await sendTestMessage(
    emailRoutes(['manage-tenant'], {
      ...SENT_OK,
      [`GET ${C}`]: problem(403, 'about:blank', 'Forbidden'),
    }),
    async (test) => {
      expect(await within(test).findByText(/manage-clients/u)).toBeVisible();
    },
  );
  expect(body).toEqual({ to: 'a@b.example' });
});

it('shows the server’s reason when the test fails, and says unsaved edits are not used', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    emailRoutes(undefined, {
      [`POST ${SM}/test`]: problem(502, 'about:blank', 'Bad Gateway', {
        detail: 'connect ECONNREFUSED 10.1.1.1:587',
      }),
    }),
  );
  const form = await relay();
  await user.type(within(form).getByRole('textbox', { name: 'Username' }), 'x');
  const test = screen.getByRole('region', { name: 'Test message' });
  expect(within(test).getByText(/not the changes above/u)).toBeVisible();
  await user.type(within(test).getByRole('textbox', { name: 'Send to' }), 'a@b.example');
  await user.click(within(test).getByRole('button', { name: 'Send test message' }));
  expect(await within(test).findByRole('status')).toHaveTextContent(
    'Not sent. The relay failed: connect ECONNREFUSED 10.1.1.1:587.',
  );
});

it('does not send the test again after a lost answer', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, emailRoutes(undefined, { [`POST ${SM}/test`]: offline() }));
  const test = await screen.findByRole('region', { name: 'Test message' });
  await user.type(within(test).getByRole('textbox', { name: 'Send to' }), 'a@b.example');
  await user.click(within(test).getByRole('button', { name: 'Send test message' }));
  expect(await within(test).findByRole('status')).toHaveTextContent(/not been sent again/u);
  expect(sent.filter((s) => s.method === 'POST')).toHaveLength(1);
});

it('removes the relay after asking, then reads the page again', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    emailRoutes(undefined, {
      [`DELETE ${SM}`]: () => new Response(null, { status: 204 }),
      [`GET ${SM}`]: inTurn(
        smtpAnswer(),
        smtpAnswer({ ...NO_SMTP, effective: 'deployment' }, '"m2"'),
      ),
    }),
  );
  const zone = await screen.findByRole('region', { name: 'Remove the relay' });
  await user.click(within(zone).getByRole('button', { name: 'Remove the relay' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog).toHaveTextContent('deployment’s sender');
  expect(sent.some((s) => s.method === 'DELETE')).toBe(false);
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await user.click(within(zone).getByRole('button', { name: 'Remove the relay' }));
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: 'Remove the relay',
    }),
  );
  await waitFor(() => {
    expect(sent.filter((s) => s.method === 'DELETE')).toHaveLength(1);
  });
  expect(await screen.findByText(/through the deployment’s sender/u)).toBeVisible();
});

it('says the tenant already had no relay when the server finds none to remove', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    emailRoutes(undefined, { [`DELETE ${SM}`]: problem(404, 'about:blank', 'Not Found') }),
  );
  const zone = await screen.findByRole('region', { name: 'Remove the relay' });
  await user.click(within(zone).getByRole('button', { name: 'Remove the relay' }));
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: 'Remove the relay',
    }),
  );
  expect(await within(zone).findByRole('status')).toHaveTextContent(/already had none/u);
});

it('shows a 412 as another administrator’s change beside yours', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    emailRoutes(undefined, {
      [`PUT ${SM}`]: problem(412, 'about:blank', 'Precondition Failed'),
      [`GET ${SM}`]: inTurn(
        smtpAnswer(),
        smtpAnswer({ ...OWN_SMTP, from_address: 'else@example' }, '"m2"'),
      ),
    }),
  );
  const form = await relay();
  const sender = within(form).getByRole('textbox', { name: 'Sender address' });
  await user.clear(sender);
  await user.type(sender, 'ops@example');
  await user.click(within(form).getByRole('button', { name: 'Save Mail relay' }));
  expect(await within(form).findByRole('button', { name: /Keep mine/u })).toBeVisible();
});

it('names manage-tenant for a caller without it, and reads nothing', async () => {
  const { calls } = renderConsoleAt(AT, emailRoutes(['manage-clients']));
  expect(await screen.findByRole('note')).toHaveTextContent('manage-tenant');
  expect(calls.some((call) => call.path === SM)).toBe(false);
});

it('says the relay could not be loaded and offers to try again', async () => {
  renderConsoleAt(
    AT,
    emailRoutes(undefined, {
      [`GET ${SM}`]: json({ type: 'about:blank', title: 'x', status: 500 }, 500),
    }),
  );
  expect(await screen.findByRole('button', { name: 'Try again' })).toBeVisible();
});

it('passes axe in both themes, loaded, unconfigured, refused and after a test', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, emailRoutes()).element,
      () => relay(),
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, emailRoutes(undefined, { [`GET ${SM}`]: smtpAnswer(NO_SMTP) })).element,
      () => relay(),
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, emailRoutes(['manage-clients'])).element,
      () => screen.findByRole('note'),
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () =>
        consoleAt(
          AT,
          emailRoutes(undefined, {
            [`POST ${SM}/test`]: problem(400, 'about:blank', 'Bad Request', { detail: 'refused' }),
          }),
        ).element,
      async () => {
        const test = await screen.findByRole('region', { name: 'Test message' });
        await user.type(within(test).getByRole('textbox', { name: 'Send to' }), 'a@b.example');
        await user.click(within(test).getByRole('button', { name: 'Send test message' }));
        return within(test).findByRole('status');
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
