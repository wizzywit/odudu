import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { json, problem, type Answer } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole, whoami } from '#/testing/renderConsole.tsx';
import { ADMIN, systemRoutes, tenant } from '#/testing/tenantsFixtures.ts';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/system/tenants/acme?tab=administrators';
const S = `${ADMIN}/acme/subjects`;
const SYS = `${ADMIN}/system/subjects`;

function holder(id: string, username: string, held: unknown[], enabled = true) {
  return {
    id,
    type: 'user',
    username,
    email: null,
    enabled,
    created_at: '2026-09-28T08:41:53.858Z',
    admin_capabilities: held,
  };
}

const GRACE = holder('s-grace', 'grace', [
  { name: 'tenant-admin', direct: true },
  { name: 'view-users', direct: false },
]);
const ADA = holder('s-ada', 'ada', [{ name: 'view-audit', direct: false }], false);

function adminRole(id: string, name: string) {
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

const ROLES = [
  adminRole('r-full', 'tenant-admin'),
  adminRole('r-audit', 'view-audit'),
  adminRole('r-users', 'view-users'),
];

function routes(extra: Record<string, Answer> = {}) {
  return systemRoutes({
    [`GET ${ADMIN}/acme`]: json(tenant('acme'), 200, { etag: '"t1"' }),
    [`GET ${S}`]: json({ items: [ADA, GRACE] }),
    [`GET ${S}/count`]: json({ count: 2, capped: false }),
    [`GET ${ADMIN}/acme/roles`]: json({ items: ROLES }),
    [`GET ${S}/s-ada/roles`]: json({ items: [] }, 200, { etag: '"r1"' }),
    [`GET ${S}/s-grace/roles`]: json(
      {
        items: [
          { id: 'r-full', name: 'tenant-admin', client_id: 'c-admin', client_key: 'odudu-admin' },
        ],
      },
      200,
      { etag: '"r2"' },
    ),
    ...extra,
  });
}

it('lists every holder from one paged read, with what each holds and how, and nothing per row', async () => {
  const { sent } = renderConsoleAt(AT, routes());
  const list = await screen.findByRole('list', { name: 'Administrators of acme' });
  expect(
    within(list)
      .getAllByRole('link')
      .map((link) => link.textContent),
  ).toEqual(['ada', 'grace']);
  expect(within(list).getByRole('list', { name: 'What grace holds' })).toHaveTextContent(
    'Full (tenant-admin) · directly',
  );
  expect(within(list).getByRole('list', { name: 'What ada holds' })).toHaveTextContent(
    'view-audit · through a group or role',
  );
  expect(within(list).getByText('disabled')).toBeVisible();
  expect(await screen.findByText('2 administrators')).toBeVisible();
  const reads = sent.filter((s) => s.path === S);
  expect(reads.map((s) => s.search.get('capability'))).toEqual(['any']);
  expect(sent.some((s) => s.path.endsWith('/admin-capabilities'))).toBe(false);
});

it('narrows to the holders of one capability', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, routes());
  await screen.findByRole('list', { name: 'Administrators of acme' });
  await user.click(screen.getByRole('button', { name: /Holds/u }));
  await user.click(await screen.findByRole('option', { name: 'view-audit' }));
  await waitFor(() => {
    expect(
      sent
        .filter((s) => s.path === S)
        .at(-1)
        ?.search.get('capability'),
    ).toBe('view-audit');
  });
});

it('asks before opening another holder over unsaved edits, and staying keeps them', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, routes());
  await user.click(await screen.findByRole('button', { name: 'Change ada’s capabilities' }));
  const section = await screen.findByRole('region', { name: 'Admin capabilities' });
  await user.click(await within(section).findByRole('checkbox', { name: 'view-audit' }));
  await user.click(screen.getByRole('button', { name: 'Change grace’s capabilities' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Leave without saving?' });
  await user.click(within(dialog).getByRole('button', { name: 'Stay' }));
  expect(within(section).getByRole('checkbox', { name: 'view-audit' })).toBeChecked();
  expect(screen.getAllByRole('region', { name: 'Admin capabilities' })).toHaveLength(1);
});

it('offers no change without manage-users', async () => {
  renderConsoleAt(AT, {
    ...routes(),
    [`GET ${ADMIN}/system/whoami`]: whoami(['manage-tenants', 'manage-tenant', 'view-users']),
  });
  await screen.findByRole('list', { name: 'Administrators of acme' });
  expect(screen.queryByRole('button', { name: /capabilities/u })).toBeNull();
});

it('names view-users when the holders cannot be read', async () => {
  renderConsoleAt(AT, routes({ [`GET ${S}`]: problem(403, 'about:blank', 'Forbidden') }));
  expect(await screen.findByText(/Administrators of acme needs the/u)).toHaveTextContent(
    'Administrators of acme needs the view-users capability.',
  );
});

const SYSTEM_AT = '/console/system/system-admins';

function systemHolders(extra: Record<string, Answer> = {}) {
  const root = holder('s0', 'root', [
    { name: 'tenant-admin', direct: true },
    { name: 'manage-tenants', direct: false },
  ]);
  const vera = holder('s-vera', 'vera', [{ name: 'manage-tenants', direct: true }]);
  return systemRoutes({
    [`GET ${SYS}`]: json({ items: [root, vera] }),
    [`GET ${SYS}/count`]: json({ count: 2, capped: false }),
    [`GET ${ADMIN}/system/roles`]: json({
      items: [...ROLES, adminRole('r-tenants', 'manage-tenants')],
    }),
    [`GET ${SYS}/s0/roles`]: json(
      {
        items: [
          { id: 'r-full', name: 'tenant-admin', client_id: 'c-admin', client_key: 'odudu-admin' },
        ],
      },
      200,
      { etag: '"r0"' },
    ),
    [`GET ${SYS}/s0/admin-capabilities`]: json({
      items: [
        {
          id: 'r-full',
          name: 'tenant-admin',
          client_id: 'c-admin',
          client_key: 'odudu-admin',
          via: [{ kind: 'direct' }],
        },
        {
          id: 'r-tenants',
          name: 'manage-tenants',
          client_id: 'c-admin',
          client_key: 'odudu-admin',
          via: [{ kind: 'composite', parent_role_id: 'r-full', parent_name: 'tenant-admin' }],
        },
      ],
      complete: true,
    }),
    [`GET ${SYS}/s-vera/roles`]: json(
      {
        items: [
          {
            id: 'r-tenants',
            name: 'manage-tenants',
            client_id: 'c-admin',
            client_key: 'odudu-admin',
          },
        ],
      },
      200,
      { etag: '"rv"' },
    ),
    [`GET ${SYS}/s-vera/admin-capabilities`]: json({
      items: [
        {
          id: 'r-tenants',
          name: 'manage-tenants',
          client_id: 'c-admin',
          client_key: 'odudu-admin',
          via: [{ kind: 'direct' }],
        },
      ],
      complete: true,
    }),
    [`PUT ${SYS}/s-vera/roles`]: json({ items: [] }, 200, { etag: '"rv2"' }),
    [`PUT ${SYS}/s0/roles`]: json({ items: [] }, 200, { etag: '"r02"' }),
    ...extra,
  });
}

it('marks what reaches every tenant, and holds back the only holder’s with the reason', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    SYSTEM_AT,
    systemHolders({
      [`GET ${SYS}/count`]: json({ count: 1, capped: false }),
    }),
  );
  const list = await screen.findByRole('list', { name: 'Administrators of system' });
  expect(within(list).getAllByText('reaches every tenant')).toHaveLength(2);
  await user.click(within(list).getByRole('button', { name: 'Change vera’s capabilities' }));
  const box = await within(list).findByRole('checkbox', { name: 'manage-tenants' });
  await waitFor(() => {
    expect(box).toBeDisabled();
  });
  expect(box).toHaveAccessibleDescription(/vera is the only enabled holder of manage-tenants/u);
});

it('asks for the name, typed, before manage-tenants is taken from anybody', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(SYSTEM_AT, systemHolders());
  const list = await screen.findByRole('list', { name: 'Administrators of system' });
  await user.click(within(list).getByRole('button', { name: 'Change vera’s capabilities' }));
  const section = await within(list).findByRole('region', { name: 'Admin capabilities' });
  await user.click(await within(section).findByRole('checkbox', { name: 'manage-tenants' }));
  await user.click(within(section).getByRole('button', { name: 'Save Admin capabilities' }));
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Take system administration from vera?',
  });
  expect(sent.some((s) => s.method === 'PUT')).toBe(false);
  await user.type(within(dialog).getByRole('textbox'), 'vera');
  await user.click(within(dialog).getByRole('button', { name: 'Save Admin capabilities' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PUT')).toMatchObject({ body: { role_ids: [] } });
  });
});

it('says so when it is your own, and reads whoami again once it lands', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(SYSTEM_AT, systemHolders());
  const list = await screen.findByRole('list', { name: 'Administrators of system' });
  await user.click(within(list).getByRole('button', { name: 'Change root’s capabilities' }));
  const section = await within(list).findByRole('region', { name: 'Admin capabilities' });
  await user.click(await within(section).findByRole('checkbox', { name: 'Full (tenant-admin)' }));
  await user.click(within(section).getByRole('checkbox', { name: 'view-audit' }));
  await user.click(within(section).getByRole('button', { name: 'Save Admin capabilities' }));
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Revoke your own system administration?',
  });
  expect(dialog).toHaveTextContent(/stops offering everything Full carries/u);
  const before = sent.filter((s) => s.path.endsWith('/system/whoami')).length;
  await user.type(within(dialog).getByRole('textbox'), 'root');
  await user.click(within(dialog).getByRole('button', { name: 'Save Admin capabilities' }));
  await waitFor(() => {
    expect(sent.filter((s) => s.path.endsWith('/system/whoami')).length).toBeGreaterThan(before);
  });
});

it('counts Full held through a group as keeping manage-tenants', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    SYSTEM_AT,
    systemHolders({
      [`GET ${SYS}/count`]: json({ count: 1, capped: false }),
      [`GET ${SYS}/s-vera/admin-capabilities`]: json({
        items: [
          {
            id: 'r-full',
            name: 'tenant-admin',
            client_id: 'c-admin',
            client_key: 'odudu-admin',
            via: [{ kind: 'group', group_id: 'g', group_path: '/admins' }],
          },
          {
            id: 'r-tenants',
            name: 'manage-tenants',
            client_id: 'c-admin',
            client_key: 'odudu-admin',
            via: [
              { kind: 'direct' },
              { kind: 'composite', parent_role_id: 'r-full', parent_name: 'tenant-admin' },
            ],
          },
        ],
        complete: true,
      }),
    }),
  );
  const list = await screen.findByRole('list', { name: 'Administrators of system' });
  await user.click(within(list).getByRole('button', { name: 'Change vera’s capabilities' }));
  const section = await within(list).findByRole('region', { name: 'Admin capabilities' });
  const box = await within(section).findByRole('checkbox', { name: 'manage-tenants' });
  await waitFor(() => {
    expect(within(section).getAllByText(/through group \/admins/u).length).toBeGreaterThan(0);
  });
  expect(box).toBeEnabled();
  await user.click(box);
  await user.click(within(section).getByRole('button', { name: 'Save Admin capabilities' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PUT')).toMatchObject({ body: { role_ids: [] } });
  });
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('passes axe in both themes, with a holder open', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, routes()).element,
      async () => {
        await user.click(await screen.findByRole('button', { name: 'Change ada’s capabilities' }));
        await screen.findByRole('checkbox', { name: 'view-audit' });
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
