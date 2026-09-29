import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { json } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole, whoami } from '#/testing/renderConsole.tsx';
import { ADMIN, systemRoutes, tenant } from '#/testing/tenantsFixtures.ts';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const GRACE = {
  id: '01a0e72d-7fc7-7950-a1e7-1d079588f8b4',
  type: 'user',
  username: 'grace',
  email: 'grace@acme.test',
  enabled: true,
  created_at: '2026-09-28T08:41:53.858Z',
};

function routes() {
  return systemRoutes({
    [`GET ${ADMIN}/acme`]: json(tenant('acme'), 200, { etag: '"t1"' }),
    [`GET ${ADMIN}/acme/subjects`]: json({ items: [GRACE] }),
    [`GET ${ADMIN}/acme/subjects/count`]: json({ count: 1, capped: false }),
  });
}

const AT = '/console/system/tenants/acme?tab=administrators';

it('lists everybody holding tenant-admin, and says the last one cannot be removed', async () => {
  const { sent } = renderConsoleAt(AT, routes());
  expect(await screen.findByRole('grid', { name: 'Administrators of acme' })).toHaveTextContent(
    'grace@acme.test',
  );
  expect(await screen.findByText('1 administrator')).toBeVisible();
  expect(
    screen.getByText(/the last one cannot be disabled, deleted, or lose tenant-admin/u),
  ).toBeVisible();
  const reads = sent.filter((s) => s.path.startsWith(`${ADMIN}/acme/subjects`));
  expect(reads.map((s) => s.search.get('capability'))).toEqual(['tenant-admin', 'tenant-admin']);
});

it('adds an administrator through the guided step, resumed for this tenant', async () => {
  const user = userEvent.setup();
  const { router } = renderConsoleAt(AT, routes());
  await user.click(await screen.findByRole('button', { name: 'Add an administrator' }));
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/system/tenants/acme/new-administrator');
  });
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Add an administrator to acme' }),
  ).toBeVisible();
});

it('offers no add to manage-tenants alone, and says once on the page what it needs', async () => {
  renderConsoleAt(AT, {
    ...routes(),
    [`GET ${ADMIN}/system/whoami`]: whoami(['manage-tenants', 'view-users']),
  });
  // Granting tenant-admin is held to every capability the role carries.
  expect(await screen.findByRole('note')).toHaveTextContent(
    'You can view tenants but not change them or add their administrators (needs manage-tenant, manage-users, manage-clients, manage-keys, manage-sessions and view-audit).',
  );
  await screen.findByRole('grid', { name: 'Administrators of acme' });
  expect(screen.queryByRole('button', { name: 'Add an administrator' })).toBeNull();
  expect(screen.getAllByRole('note')).toHaveLength(1);
});

it('names manage-tenants for system, which its last-administrator guard counts', async () => {
  const { sent } = renderConsoleAt('/console/system/tenants/system?tab=administrators', {
    ...systemRoutes({
      [`GET ${ADMIN}/system`]: json(tenant('system'), 200, { etag: '"s1"' }),
      [`GET ${ADMIN}/system/subjects`]: json({ items: [GRACE] }),
      [`GET ${ADMIN}/system/subjects/count`]: json({ count: 1, capped: false }),
    }),
  });
  const lead = await screen.findByText(/holds manage-tenants in system/u);
  expect(lead).toHaveTextContent(
    'the last one cannot be disabled, deleted, or lose manage-tenants',
  );
  expect(within(lead).getByRole('link', { name: 'System administrators' })).toHaveAttribute(
    'href',
    '/console/system/system-admins',
  );
  await waitFor(() => {
    expect(
      sent
        .filter((s) => s.path.startsWith(`${ADMIN}/system/subjects`))
        .map((s) => s.search.get('capability')),
    ).toEqual(['manage-tenants', 'manage-tenants']);
  });
});

const KEY = 'odudu.console.tenant-creation';
const ACME_KEY = 'odudu.console.administrator/acme';

function halfway(tenantName: string, origin = 'existing') {
  return JSON.stringify({
    owner: 'system/s0',
    creation: {
      step: 'administrator',
      tenant: tenantName,
      origin,
      username: 'ada',
      email: '',
      subjectId: '01a0e72d-7fc7-7950-a1e7-1d079588f8b9',
      granted: false,
    },
  });
}

it("leaves a tenant creation half made elsewhere alone, and opens this tenant's own step", async () => {
  sessionStorage.setItem(KEY, halfway('globex', 'created'));
  const user = userEvent.setup();
  const { router } = renderConsoleAt(AT, routes());
  await user.click(await screen.findByRole('button', { name: 'Add an administrator' }));
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Add an administrator to acme' }),
  ).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Username' })).toHaveValue('');
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(sessionStorage.getItem(KEY)).toBe(halfway('globex', 'created'));

  await router.navigate({ href: '/system/new-tenant' });
  expect(await screen.findByText(/, created\. What is left/u)).toBeVisible();
  expect(router.state.location.pathname).toBe('/system/new-tenant');
});

it('opens Create a tenant at the tenant step once an administrator was begun here', async () => {
  const user = userEvent.setup();
  const { router } = renderConsoleAt(AT, routes());
  await user.click(await screen.findByRole('button', { name: 'Add an administrator' }));
  await user.type(await screen.findByRole('textbox', { name: 'Username' }), 'grace');
  await router.navigate({ href: '/system/new-tenant' });
  expect(await screen.findByRole('heading', { level: 1, name: 'Create a tenant' })).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('');
  expect(router.state.location.pathname).toBe('/system/new-tenant');
  expect(sessionStorage.getItem(ACME_KEY)).toContain('"username":"grace"');
});

it('resumes, rather than replaces, one left half made in this tenant', async () => {
  sessionStorage.setItem(ACME_KEY, halfway('acme'));
  const user = userEvent.setup();
  renderConsoleAt(AT, routes());
  await user.click(await screen.findByRole('button', { name: 'Add an administrator' }));
  expect(await screen.findByText(/, created\. What is left/u)).toBeVisible();
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, routes()).element,
      () => screen.findByRole('grid', { name: 'Administrators of acme' }),
    ),
  ).toEqual({ light: [], dark: [] });
});
