import { screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { json, problem } from '#/testing/fakeTransport.ts';
import {
  consoleAt,
  GRACE,
  renderConsoleAt,
  ROOT,
  whoami,
  resetConsole,
} from '#/testing/renderConsole.tsx';

afterEach(() => {
  resetConsole();
});

it('frames the tenant with its rail and the principal in the footer', async () => {
  renderConsoleAt('/console/acme', {
    'GET /console/api/session': json(GRACE),
    'GET /console/api/admin/tenants/acme/whoami': whoami([]),
  });
  expect(await screen.findByRole('navigation', { name: 'Areas of acme' })).toBeInTheDocument();
  expect(screen.getByText(/Signed in as/u)).toHaveTextContent('Signed in as grace');
});

it('shows the not-found page for a name no tenant can have', async () => {
  renderConsoleAt('/console/Not_A_Tenant', { 'GET /console/api/session': json(GRACE) });
  expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
});

it('offers a system administrator inside a tenant the way back to its record', async () => {
  renderConsoleAt('/console/acme', {
    'GET /console/api/session': json(ROOT),
    'GET /console/api/admin/tenants/acme/whoami': whoami(['manage-tenants'], true),
  });
  const bar = await screen.findByRole('region', { name: 'System authority' });
  expect(within(bar).getByRole('link', { name: 'Back to system' })).toHaveAttribute(
    'href',
    '/console/system/tenants/acme',
  );
});

it('passes axe in both themes, under system authority as well', async () => {
  for (const [principal, capabilities, cross] of [
    [GRACE, [], false],
    [ROOT, ['manage-tenants'], true],
  ] as const) {
    const shell = () =>
      consoleAt('/console/acme', {
        'GET /console/api/session': json(principal),
        'GET /console/api/admin/tenants/acme/whoami': whoami(capabilities, cross),
      });
    expect(
      await axeInBothThemes(
        () => shell().element,
        () => screen.findByRole('navigation', { name: 'Areas of acme' }),
      ),
    ).toEqual({ light: [], dark: [] });
  }
});

const NO_SUCH = {
  'GET /console/api/session': json(ROOT),
  'GET /console/api/admin/tenants/no-such/whoami': problem(401, 'about:blank', 'Unauthorized'),
};

it('tells a system administrator that no tenant has the name, with no rail to offer', async () => {
  renderConsoleAt('/console/no-such', NO_SUCH);
  expect(await screen.findByRole('heading', { level: 1, name: 'Tenant not found' })).toBeVisible();
  expect(screen.getByText(/No tenant is named/u)).toHaveTextContent('No tenant is named no-such.');
  expect(screen.getByRole('link', { name: 'Choose a tenant' })).toHaveAttribute(
    'href',
    '/console/?choose',
  );
  expect(screen.queryByRole('navigation', { name: 'Areas of no-such' })).toBeNull();
});

it('passes axe in both themes on the tenant-not-found page', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt('/console/no-such', NO_SUCH).element,
      () => screen.findByRole('heading', { level: 1, name: 'Tenant not found' }),
    ),
  ).toEqual({ light: [], dark: [] });
});

it("keeps a tenant administrator's shell on whoami's 401, which says nothing of the tenant", async () => {
  renderConsoleAt('/console/acme', {
    'GET /console/api/session': json(GRACE),
    'GET /console/api/admin/tenants/acme/whoami': problem(401, 'about:blank', 'Unauthorized'),
  });
  expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Tenant not found' })).toBeNull();
});
