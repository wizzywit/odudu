import { screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { json, pending } from '#/testing/fakeTransport.ts';
import {
  consoleAt,
  renderConsoleAt,
  resetConsole,
  ROOT,
  whoami,
} from '#/testing/renderConsole.tsx';
import { ADMIN } from '#/testing/tenantsFixtures.ts';

afterEach(() => {
  resetConsole();
});

it('checks access while whoami is unanswered, reading nothing else', async () => {
  const { calls } = renderConsoleAt('/console/system/new-tenant', {
    'GET /console/api/session': json(ROOT),
    [`GET ${ADMIN}/system/whoami`]: pending(),
  });
  expect(await screen.findByText('Checking access to Create a tenant')).toBeInTheDocument();
  expect(calls.map((call) => call.path)).not.toContain('/console/api/tenants/system/discovery');
});

it('is no page for a system principal whom whoami gives no manage-tenants', async () => {
  renderConsoleAt('/console/system/import-tenant', {
    'GET /console/api/session': json(ROOT),
    [`GET ${ADMIN}/system/whoami`]: whoami(['view-audit']),
  });
  expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
});

it('passes axe in both themes while it checks', async () => {
  expect(
    await axeInBothThemes(
      () =>
        consoleAt('/console/system/new-tenant', {
          'GET /console/api/session': json(ROOT),
          [`GET ${ADMIN}/system/whoami`]: pending(),
        }).element,
      () => screen.findByText('Checking access to Create a tenant'),
    ),
  ).toEqual({ light: [], dark: [] });
});
