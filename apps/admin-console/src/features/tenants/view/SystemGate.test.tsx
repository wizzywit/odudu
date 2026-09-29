import { screen, within } from '@testing-library/react';
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

it('names adding a system administrator, under its own area, while it checks', async () => {
  renderConsoleAt('/console/system/system-admins/new', {
    'GET /console/api/session': json(ROOT),
    [`GET ${ADMIN}/system/whoami`]: pending(),
  });
  expect(
    await screen.findByText('Checking access to Add a system administrator'),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { level: 1, name: 'Add a system administrator' }),
  ).toBeVisible();
  const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
  expect(within(trail).getByRole('link', { name: 'System administrators' })).toHaveAttribute(
    'href',
    '/console/system/system-admins',
  );
  expect(within(trail).queryByRole('link', { name: 'Tenants' })).toBeNull();
});

it("names adding an administrator to a tenant, under that tenant's record, while it checks", async () => {
  renderConsoleAt('/console/system/tenants/acme/new-administrator', {
    'GET /console/api/session': json(ROOT),
    [`GET ${ADMIN}/system/whoami`]: pending(),
  });
  expect(
    await screen.findByText('Checking access to Add an administrator to acme'),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { level: 1, name: 'Add an administrator to acme' }),
  ).toBeVisible();
  const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
  expect(within(trail).getByRole('link', { name: 'acme' })).toHaveAttribute(
    'href',
    '/console/system/tenants/acme',
  );
  expect(within(trail).getByText('Add an administrator')).toHaveAttribute('aria-current', 'page');
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
