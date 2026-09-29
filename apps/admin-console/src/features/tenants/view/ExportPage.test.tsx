import { screen } from '@testing-library/react';
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
import { ADMIN } from '#/testing/tenantsFixtures.ts';

afterEach(() => {
  resetConsole();
});

function routes(capabilities: readonly string[]) {
  return {
    'GET /console/api/session': json(GRACE),
    [`GET ${ADMIN}/acme/whoami`]: whoami(capabilities),
  };
}

it("offers a tenant administrator their own tenant's export, and no import", async () => {
  renderConsoleAt(
    '/console/acme/export',
    routes(['manage-tenant', 'manage-clients', 'view-users']),
  );
  expect(await screen.findByRole('heading', { level: 1, name: 'Export' })).toBeVisible();
  expect(await screen.findByRole('button', { name: 'Export to a file' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: /Import/u })).toBeNull();
  expect(screen.queryByRole('link', { name: /Import/u })).toBeNull();
});

it('names what a limited operator lacks, and offers no export the server would refuse', async () => {
  renderConsoleAt('/console/acme/export', routes(['manage-tenant']));
  expect(await screen.findByText(/An export needs the/u)).toHaveTextContent('manage-clients');
  expect(screen.queryByRole('button', { name: 'Export to a file' })).toBeNull();
  expect(screen.queryByRole('switch', { name: 'Include subjects' })).toBeNull();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt('/console/acme/export', routes(['manage-tenant'])).element,
      () => screen.findByText(/An export needs the/u),
    ),
  ).toEqual({ light: [], dark: [] });
});
