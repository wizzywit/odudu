import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { inTurn, json } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';
import { ADA_AT, ADA_ID, noContent, S, subjectRoutes } from '#/testing/subjectsFixtures.ts';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = `${ADA_AT}?tab=consents`;
const C = `${S}/${ADA_ID}/consents`;
const CONSENT = {
  client_id: 'c-billing',
  client_key: 'billing',
  scope_names: ['openid', 'profile'],
  granted_at: '2026-09-28T08:00:00.000Z',
};

it('lists consents, and revokes one, saying its grants go with it', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    subjectRoutes(undefined, {
      [`GET ${C}`]: inTurn(json({ items: [CONSENT] }), json({ items: [] })),
      [`DELETE ${C}/c-billing`]: noContent(),
    }),
  );
  const table = await screen.findByRole('grid', { name: 'Consents ada has given' });
  expect(within(table).getByRole('row', { name: /billing/u })).toHaveTextContent('openid profile');
  await user.click(within(table).getByRole('button', { name: 'Revoke the consent to billing' }));
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Revoke ada’s consent to billing?',
  });
  expect(dialog).toHaveTextContent(/every grant issued under it is revoked too/u);
  await user.click(within(dialog).getByRole('button', { name: 'Revoke consent' }));
  await waitFor(() => {
    expect(sent.some((s) => s.method === 'DELETE' && s.path === `${C}/c-billing`)).toBe(true);
  });
  expect(await screen.findByText(/ada has given no consent/u)).toBeVisible();
});

it('offers a limited operator no revoke', async () => {
  renderConsoleAt(AT, subjectRoutes(['view-users'], { [`GET ${C}`]: json({ items: [CONSENT] }) }));
  await screen.findByRole('grid', { name: 'Consents ada has given' });
  expect(screen.queryByRole('button', { name: /Revoke/u })).toBeNull();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () =>
        consoleAt(AT, subjectRoutes(undefined, { [`GET ${C}`]: json({ items: [CONSENT] }) }))
          .element,
      () => screen.findByRole('grid', { name: 'Consents ada has given' }),
    ),
  ).toEqual({ light: [], dark: [] });
});
