import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { C, clientRoutes } from '#/testing/clientsFixtures.ts';
import { json, problem } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/clients/c-bill?tab=logout';
const DELIVERIES = `GET ${C}/c-bill/logout-deliveries`;

function delivery(id: string, status: 'pending' | 'delivered' | 'failed', error: string | null) {
  return {
    id,
    session_id: `sess-${id}`,
    endpoint: 'https://billing.example/backchannel',
    status,
    attempts: status === 'pending' ? 0 : 3,
    last_error: error,
    created_at: '2026-09-28T08:41:53.858Z',
    next_attempt_at: '2026-09-28T08:42:53.858Z',
    delivered_at: status === 'delivered' ? '2026-09-28T08:42:00.000Z' : null,
  };
}

async function open(): Promise<void> {
  await screen.findByRole('region', { name: 'Back-channel deliveries' });
}

it('lists the logout tokens queued for the client, each with its status and last error', async () => {
  renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [DELIVERIES]: json({
        items: [
          delivery('d1', 'failed', 'connect ECONNREFUSED'),
          delivery('d2', 'delivered', null),
        ],
      }),
    }),
  );
  await open();
  const table = await screen.findByRole('grid', { name: 'Logout deliveries of Billing' });
  expect(within(table).getByText('failed')).toBeVisible();
  expect(within(table).getByText('delivered')).toBeVisible();
  expect(within(table).getByText('connect ECONNREFUSED')).toBeVisible();
  expect(within(table).getAllByText('3 attempts')).toHaveLength(2);
});

it('asks the server for one status, and for any when none is chosen', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    clientRoutes(undefined, { [DELIVERIES]: json({ items: [delivery('d1', 'failed', 'x')] }) }),
  );
  await open();
  await screen.findByRole('grid', { name: 'Logout deliveries of Billing' });
  expect(sent.find((s) => s.path === `${C}/c-bill/logout-deliveries`)?.search.has('status')).toBe(
    false,
  );
  await user.click(screen.getByRole('button', { name: /Show/u }));
  await user.click(await screen.findByRole('option', { name: 'Failed' }));
  await waitFor(() => {
    expect(
      sent.some(
        (s) => s.path === `${C}/c-bill/logout-deliveries` && s.search.get('status') === 'failed',
      ),
    ).toBe(true);
  });
});

it('pages by Load more, keeping the rows already shown', async () => {
  const user = userEvent.setup();
  const first = json({ items: [delivery('d1', 'failed', 'x')], next: 'c2' });
  const second = json({ items: [delivery('d2', 'pending', null)] });
  renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [DELIVERIES]: (request) =>
        request.search.get('cursor') === 'c2' ? second(request) : first(request),
    }),
  );
  await open();
  await user.click(await screen.findByRole('button', { name: 'Load more deliveries' }));
  const table = await screen.findByRole('grid', { name: 'Logout deliveries of Billing' });
  await waitFor(() => {
    expect(within(table).getAllByRole('row')).toHaveLength(3);
  });
});

it('says no logout token has been queued, and that a failed read can be tried again', async () => {
  renderConsoleAt(AT, clientRoutes(undefined, { [DELIVERIES]: json({ items: [] }) }));
  expect(await screen.findByText('No logout token has been queued for this client.')).toBeVisible();
});

it('says the deliveries could not be loaded, and offers another try', async () => {
  renderConsoleAt(
    AT,
    clientRoutes(undefined, { [DELIVERIES]: problem(500, 'about:blank', 'Error') }),
  );
  expect(await screen.findByText('The deliveries could not be loaded')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () =>
        consoleAt(
          AT,
          clientRoutes(undefined, {
            [DELIVERIES]: json({ items: [delivery('d1', 'failed', 'connect ECONNREFUSED')] }),
          }),
        ).element,
      () => screen.findByRole('grid', { name: 'Logout deliveries of Billing' }),
    ),
  ).toEqual({ light: [], dark: [] });
});
