import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { A, BILLING, C, clientRoutes } from '#/testing/clientsFixtures.ts';
import { json, problem } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/clients/c-bill?tab=sessions';
const SESSIONS = `${C}/c-bill/sessions`;
const GRANTS = `${C}/c-bill/grants`;

function session(id: string, subject: string, username: string | null) {
  return {
    id,
    subject_id: subject,
    username,
    created_at: '2026-09-28T08:41:53.858Z',
    last_active_at: '2026-09-28T09:41:53.858Z',
    remembered: id === 's-2',
    client_ids: ['billing'],
  };
}

function sessionRoutes(extra = {}, capabilities?: readonly string[]) {
  return clientRoutes(capabilities, {
    [`GET ${SESSIONS}`]: json({
      items: [session('s-1', 'u-1', 'ada'), session('s-2', 'u-2', null)],
    }),
    [`GET ${A}/sessions/count`]: json({ count: 2, capped: false }),
    ...extra,
  });
}

const listing = sessionRoutes;

async function open(): Promise<void> {
  await screen.findByRole('grid', { name: 'Sessions through Billing' });
}

it('lists who is signed in through the client, counted, a subject with no username by its id', async () => {
  const { sent } = renderConsoleAt(AT, listing());
  await open();
  const table = screen.getByRole('grid', { name: 'Sessions through Billing' });
  expect(within(table).getByText('ada')).toBeVisible();
  expect(within(table).getByText('u-2')).toBeVisible();
  expect(await screen.findByText('2 sessions')).toBeVisible();
  expect(sent.find((s) => s.path === `${A}/sessions/count`)?.search.get('client')).toBe('c-bill');
});

it("opens a session's subject", async () => {
  const user = userEvent.setup();
  const { router } = renderConsoleAt(AT, listing());
  await open();
  await user.click(screen.getByRole('row', { name: /ada/u }));
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/acme/subjects/u-1');
  });
});

it('says nobody is signed in through a client with no session', async () => {
  renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`GET ${SESSIONS}`]: json({ items: [] }),
      [`GET ${A}/sessions/count`]: json({ count: 0, capped: false }),
    }),
  );
  expect(await screen.findByText('Nobody is signed in through this client.')).toBeVisible();
});

it('revokes every token only once the client ID is typed, and says what it did', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    listing({
      [`DELETE ${GRANTS}`]: json({ revoked: 12, beyond_ceiling: 1, remaining: 0 }),
    }),
  );
  await open();
  await user.click(screen.getByRole('button', { name: 'Revoke every token of Billing' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Revoke every token of Billing?' });
  const confirm = within(dialog).getByRole('button', { name: 'Revoke every token' });
  expect(confirm).toBeDisabled();
  await user.type(within(dialog).getByRole('textbox'), 'billing');
  await user.click(confirm);
  expect(
    await screen.findByText(
      '12 grants of Billing revoked. 1 left alone, their subjects holding an admin capability you do not.',
    ),
  ).toBeVisible();
  expect(sent.filter((s) => s.method === 'DELETE')).toHaveLength(1);
});

it('says more remain when one call was not all of them', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    listing({ [`DELETE ${GRANTS}`]: json({ revoked: 10000, beyond_ceiling: 0, remaining: 30 }) }),
  );
  await open();
  await user.click(screen.getByRole('button', { name: 'Revoke every token of Billing' }));
  const dialog = await screen.findByRole('alertdialog');
  await user.type(within(dialog).getByRole('textbox'), 'billing');
  await user.click(within(dialog).getByRole('button', { name: 'Revoke every token' }));
  expect(await screen.findByText(/30 more remain\. Revoke again to continue\./u)).toBeVisible();
});

it("keeps the dialog open with the server's refusal beside the action", async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    listing({
      [`DELETE ${GRANTS}`]: problem(403, 'about:blank', 'Forbidden', {
        detail: "the client's service account holds what the caller does not: manage-users",
      }),
    }),
  );
  await open();
  await user.click(screen.getByRole('button', { name: 'Revoke every token of Billing' }));
  const dialog = await screen.findByRole('alertdialog');
  await user.type(within(dialog).getByRole('textbox'), 'billing');
  await user.click(within(dialog).getByRole('button', { name: 'Revoke every token' }));
  expect(
    await within(dialog).findByText(/service account holds what the caller does not/u),
  ).toBeVisible();
});

it('lists the sessions and offers no revocation while the service account holds what the caller does not', async () => {
  renderConsoleAt(
    AT,
    listing(
      {
        [`GET ${C}/c-bill`]: json(
          { ...BILLING, service_account_admin_reach: ['manage-keys'] },
          200,
          { etag: '"c-bill-1"' },
        ),
      },
      ['manage-clients', 'manage-sessions'],
    ),
  );
  await open();
  expect(screen.queryByRole('button', { name: /^Revoke every token/u })).toBeNull();
});

it('needs manage-sessions, and says so in place of the sessions', async () => {
  const { sent } = renderConsoleAt(AT, listing({}, ['manage-clients']));
  expect(await screen.findByRole('note')).toHaveTextContent(
    'Sessions needs the manage-sessions capability.',
  );
  expect(sent.some((s) => s.path === SESSIONS)).toBe(false);
});

it('passes axe in both themes, listed and asking', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, listing()).element,
      () => open(),
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, listing()).element,
      async () => {
        await open();
        await userEvent
          .setup()
          .click(screen.getByRole('button', { name: 'Revoke every token of Billing' }));
        await screen.findByRole('alertdialog');
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
