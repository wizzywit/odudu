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

function scopesWith(capabilities: readonly string[]) {
  return {
    'GET /console/api/session': json(GRACE),
    'GET /console/api/admin/tenants/acme/whoami': whoami(capabilities),
  };
}

it('heads the page with the area, under the tenant', async () => {
  renderConsoleAt('/console/acme/scopes', scopesWith(['manage-tenant']));
  expect(await screen.findByRole('heading', { level: 1, name: 'Scopes' })).toBeVisible();
  expect(screen.getByText('Scopes is not in this build of the console yet.')).toBeVisible();
});

it('says which capability the area needs when whoami says it is missing', async () => {
  renderConsoleAt('/console/acme/scopes', scopesWith([]));
  expect(await screen.findByText(/manage-tenant/u)).toBeVisible();
});

it('passes axe in both themes, open and refused', async () => {
  for (const capabilities of [['manage-tenant'], []]) {
    const page = () => consoleAt('/console/acme/scopes', scopesWith(capabilities));
    expect(
      await axeInBothThemes(
        () => page().element,
        () => screen.findByRole('heading', { level: 1, name: 'Scopes' }),
      ),
    ).toEqual({ light: [], dark: [] });
  }
});
