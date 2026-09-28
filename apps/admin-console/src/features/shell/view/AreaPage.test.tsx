import { screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { json } from '#/testing/fakeTransport.ts';
import {
  consoleAt,
  GRACE,
  renderConsoleAt,
  whoami,
  resetConsole,
} from '#/testing/renderConsole.tsx';

afterEach(() => {
  resetConsole();
});

function clientsWith(capabilities: readonly string[]) {
  return {
    'GET /console/api/session': json(GRACE),
    'GET /console/api/admin/tenants/acme/whoami': whoami(capabilities),
  };
}

it('heads the page with the area, under the tenant', async () => {
  renderConsoleAt('/console/acme/clients', clientsWith(['manage-clients']));
  expect(await screen.findByRole('heading', { level: 1, name: 'Clients' })).toBeVisible();
  expect(screen.getByText('Clients is not in this build of the console yet.')).toBeVisible();
});

it('says which capability the area needs when whoami says it is missing', async () => {
  renderConsoleAt('/console/acme/clients', clientsWith([]));
  expect(await screen.findByText(/manage-clients/u)).toBeVisible();
});

it('passes axe in both themes, open and refused', async () => {
  for (const capabilities of [['manage-clients'], []]) {
    const page = () => consoleAt('/console/acme/clients', clientsWith(capabilities));
    expect(
      await axeInBothThemes(
        () => page().element,
        () => screen.findByRole('heading', { level: 1, name: 'Clients' }),
      ),
    ).toEqual({ light: [], dark: [] });
  }
});
