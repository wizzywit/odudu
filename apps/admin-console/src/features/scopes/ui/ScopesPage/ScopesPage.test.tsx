import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { SC, scopeRoutes } from '#/testing/scopesFixtures';

afterEach(() => {
  resetConsole();
});

const AT = '/console/acme/scopes';

it('lists the scopes with their descriptions and a count, and offers a new one', async () => {
  renderConsoleAt(AT, scopeRoutes());
  expect(await screen.findByRole('heading', { level: 1, name: 'Scopes' })).toBeVisible();
  const table = await screen.findByRole('grid', { name: 'Scopes' });
  expect(within(table).getByRole('row', { name: /billing/u })).toHaveTextContent('Invoices');
  expect(await screen.findByText(/3 scopes/u)).toBeVisible();
  expect(screen.getByRole('link', { name: 'Create a scope' })).toHaveAttribute(
    'href',
    '/console/acme/scopes/new',
  );
});

it('searches by the start of a name on the server, and opens a scope from its row', async () => {
  const user = userEvent.setup();
  const { sent, router } = renderConsoleAt(AT, scopeRoutes());
  await screen.findByRole('grid', { name: 'Scopes' });
  await user.type(screen.getByRole('searchbox', { name: /Search/u }), 'bil{Enter}');
  await waitFor(() => {
    expect(sent.some((s) => s.path === SC && s.search.get('name') === 'bil')).toBe(true);
  });
  const billing = await screen.findByRole('row', { name: /billing/u });
  expect(screen.queryByRole('row', { name: /openid/u })).toBeNull();
  await user.click(billing);
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/acme/scopes/s-bill');
  });
});

it('names manage-tenant for a caller without it', async () => {
  renderConsoleAt(AT, scopeRoutes(['manage-clients']));
  expect(await screen.findByRole('note')).toHaveTextContent('manage-tenant');
});

it('passes axe in both themes, listed and refused', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, scopeRoutes()).element,
      () => screen.findByRole('grid', { name: 'Scopes' }),
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, scopeRoutes(['manage-clients'])).element,
      () => screen.findByRole('note'),
    ),
  ).toEqual({ light: [], dark: [] });
});

it('offers to restore the built-in scopes beside creating a scope', async () => {
  renderConsoleAt(AT, scopeRoutes());
  expect(await screen.findByRole('button', { name: 'Restore built-in scopes' })).toBeVisible();
});
