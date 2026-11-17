import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { inTurn, json } from '#/testing/fakeTransport';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { ADA_AT, ADA_ID, noContent, S, subject, subjectRoutes } from '#/testing/subjectsFixtures';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = `${ADA_AT}?tab=sessions`;
const X = `${S}/${ADA_ID}/sessions`;

const DEVICE = 'c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00';

function session(id: string, created: string, clients: string[] = ['billing']) {
  return {
    id,
    created_at: created,
    last_active_at: created,
    remembered: id === 'x2',
    client_ids: clients,
    device: id === 'x2' ? null : DEVICE,
  };
}

const ONE = session('x1', '2026-09-28T08:00:00.000Z');
const TWO = session('x2', '2026-09-28T09:00:00.000Z', []);

it('lists the live sessions, and ends one after a confirmation', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    subjectRoutes(undefined, {
      [`GET ${X}`]: inTurn(json({ items: [ONE, TWO] }), json({ items: [TWO] })),
      [`DELETE ${X}/x1`]: noContent(),
    }),
  );
  const table = await screen.findByRole('grid', { name: 'Live sessions of ada' });
  expect(within(table).getAllByRole('row')).toHaveLength(3);
  expect(within(table).getByRole('row', { name: /2026-09-28 08:00/u })).toHaveTextContent(
    'billing',
  );
  expect(within(table).getByRole('row', { name: /2026-09-28 08:00/u })).toHaveTextContent(
    'c0ffee00…',
  );
  expect(within(table).getByRole('row', { name: /2026-09-28 09:00/u })).toHaveTextContent('—');
  await user.click(
    within(table).getByRole('button', { name: 'End the session started 2026-09-28 08:00:00 UTC' }),
  );
  const dialog = await screen.findByRole('alertdialog', { name: 'End this session of ada?' });
  expect(dialog).toHaveTextContent(/revoked, and each client with a back-channel logout/u);
  await user.click(within(dialog).getByRole('button', { name: 'End session' }));
  await waitFor(() => {
    expect(sent.some((s) => s.method === 'DELETE' && s.path === `${X}/x1`)).toBe(true);
  });
  await waitFor(() => {
    expect(within(table).getAllByRole('row')).toHaveLength(2);
  });
});

it('ends every session at once, and says how many', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    subjectRoutes(undefined, {
      [`GET ${X}`]: inTurn(json({ items: [ONE, TWO] }), json({ items: [] })),
      [`DELETE ${X}`]: json({ ended: 2 }),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'End every session' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'End every session of ada?' });
  expect(dialog).toHaveTextContent(/offline_access/u);
  await user.click(within(dialog).getByRole('button', { name: 'End every session' }));
  expect(await screen.findByText('2 sessions of ada ended.')).toBeVisible();
});

it('says so when the sessions are your own', async () => {
  const user = userEvent.setup();
  const own = `${S}/s1`;
  renderConsoleAt(
    '/console/acme/subjects/s1?tab=sessions',
    subjectRoutes(undefined, {
      [`GET ${own}`]: json(subject('s1', 'grace'), 200, { etag: '"s1"' }),
      [`GET ${own}/sessions`]: json({ items: [ONE] }),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'End every session' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'End every session of your own?' });
  expect(dialog).toHaveTextContent(/The one this console signed you in through is among them/u);
});

it('names manage-sessions to an operator without it, and reads nothing', async () => {
  const { sent } = renderConsoleAt(AT, subjectRoutes(['view-users', 'manage-users']));
  expect(await screen.findByText(/Sessions needs the/u)).toHaveTextContent(
    'Sessions needs the manage-sessions capability.',
  );
  expect(sent.some((s) => s.path === X)).toBe(false);
});

it('passes axe in both themes', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () =>
        consoleAt(AT, subjectRoutes(undefined, { [`GET ${X}`]: json({ items: [ONE, TWO] }) }))
          .element,
      async () => {
        await user.click(await screen.findByRole('button', { name: 'End every session' }));
        await screen.findByRole('alertdialog');
      },
    ),
  ).toEqual({ light: [], dark: [] });
});

it('groups the sessions of one device together, with a count, and the ones with no device last', async () => {
  const other = { ...session('x3', '2026-09-28T10:00:00.000Z'), device: 'aa11aa11aa11aa11' };
  const stray = { ...session('x4', '2026-09-28T07:00:00.000Z'), device: null };
  renderConsoleAt(
    AT,
    subjectRoutes(undefined, {
      [`GET ${X}`]: json({ items: [ONE, stray, other, session('x5', '2026-09-28T11:00:00.000Z')] }),
    }),
  );
  const table = await screen.findByRole('grid', { name: 'Live sessions of ada' });
  const rows = within(table).getAllByRole('row').slice(1);
  expect(rows.map((row) => /2026-09-28 (\d\d:\d\d)/u.exec(row.textContent)?.[1])).toEqual([
    '08:00',
    '11:00',
    '10:00',
    '07:00',
  ]);
  expect(
    rows.map((row) => within(row).queryByText(/sessions? on this device/u)?.textContent),
  ).toEqual([
    '2 sessions on this device',
    '2 sessions on this device',
    '1 session on this device',
    undefined,
  ]);
});
