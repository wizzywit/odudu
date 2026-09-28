import { screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { json } from '#/testing/fakeTransport.ts';
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
