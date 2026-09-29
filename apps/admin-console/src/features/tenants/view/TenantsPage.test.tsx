import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { json } from '#/testing/fakeTransport.ts';
import {
  consoleAt,
  GRACE,
  renderConsoleAt,
  resetConsole,
  whoami,
} from '#/testing/renderConsole.tsx';
import { ADMIN, systemRoutes, tenant } from '#/testing/tenantsFixtures.ts';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const ACME = tenant('acme', { display_name: 'Acme' });
const GLOBEX = tenant('globex', { enabled: false });

function routes() {
  return systemRoutes({
    [`GET ${ADMIN}`]: json({ items: [ACME, GLOBEX] }),
    [`GET ${ADMIN}/count`]: json({ count: 2, capped: false }),
  });
}

it('lists the tenants with their count, and offers creation and import', async () => {
  renderConsoleAt('/console/system/tenants', routes());
  expect(await screen.findByRole('heading', { level: 1, name: 'Tenants' })).toBeVisible();
  const table = await screen.findByRole('grid', { name: 'Tenants' });
  expect(within(table).getByText('acme')).toBeVisible();
  expect(within(table).getByText('Acme')).toBeVisible();
  expect(within(table).getByText('disabled')).toBeVisible();
  expect(await screen.findByText('2 tenants')).toBeVisible();
  expect(within(table).getByRole('link', { name: 'Enter acme' })).toHaveAttribute(
    'href',
    '/console/acme',
  );
  expect(screen.getByRole('link', { name: 'Create a tenant' })).toHaveAttribute(
    'href',
    '/console/system/new-tenant',
  );
  expect(screen.getByRole('link', { name: 'Import a tenant' })).toHaveAttribute(
    'href',
    '/console/system/import-tenant',
  );
});

it('searches by name and opens a tenant from its row', async () => {
  const user = userEvent.setup();
  const { sent, router } = renderConsoleAt('/console/system/tenants', routes());
  await screen.findByRole('grid', { name: 'Tenants' });
  await user.type(screen.getByRole('searchbox', { name: 'Search by Name' }), 'ac{Enter}');
  await waitFor(() => {
    expect(sent.some((s) => s.path === ADMIN && s.search.get('name') === 'ac')).toBe(true);
  });
  await user.click(await screen.findByRole('row', { name: /globex/u }));
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/system/tenants/globex');
  });
});

it("enters a tenant from its row's link, not its record", async () => {
  const user = userEvent.setup();
  const { router } = renderConsoleAt('/console/system/tenants', {
    ...routes(),
    [`GET ${ADMIN}/acme/whoami`]: whoami(['manage-tenant'], true),
  });
  await user.click(await screen.findByRole('link', { name: 'Enter acme' }));
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/acme');
  });
});

it('is no page for a tenant administrator', async () => {
  renderConsoleAt('/console/acme/tenants', {
    'GET /console/api/session': json(GRACE),
    [`GET ${ADMIN}/acme/whoami`]: whoami(['manage-tenant']),
  });
  expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt('/console/system/tenants', routes()).element,
      () => screen.findByRole('grid', { name: 'Tenants' }),
    ),
  ).toEqual({ light: [], dark: [] });
});
