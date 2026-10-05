import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { inTurn, json, problem } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';
import {
  ADA_AT,
  ADA_ID,
  noContent,
  NOT_LOCKED,
  S,
  subject,
  subjectRoutes,
} from '#/testing/subjectsFixtures.ts';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = `${ADA_AT}?tab=credentials`;
const C = `${S}/${ADA_ID}`;
const PASSWORD = 'one-time-Qm9vYmFy';
const HELD = {
  items: [
    { id: 'c-pw', type: 'password', created_at: '2026-09-01T08:00:00.000Z', expired: false },
    { id: 'c-totp', type: 'totp', created_at: '2026-09-02T08:00:00.000Z' },
    { id: 'c-key', type: 'webauthn', created_at: '2026-09-03T08:00:00.000Z' },
    { type: 'recovery-code', created_at: '2026-09-04T08:00:00.000Z', recovery_code_count: 7 },
  ],
};
const LOCKED = {
  locked: true,
  locked_until: '2099-09-29T10:02:00.000Z',
  failure_count: 6,
  last_failure_at: '2026-09-29T09:59:00.000Z',
};

it('issues a one-time password after a confirmation, and shows it once', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    subjectRoutes(undefined, {
      [`GET ${C}/credentials`]: json(HELD),
      [`POST ${C}/password`]: json({ password: PASSWORD }, 201),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Issue a one-time password' }));
  const confirm = await screen.findByRole('alertdialog', {
    name: 'Issue ada a one-time password?',
  });
  expect(confirm).toHaveTextContent(/replaces the password ada has/u);
  await user.click(within(confirm).getByRole('button', { name: 'Issue password' }));
  const dialog = await screen.findByRole('dialog', { name: "ada's one-time password" });
  expect(within(dialog).getByText(PASSWORD)).toBeVisible();
  expect(sent.filter((s) => s.method === 'POST')).toHaveLength(1);
  await user.click(within(dialog).getByText(/I have stored the one-time password/u));
  await user.click(within(dialog).getByRole('button', { name: 'Close' }));
  await waitFor(() => {
    expect(screen.queryByText(PASSWORD)).toBeNull();
  });
});

it('lists the second factors, and removes one after a confirmation', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    subjectRoutes(undefined, {
      [`GET ${C}/credentials`]: json(HELD),
      [`DELETE ${C}/credentials/c-totp`]: noContent(),
    }),
  );
  const table = await screen.findByRole('grid', { name: 'Second factors of ada' });
  expect(within(table).getByRole('row', { name: /Authenticator app/u })).toBeVisible();
  expect(within(table).getByRole('row', { name: /Passkey/u })).toBeVisible();
  await user.click(
    within(table).getByRole('button', {
      name: 'Remove Authenticator app (TOTP) enrolled 2026-09-02 08:00:00 UTC',
    }),
  );
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Remove ada’s authenticator app (TOTP)?',
  });
  await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
  await waitFor(() => {
    expect(sent.some((s) => s.method === 'DELETE' && s.path === `${C}/credentials/c-totp`)).toBe(
      true,
    );
  });
});

it('counts the recovery codes, and revokes them all at once', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    subjectRoutes(undefined, {
      [`GET ${C}/credentials`]: inTurn(json(HELD), json({ items: HELD.items.slice(0, 3) })),
      [`DELETE ${C}/recovery-codes`]: noContent(),
    }),
  );
  expect(await screen.findByText('7 unspent recovery codes')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Revoke every recovery code' }));
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Revoke ada’s recovery codes?',
  });
  await user.click(within(dialog).getByRole('button', { name: 'Revoke recovery codes' }));
  await waitFor(() => {
    expect(sent.some((s) => s.method === 'DELETE' && s.path === `${C}/recovery-codes`)).toBe(true);
  });
  expect(await screen.findByText(/No recovery codes/u)).toBeVisible();
});

it('shows a lockout, and clears it after a confirmation', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    subjectRoutes(undefined, {
      [`GET ${C}/lockout`]: inTurn(json(LOCKED), json(NOT_LOCKED)),
      [`DELETE ${C}/lockout`]: noContent(),
    }),
  );
  expect(await screen.findByText(/Locked after 6 failed sign-ins/u)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Clear the lockout' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Clear ada’s lockout?' });
  await user.click(within(dialog).getByRole('button', { name: 'Clear lockout' }));
  await waitFor(() => {
    expect(sent.some((s) => s.method === 'DELETE' && s.path === `${C}/lockout`)).toBe(true);
  });
  expect(await screen.findByText('No failed sign-ins on record.')).toBeVisible();
});

it('says in its dialog why an issue was refused, and shows no secret', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    subjectRoutes(undefined, {
      [`POST ${C}/password`]: problem(403, 'about:blank', 'Forbidden'),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Issue a one-time password' }));
  const dialog = await screen.findByRole('alertdialog');
  await user.click(within(dialog).getByRole('button', { name: 'Issue password' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(/manage-users/u);
  expect(screen.queryByRole('dialog', { name: "ada's one-time password" })).toBeNull();
  await waitFor(() => {
    expect(sent.filter((s) => s.path.endsWith('/whoami')).length).toBeGreaterThan(1);
  });
});

it('names each Remove by its factor and when it was enrolled', async () => {
  renderConsoleAt(
    AT,
    subjectRoutes(undefined, {
      [`GET ${C}/credentials`]: json({
        items: [
          { id: 'k1', type: 'webauthn', created_at: '2026-09-03T08:00:00.000Z' },
          { id: 'k2', type: 'webauthn', created_at: '2026-09-05T09:30:00.000Z' },
        ],
      }),
    }),
  );
  const table = await screen.findByRole('grid', { name: 'Second factors of ada' });
  const names = within(table)
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label'));
  expect(names).toEqual([
    'Remove Passkey enrolled 2026-09-03 08:00:00 UTC',
    'Remove Passkey enrolled 2026-09-05 09:30:00 UTC',
  ]);
});

it('says in the dialog why a removal was refused', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    subjectRoutes(undefined, {
      [`GET ${C}/credentials`]: json(HELD),
      [`DELETE ${C}/credentials/c-key`]: problem(403, 'about:blank', 'Forbidden'),
    }),
  );
  await user.click(
    await screen.findByRole('button', { name: 'Remove Passkey enrolled 2026-09-03 08:00:00 UTC' }),
  );
  const dialog = await screen.findByRole('alertdialog');
  await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(/manage-users/u);
});

it('shows an operator who can only look every credential, and no action', async () => {
  renderConsoleAt(
    AT,
    subjectRoutes(['view-users'], {
      [`GET ${C}/credentials`]: json(HELD),
      [`GET ${C}/lockout`]: json(LOCKED),
    }),
  );
  expect(await screen.findByText('7 unspent recovery codes')).toBeVisible();
  expect(await screen.findByText(/Locked after 6 failed sign-ins/u)).toBeVisible();
  expect(screen.getByRole('note')).toHaveTextContent(
    'You can view subjects but not change them (needs manage-users).',
  );
  expect(
    screen.queryByRole('button', { name: /Issue|Remove|Revoke|Clear|Send|Email/u }),
  ).toBeNull();
});

it('says a service subject has no credentials of this kind', async () => {
  const bot = subject(ADA_ID, null, { type: 'service' });
  const { sent } = renderConsoleAt(
    AT,
    subjectRoutes(undefined, { [`GET ${S}/${ADA_ID}`]: json(bot, 200, { etag: '"b1"' }) }),
  );
  expect(await screen.findByText(/signs in as itself/u)).toBeVisible();
  expect(sent.some((s) => s.path === `${C}/lockout`)).toBe(false);
});

it('passes axe in both themes, with every credential held and the lockout on', async () => {
  expect(
    await axeInBothThemes(
      () =>
        consoleAt(
          AT,
          subjectRoutes(undefined, {
            [`GET ${C}/credentials`]: json(HELD),
            [`GET ${C}/lockout`]: json(LOCKED),
          }),
        ).element,
      () => screen.findByText('7 unspent recovery codes'),
    ),
  ).toEqual({ light: [], dark: [] });
});

it('passes axe in both themes, with the password shown once', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () =>
        consoleAt(
          AT,
          subjectRoutes(undefined, { [`POST ${C}/password`]: json({ password: PASSWORD }, 201) }),
        ).element,
      async () => {
        await user.click(await screen.findByRole('button', { name: 'Issue a one-time password' }));
        await user.click(await screen.findByRole('button', { name: 'Issue password' }));
        await screen.findByRole('dialog', { name: "ada's one-time password" });
      },
    ),
  ).toEqual({ light: [], dark: [] });
});

const accepted = () => () => new Response(null, { status: 202 });

it('offers the reset email first and the one-time password second, and sends the link', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    subjectRoutes(undefined, { [`POST ${C}/password-reset`]: accepted() }),
  );
  const password = await screen.findByRole('region', { name: 'Password' });
  const buttons = within(password)
    .getAllByRole('button')
    .map((button) => button.textContent);
  expect(buttons).toEqual(['Send a password reset email', 'Issue a one-time password']);
  await user.click(within(password).getByRole('button', { name: 'Send a password reset email' }));
  expect(
    await within(password).findByText('A password reset link was sent to ada@example.test.'),
  ).toBeVisible();
  expect(sent.filter((s) => s.method === 'POST')).toHaveLength(1);
});

it('offers only the one-time password to a subject with no email, and says why', async () => {
  renderConsoleAt(
    AT,
    subjectRoutes(undefined, {
      [`GET ${S}/${ADA_ID}`]: json(subject(ADA_ID, 'ada', { email: null }), 200, { etag: '"s1"' }),
    }),
  );
  const password = await screen.findByRole('region', { name: 'Password' });
  expect(within(password).getByText(/ada has no email address, so no reset link/u)).toBeVisible();
  expect(within(password).queryByRole('button', { name: /reset email/u })).toBeNull();
  const mail = screen.getByRole('region', { name: 'Email' });
  expect(within(mail).queryByRole('button')).toBeNull();
});

it('explains in place a mail the tenant could not send, and where that is put right', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    subjectRoutes(undefined, {
      [`POST ${C}/verification`]: problem(409, 'about:blank#no-mail-relay', 'Conflict'),
      [`POST ${C}/password-reset`]: problem(409, 'about:blank#reset-password-off', 'Conflict'),
    }),
  );
  const mail = await screen.findByRole('region', { name: 'Email' });
  await user.click(within(mail).getByRole('button', { name: 'Send a verification email' }));
  expect(await within(mail).findByText(/the mail would only be logged/u)).toBeVisible();
  expect(within(mail).getByRole('link', { name: 'Email' })).toHaveAttribute(
    'href',
    '/console/acme/email',
  );
  const password = screen.getByRole('region', { name: 'Password' });
  await user.click(within(password).getByRole('button', { name: 'Send a password reset email' }));
  expect(await within(password).findByText(/Password reset is off/u)).toBeVisible();
  expect(within(password).getByRole('link', { name: 'Settings' })).toHaveAttribute(
    'href',
    '/console/acme/settings',
  );
});

it('emails a link through chosen required actions, with an optional way back', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    subjectRoutes(undefined, {
      [`POST ${C}/actions-email`]: inTurn(
        problem(400, 'about:blank', 'Bad Request', {
          detail: 'redirect_uri: is not a redirect URI the named client registered',
          errors: [
            { path: 'redirect_uri', message: 'is not a redirect URI the named client registered' },
          ],
        }),
        accepted(),
      ),
    }),
  );
  const mail = await screen.findByRole('region', { name: 'Email' });
  const send = within(mail).getByRole('button', { name: 'Email required actions' });
  await user.click(send);
  expect(await within(mail).findByText('Choose at least one action.')).toBeVisible();
  await user.click(within(mail).getByRole('checkbox', { name: 'Set up an authenticator app' }));
  await user.type(within(mail).getByRole('textbox', { name: 'Return to client' }), 'billing');
  await user.type(
    within(mail).getByRole('textbox', { name: 'Return to address' }),
    'https://evil.example/cb',
  );
  await user.click(send);
  expect(
    await within(mail).findByText('is not a redirect URI the named client registered'),
  ).toBeVisible();
  await user.clear(within(mail).getByRole('textbox', { name: 'Return to address' }));
  await user.type(
    within(mail).getByRole('textbox', { name: 'Return to address' }),
    'https://billing.example/cb',
  );
  await user.click(send);
  expect(await within(mail).findByText(/A link through 1 action was sent/u)).toBeVisible();
  expect(sent.filter((s) => s.path === `${C}/actions-email`).map((s) => s.body)).toEqual([
    {
      actions: ['configure-totp'],
      client_id: 'billing',
      redirect_uri: 'https://evil.example/cb',
    },
    {
      actions: ['configure-totp'],
      client_id: 'billing',
      redirect_uri: 'https://billing.example/cb',
    },
  ]);
});

it('passes axe in both themes, with a mail refused', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () =>
        consoleAt(
          AT,
          subjectRoutes(undefined, {
            [`POST ${C}/verification`]: problem(409, 'about:blank#no-email', 'Conflict'),
          }),
        ).element,
      async () => {
        const mail = await screen.findByRole('region', { name: 'Email' });
        await user.click(within(mail).getByRole('button', { name: 'Send a verification email' }));
        await within(mail).findByText(/Add one under Profile first/u);
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
