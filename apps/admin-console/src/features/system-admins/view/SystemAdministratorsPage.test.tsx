import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { json, problem, type Answer } from '#/testing/fakeTransport.ts';
import {
  consoleAt,
  GRACE,
  renderConsoleAt,
  resetConsole,
  whoami,
} from '#/testing/renderConsole.tsx';
import { ADMIN, administratorRoutes, systemRoutes } from '#/testing/tenantsFixtures.ts';

const AT = '/console/system/system-admins';
const S = `${ADMIN}/system`;
const KEY = 'odudu.console.system-administrator';

function subject(id: string, username: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: 'user',
    username,
    email: `${username}@example.test`,
    enabled: true,
    created_at: '2026-09-28T08:41:53.858Z',
    ...extra,
  };
}

// ROOT, who is signed in, is s0.
const ROOT_ROW = subject('s0', 'root');
const ADA = subject('s-ada', 'ada');
const CANDIDATE = subject('s-grace', 'grace');

function role(id: string, name: string) {
  return {
    id,
    name,
    description: null,
    client_id: 'c-admin',
    client_key: 'odudu-admin',
    default_for_new_subjects: false,
    admin_reach: [],
    created_at: '2026-09-28T08:41:53.858Z',
  };
}

function subjects(holders: readonly unknown[], others: readonly unknown[] = []): Answer {
  return (request) => {
    const username = request.search.get('username');
    const all =
      request.search.get('capability') === null
        ? [...holders, ...others]
        : holders.map((row) => ({
            ...(row as object),
            admin_capabilities: [{ name: 'tenant-admin', direct: true }],
          }));
    const items = all.filter(
      (row) =>
        username === null ||
        (typeof row === 'object' &&
          row !== null &&
          'username' in row &&
          String(row.username).startsWith(username)),
    );
    return json({ items })(request);
  };
}

function counted(total: number, enabled = total): Answer {
  return (request) =>
    json({ count: request.search.get('enabled') === 'true' ? enabled : total, capped: false })(
      request,
    );
}

function roles(id: string, held: readonly string[]): Record<string, Answer> {
  const assigned = held.map((name) => ({ id: name, name, client_id: null, client_key: null }));
  return {
    [`GET ${S}/subjects/${id}/roles`]: json({ items: assigned }, 200, { etag: `"${id}-1"` }),
    [`PUT ${S}/subjects/${id}/roles`]: json({ items: [] }, 200, { etag: `"${id}-2"` }),
  };
}

function routes(extra: Record<string, Answer> = {}) {
  const base = administratorRoutes('system', 'unused', 'unused');
  return systemRoutes({
    [`GET ${S}/clients`]: base[`GET ${S}/clients`] ?? json({ items: [] }),
    [`GET ${S}/roles`]: json({
      items: [role('r-admin', 'tenant-admin'), role('r-tenants', 'manage-tenants')],
    }),
    [`GET ${S}/subjects`]: subjects([ROOT_ROW, ADA], [CANDIDATE]),
    [`GET ${S}/subjects/count`]: counted(2),
    ...roles('s-ada', ['reader', 'r-admin']),
    ...roles('s0', ['r-admin']),
    ...roles('s-grace', ['reader']),
    ...extra,
  });
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

it('lists every holder of an admin capability in system, a page at a time', async () => {
  const { sent } = renderConsoleAt(AT, routes());
  expect(
    await screen.findByRole('heading', { level: 1, name: 'System administrators' }),
  ).toBeVisible();
  const list = await screen.findByRole('list', { name: 'Administrators of system' });
  expect(
    within(list)
      .getAllByRole('link')
      .map((link) => link.textContent),
  ).toEqual(['root', 'ada']);
  expect(within(list).getAllByText('reaches every tenant')).toHaveLength(2);
  expect(await screen.findByText('2 administrators')).toBeVisible();
  expect(screen.getByText(/anything else held in system acts in system only/u)).toBeVisible();
  const reads = sent.filter((s) => s.path === `${S}/subjects` && s.search.get('limit') === null);
  expect(reads[0]?.search.get('capability')).toBe('any');
  expect(screen.queryByRole('button', { name: /^Revoke/u })).toBeNull();
});

it("creates one through system's guided administrator step", async () => {
  const user = userEvent.setup();
  const { router } = renderConsoleAt(AT, routes());
  const create = await screen.findByRole('button', {
    name: 'Create a new subject as an administrator',
  });
  await waitFor(() => {
    expect(create).toBeEnabled();
  });
  await user.click(create);
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Add a system administrator' }),
  ).toBeVisible();
  expect(router.state.location.pathname).toBe('/system/system-admins/new');
  expect(sessionStorage.getItem(KEY)).toContain('"tenant":"system"');
});

it('gives a subject chosen from system Full, by default', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, routes());
  const choose = await screen.findByRole('group', { name: 'Subject in system' });
  await user.type(within(choose).getByRole('searchbox'), 'gr{Enter}');
  await user.click(await within(choose).findByRole('option', { name: /grace/u }));
  const grant = screen.getByRole('button', { name: 'Give it to grace' });
  await waitFor(() => {
    expect(grant).toBeEnabled();
  });
  await user.click(grant);
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PUT')).toMatchObject({
      path: `${S}/subjects/s-grace/roles`,
      ifMatch: '"s-grace-1"',
      body: { role_ids: ['reader', 'r-admin'] },
    });
  });
  expect(await screen.findByText('grace now holds Full (tenant-admin) in system.')).toBeVisible();
});

it('gives a chosen set of capabilities instead of Full', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, routes());
  const choose = await screen.findByRole('group', { name: 'Subject in system' });
  await user.click(await within(choose).findByRole('option', { name: /grace/u }));
  const holds = screen.getByRole('group', { name: 'What they hold' });
  await user.click(within(holds).getByRole('checkbox', { name: 'Full (tenant-admin)' }));
  await user.click(screen.getByRole('button', { name: 'Give it to grace' }));
  expect(await screen.findByText('Choose Full, or at least one capability.')).toBeVisible();
  await user.click(within(holds).getByRole('checkbox', { name: 'manage-tenants' }));
  await user.click(screen.getByRole('button', { name: 'Give it to grace' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PUT')).toMatchObject({
      body: { role_ids: ['reader', 'r-tenants'] },
    });
  });
});

it('marks a subject who already holds something, by one read per picker search', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, routes());
  const choose = await screen.findByRole('group', { name: 'Subject in system' });
  const ada = await within(choose).findByRole('option', { name: /ada/u });
  await waitFor(() => {
    expect(ada).toHaveAccessibleDescription(/already holds a capability/u);
  });
  expect(ada).toHaveAttribute('aria-disabled', 'true');
  expect(within(choose).getByRole('option', { name: /grace/u })).not.toHaveAttribute(
    'aria-disabled',
  );
  await user.type(within(choose).getByRole('searchbox'), 'gr{Enter}');
  await within(choose).findByRole('option', { name: /grace/u });
  const holderReads = sent.filter(
    (s) =>
      s.path === `${S}/subjects` &&
      s.search.get('username') === 'gr' &&
      s.search.get('capability') === 'any',
  );
  expect(holderReads).toHaveLength(1);
});

it('says a grant met roles changed under it, beside the button', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    routes({
      [`PUT ${S}/subjects/s-grace/roles`]: problem(412, 'about:blank', 'Precondition Failed'),
    }),
  );
  const choose = await screen.findByRole('group', { name: 'Subject in system' });
  await user.click(await within(choose).findByRole('option', { name: /grace/u }));
  const grant = screen.getByRole('button', { name: 'Give it to grace' });
  await waitFor(() => {
    expect(grant).toBeEnabled();
  });
  await user.click(grant);
  const section = screen.getByRole('region', { name: 'Add an administrator' });
  expect(
    await within(section).findByText(
      'grace was not given it: their roles changed while this ran. Try again.',
    ),
  ).toBeVisible();
});

it('offers a limited operator none of the changes the server would refuse, and says so once', async () => {
  const { sent } = renderConsoleAt(
    AT,
    routes({ [`GET ${S}/whoami`]: whoami(['manage-tenants', 'view-users']) }),
  );
  await screen.findByRole('list', { name: 'Administrators of system' });
  await waitFor(() => {
    expect(screen.getByRole('note')).toHaveTextContent(
      'You can view system administrators but not create them or change what they hold (needs manage-users, manage-clients, manage-tenant, manage-keys, manage-sessions and view-audit).',
    );
  });
  expect(screen.getAllByRole('note')).toHaveLength(1);
  expect(screen.queryByRole('region', { name: 'Add an administrator' })).toBeNull();
  expect(screen.queryByRole('button', { name: /capabilities/u })).toBeNull();
  expect(sent.filter((s) => s.method !== 'GET')).toHaveLength(0);
});

it('is no page for a tenant administrator', async () => {
  renderConsoleAt('/console/acme/system-admins', {
    'GET /console/api/session': json(GRACE),
    [`GET ${ADMIN}/acme/whoami`]: whoami(['manage-tenant']),
  });
  expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, routes()).element,
      () => screen.findByRole('list', { name: 'Administrators of system' }),
    ),
  ).toEqual({ light: [], dark: [] });
});
