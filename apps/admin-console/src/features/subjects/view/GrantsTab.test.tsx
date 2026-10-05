import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { inTurn, json } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';
import { ADA_AT, ADA_ID, S, subjectRoutes } from '#/testing/subjectsFixtures.ts';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = `${ADA_AT}?tab=grants`;
const G = `${S}/${ADA_ID}/grants`;

function grant(id: string, offline: boolean) {
  return {
    id,
    client_id: 'c-billing',
    client_key: 'billing',
    scope: offline ? 'openid offline_access' : 'openid',
    created_at: '2026-09-28T08:00:00.000Z',
    session_id: offline ? null : 'x1',
    offline,
    refresh_expires_at: offline ? '2026-10-28T08:00:00.000Z' : null,
  };
}

it("lists the grants, and revokes a client's after a confirmation", async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    subjectRoutes(undefined, {
      [`GET ${G}`]: inTurn(
        json({ items: [grant('g1', false), grant('g2', true)] }),
        json({ items: [] }),
      ),
      [`DELETE ${G}/c-billing`]: json({ revoked: 2 }),
    }),
  );
  const table = await screen.findByRole('grid', { name: 'Grants ada holds' });
  expect(within(table).getAllByRole('row')).toHaveLength(3);
  expect(within(table).getAllByRole('row')[2]).toHaveTextContent('offline');
  await user.click(screen.getByRole('button', { name: 'Revoke every grant through billing' }));
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Revoke ada’s grants through billing?',
  });
  expect(dialog).toHaveTextContent(/The consent stays/u);
  await user.click(within(dialog).getByRole('button', { name: 'Revoke grants' }));
  await waitFor(() => {
    expect(sent.some((s) => s.method === 'DELETE' && s.path === `${G}/c-billing`)).toBe(true);
  });
  expect(await screen.findByText('2 grants of ada through billing revoked.')).toBeVisible();
});

it('names manage-sessions to an operator without it', async () => {
  renderConsoleAt(AT, subjectRoutes(['view-users', 'manage-users']));
  expect(await screen.findByText(/Grants needs the/u)).toHaveTextContent(
    'Grants needs the manage-sessions capability.',
  );
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () =>
        consoleAt(
          AT,
          subjectRoutes(undefined, { [`GET ${G}`]: json({ items: [grant('g1', true)] }) }),
        ).element,
      () => screen.findByRole('grid', { name: 'Grants ada holds' }),
    ),
  ).toEqual({ light: [], dark: [] });
});
