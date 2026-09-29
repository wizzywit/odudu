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
    expect(router.state.location.pathname).toBe('/system/new-tenant');
  });
  expect(
    await screen.findByRole('heading', { level: 1, name: 'First administrator of acme' }),
  ).toBeVisible();
});

it('names what adding an administrator needs, rather than offering it, to manage-tenants alone', async () => {
  renderConsoleAt(AT, {
    ...routes(),
    [`GET ${ADMIN}/system/whoami`]: whoami(['manage-tenants', 'view-users']),
  });
  const add = await screen.findByRole('button', { name: 'Add an administrator' });
  await waitFor(() => {
    expect(add).toBeDisabled();
  });
  expect(screen.getAllByRole('note').map((note) => note.textContent)).toEqual([
    'Adding an administrator needs the manage-users capability.',
    'Adding an administrator needs the manage-clients capability.',
    // Granting tenant-admin is held to every capability the role carries.
    'Adding an administrator needs the manage-tenant capability.',
    'Adding an administrator needs the manage-keys capability.',
    'Adding an administrator needs the manage-sessions capability.',
    'Adding an administrator needs the view-audit capability.',
  ]);
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

function halfway(tenantName: string) {
  return JSON.stringify({
    owner: 'system/s0',
    creation: {
      step: 'administrator',
      tenant: tenantName,
      origin: 'created',
      username: 'ada',
      email: '',
      subjectId: '01a0e72d-7fc7-7950-a1e7-1d079588f8b9',
      granted: false,
    },
  });
}

it('asks before replacing an administrator left half made in another tenant', async () => {
  sessionStorage.setItem(KEY, halfway('globex'));
  const user = userEvent.setup();
  const { router } = renderConsoleAt(AT, routes());
  await user.click(await screen.findByRole('button', { name: 'Add an administrator' }));
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Replace the unfinished administrator?',
  });
  expect(dialog).toHaveTextContent('ada was created in globex');
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(sessionStorage.getItem(KEY)).toBe(halfway('globex'));
  expect(router.state.location.pathname).toBe('/system/tenants/acme');

  await user.click(screen.getByRole('button', { name: 'Add an administrator' }));
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Replace it' }),
  );
  expect(
    await screen.findByRole('heading', { level: 1, name: 'First administrator of acme' }),
  ).toBeVisible();
});

it('resumes, rather than replaces, one left half made in this tenant', async () => {
  sessionStorage.setItem(KEY, halfway('acme'));
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
