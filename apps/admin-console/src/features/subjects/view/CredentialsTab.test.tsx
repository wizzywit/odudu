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
  await user.click(within(table).getByRole('button', { name: 'Remove Authenticator app (TOTP)' }));
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

it('says in the dialog why a removal was refused', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    subjectRoutes(undefined, {
      [`GET ${C}/credentials`]: json(HELD),
      [`DELETE ${C}/credentials/c-key`]: problem(403, 'about:blank', 'Forbidden'),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Remove Passkey' }));
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
  expect(screen.getByRole('note')).toHaveTextContent(/manage-users/u);
  expect(screen.queryByRole('button', { name: /Issue|Remove|Revoke|Clear/u })).toBeNull();
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
