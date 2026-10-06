import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { C, clientRoutes, client } from '#/testing/clientsFixtures.ts';
import { json } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';

afterEach(() => {
  resetConsole();
});

const AT = '/console/acme/clients';

it('lists the clients by name and ID, with their type and status', async () => {
  renderConsoleAt(AT, clientRoutes());
  expect(await screen.findByRole('heading', { level: 1, name: 'Clients' })).toBeVisible();
  const table = await screen.findByRole('grid', { name: 'Clients' });
  const billing = within(table).getByRole('row', { name: /Billing/u });
  expect(billing).toHaveTextContent('billing');
  expect(billing).toHaveTextContent('Confidential');
  expect(billing).toHaveTextContent('enabled');
  expect(within(table).getByRole('row', { name: /portal/u })).toHaveTextContent('Public');
  expect(screen.getByRole('link', { name: 'Create a client' })).toHaveAttribute(
    'href',
    '/console/acme/clients/new',
  );
});

it('searches by the server, by name or by ID, and filters by type and status', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, clientRoutes());
  await screen.findByRole('grid', { name: 'Clients' });
  await user.click(screen.getByRole('button', { name: /Any type/u }));
  await user.click(await screen.findByRole('option', { name: 'Public' }));
  await waitFor(() => {
    expect(sent.at(-1)?.search.get('type')).toBe('public');
  });
  await user.click(screen.getByRole('button', { name: /Any status/u }));
  await user.click(await screen.findByRole('option', { name: 'Disabled' }));
  await waitFor(() => {
    expect(
      sent
        .filter((s) => s.path === C)
        .at(-1)
        ?.search.get('enabled'),
    ).toBe('false');
  });
  expect(await screen.findByText(/No clients match/u)).toBeVisible();
});

it('asks the server for the next page rather than holding every client', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`GET ${C}`]: (request) =>
        json(
          request.search.get('cursor') === null
            ? { items: [client('c-1', 'first')], next: 'page-2' }
            : { items: [client('c-2', 'second')] },
        )(request),
    }),
  );
  await screen.findByRole('row', { name: /first/u });
  expect(sent.filter((s) => s.path === C)).toHaveLength(1);
  await user.click(await screen.findByRole('button', { name: 'Load more clients' }));
  expect(await screen.findByRole('row', { name: /second/u })).toBeVisible();
  expect(
    sent
      .filter((s) => s.path === C)
      .at(-1)
      ?.search.get('cursor'),
  ).toBe('page-2');
});

it('opens a client from its row', async () => {
  const user = userEvent.setup();
  const { router } = renderConsoleAt(AT, clientRoutes());
  await user.click(await screen.findByRole('row', { name: /Billing/u }));
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/acme/clients/c-bill');
  });
});

it('says what manage-clients is when the caller lacks it, and offers nothing', async () => {
  renderConsoleAt(AT, clientRoutes(['view-users']));
  expect(await screen.findByRole('note')).toHaveTextContent('Clients needs the manage-clients');
  expect(screen.queryByRole('link', { name: 'Create a client' })).toBeNull();
});

it('passes axe in both themes, listed and refused', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, clientRoutes()).element,
      () => screen.findByRole('grid', { name: 'Clients' }),
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, clientRoutes(['view-users'])).element,
      () => screen.findByRole('note'),
    ),
  ).toEqual({ light: [], dark: [] });
});
