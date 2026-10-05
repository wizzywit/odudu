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

const AT = '/console/system/tenants/acme?tab=administrators';
const S = `${ADMIN}/acme/subjects`;

function subject(id: string, username: string, enabled = true) {
  return {
    id,
    type: 'user',
    username,
    email: null,
    enabled,
    created_at: '2026-09-28T08:41:53.858Z',
  };
}

const GRACE = subject('s-grace', 'grace');
const ADA = subject('s-ada', 'ada', false);

// grace holds Full; ada only view-audit, through a group.
function routes(extra: Parameters<typeof systemRoutes>[0] = {}) {
  return systemRoutes({
    [`GET ${ADMIN}/acme`]: json(tenant('acme'), 200, { etag: '"t1"' }),
    [`GET ${S}`]: (request) =>
      json({
        items: request.search.get('capability') === 'view-audit' ? [GRACE, ADA] : [GRACE],
      })(request),
    [`GET ${S}/s-ada/effective-roles`]: json({
      items: [
        {
          id: 'r-audit',
          name: 'view-audit',
          client_id: 'c',
          client_key: 'odudu-admin',
          via: [{ kind: 'group', group_id: 'g', group_path: '/auditors' }],
        },
      ],
    }),
    [`GET ${S}/s-ada/roles`]: json({ items: [] }, 200, { etag: '"r1"' }),
    [`GET ${S}/s-grace/roles`]: json({ items: [] }, 200, { etag: '"r2"' }),
    ...extra,
  });
}

it('lists each holder once, in name order, with what each holds', async () => {
  renderConsoleAt(AT, routes());
  const list = await screen.findByRole('list', { name: 'Administrators of acme' });
  const holders = within(list).getAllByRole('link');
  expect(holders.map((link) => link.textContent)).toEqual(['ada', 'grace']);
  expect(holders[0]).toHaveAttribute('href', '/console/acme/subjects/s-ada');
  expect(await within(list).findByRole('list', { name: 'What ada holds' })).toHaveTextContent(
    'view-audit · through group /auditors',
  );
  expect(within(list).getByRole('list', { name: 'What grace holds' })).toHaveTextContent(
    'Full (tenant-admin)',
  );
  expect(within(list).getByText('disabled')).toBeVisible();
});

it('opens one holder’s capabilities at a time, and closes them again', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, routes());
  const open = await screen.findByRole('button', { name: 'Change ada’s capabilities' });
  expect(open).toHaveAttribute('aria-expanded', 'false');
  await user.click(open);
  expect(await screen.findByRole('region', { name: 'Admin capabilities' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Change grace’s capabilities' }));
  expect(screen.getAllByRole('region', { name: 'Admin capabilities' })).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: 'Close grace’s capabilities' }));
  expect(screen.queryByRole('region', { name: 'Admin capabilities' })).toBeNull();
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
