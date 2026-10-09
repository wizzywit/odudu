import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { json, problem } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole, whoami } from '#/testing/renderConsole.tsx';
import { ADMIN, systemRoutes, tenant } from '#/testing/tenantsFixtures.ts';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const ACME = tenant('acme', { display_name: 'Acme Corp' });

function routes() {
  return systemRoutes({ [`GET ${ADMIN}/acme`]: json(ACME, 200, { etag: '"t1"' }) });
}

it('shows a tenant by name, with its status, its tabs and a way into it', async () => {
  renderConsoleAt('/console/system/tenants/acme', routes());
  expect(await screen.findByRole('heading', { level: 1, name: 'acme' })).toBeVisible();
  expect(await screen.findByText('Acme Corp')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Enter acme' })).toHaveAttribute('href', '/console/acme');
  const tabs = screen.getByRole('tablist', { name: 'Tenant sections' });
  expect(tabs).toHaveTextContent('General');
  expect(tabs).toHaveTextContent('Administrators');
  expect(tabs).toHaveTextContent('Export');
  expect(await screen.findByRole('heading', { level: 2, name: 'General' })).toBeVisible();
});

it('explains, and reads nothing, to an operator whose capabilities do not reach the record', async () => {
  const { sent } = renderConsoleAt('/console/system/tenants/acme', {
    ...routes(),
    [`GET ${ADMIN}/system/whoami`]: whoami(['manage-tenants', 'view-users']),
  });
  expect(await screen.findByRole('note')).toHaveTextContent(
    "A tenant's record needs the manage-tenant capability.",
  );
  expect(screen.getByRole('heading', { level: 1, name: 'acme' })).toBeVisible();
  expect(sent.some((s) => s.path === `${ADMIN}/acme`)).toBe(false);
});

it('offers what the operator can change, and says once what it cannot', async () => {
  renderConsoleAt('/console/system/tenants/acme', {
    ...routes(),
    [`GET ${ADMIN}/system/whoami`]: whoami(['manage-tenants', 'manage-tenant', 'view-users']),
  });
  expect(await screen.findByRole('note')).toHaveTextContent(
    'You can view tenants but not add their administrators (needs manage-users, manage-clients, manage-keys, manage-sessions and view-audit).',
  );
  expect(await screen.findByRole('textbox', { name: 'Display name' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Disable acme' })).toBeVisible();
});

it('climbs back to Tenants through a breadcrumb, with the status beside the name', async () => {
  renderConsoleAt('/console/system/tenants/acme', routes());
  await screen.findByText('Acme Corp');
  const heading = screen.getByRole('heading', { level: 1, name: 'acme' });
  const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
  expect(within(trail).getByRole('link', { name: 'Tenants' })).toHaveAttribute(
    'href',
    '/console/system/tenants',
  );
  expect(within(trail).getByText('acme')).toHaveAttribute('aria-current', 'page');
  expect(within(heading.parentElement ?? heading).getByText('enabled')).toBeVisible();
});

it('keeps its tab in the address', async () => {
  const user = userEvent.setup();
  const { router } = renderConsoleAt('/console/system/tenants/acme', {
    ...routes(),
    [`GET ${ADMIN}/acme/subjects`]: json({ items: [] }),
    [`GET ${ADMIN}/acme/subjects/count`]: json({ count: 0, capped: false }),
  });
  await user.click(await screen.findByRole('tab', { name: 'Administrators' }));
  expect(router.state.location.search).toEqual({ tab: 'administrators' });
});

it('says so of a tenant that does not exist', async () => {
  renderConsoleAt('/console/system/tenants/nope', {
    ...systemRoutes(),
    [`GET ${ADMIN}/nope`]: problem(404, 'about:blank', 'Not Found'),
  });
  expect(await screen.findByRole('heading', { name: 'No such tenant' })).toBeVisible();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt('/console/system/tenants/acme', routes()).element,
      () => screen.findByRole('heading', { level: 2, name: 'General' }),
    ),
  ).toEqual({ light: [], dark: [] });
});
