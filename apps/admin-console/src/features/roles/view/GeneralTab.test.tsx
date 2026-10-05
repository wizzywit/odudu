import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { json, problem } from '#/testing/fakeTransport.ts';
import { adminRole } from '#/testing/groupsFixtures.ts';
import { AUDITOR, R, roleRoutes } from '#/testing/rolesFixtures.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';
import { S } from '#/testing/subjectsFixtures.ts';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/roles/r-aud';
const USERS = adminRole('manage-users');

it("shows a role's name as fixed, offers a copy, and saves its description on the ETag", async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    roleRoutes(undefined, {
      [`PATCH ${R}/r-aud`]: json({ ...AUDITOR, description: null }, 200, { etag: '"a2"' }),
    }),
  );
  expect(await screen.findByRole('heading', { level: 1, name: 'auditor' })).toBeVisible();
  expect(screen.getByText(/A role's name is fixed once it is made/u)).toBeVisible();
  expect(screen.getByRole('link', { name: 'Create a copy' })).toHaveAttribute(
    'href',
    '/console/acme/roles/new?copy=r-aud',
  );
  const section = screen.getByRole('region', { name: 'Description' });
  await user.clear(within(section).getByRole('textbox', { name: 'Description' }));
  await user.click(within(section).getByRole('button', { name: 'Save Description' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')).toMatchObject({
      ifMatch: '"r-aud-1"',
      body: { description: null },
    });
  });
});

it('gives a role to every new subject, and says why one reaching a capability cannot be', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    roleRoutes(undefined, {
      [`PUT ${R}/r-aud/default`]: problem(403, 'about:blank', 'Forbidden', {
        detail:
          'a role handed to every new subject may reach no admin capability, and this one would reach: view-users',
      }),
    }),
  );
  const section = await screen.findByRole('region', { name: 'New subjects' });
  await user.click(
    await within(section).findByRole('switch', { name: 'Given to every new subject' }),
  );
  await user.click(within(section).getByRole('button', { name: 'Save New subjects' }));
  expect(
    await within(section).findByText(
      /Refused: a role handed to every new subject may reach no admin/u,
    ),
  ).toBeVisible();
  expect(sent.find((s) => s.method === 'PUT')).toMatchObject({
    ifMatch: '"r-aud-1"',
    body: { default: true },
  });
});

it('holds the toggle back while what it nests reaches a capability', async () => {
  renderConsoleAt(
    AT,
    roleRoutes(undefined, {
      [`GET ${R}/r-aud/composites`]: json({ items: [USERS] }, 200, { etag: '"c"' }),
    }),
  );
  const section = await screen.findByRole('region', { name: 'New subjects' });
  expect(
    await within(section).findByText(
      /It reaches view-users and manage-users, and a role every new subject/u,
    ),
  ).toBeVisible();
  expect(within(section).queryByRole('switch')).toBeNull();
});

it('shows a built-in capability as fixed: never deleted, never a default, nothing to copy', async () => {
  renderConsoleAt('/console/acme/roles/r-manage-users', roleRoutes());
  expect(await screen.findByRole('heading', { level: 1, name: 'manage-users' })).toBeVisible();
  expect(
    await screen.findByText(
      /manage-users is a capability of the built-in admin client, so it cannot be deleted/u,
    ),
  ).toBeVisible();
  expect(
    screen.getByText(
      'A capability of the built-in admin client is never handed to every new subject.',
    ),
  ).toBeVisible();
  expect(screen.queryByRole('button', { name: /^Delete/u })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Create a copy' })).toBeNull();
});

it('deletes a role after saying what goes with it, and what you lose yourself', async () => {
  const user = userEvent.setup();
  const { router } = renderConsoleAt(
    AT,
    roleRoutes(undefined, {
      [`GET ${R}/r-aud/composites`]: json({ items: [USERS] }, 200, { etag: '"c"' }),
      [`GET ${S}/s1/effective-roles`]: json({
        items: [
          {
            id: 'r-aud',
            name: 'auditor',
            client_id: null,
            client_key: null,
            via: [{ kind: 'direct' }],
          },
          {
            id: USERS.id,
            name: USERS.name,
            client_id: USERS.client_id,
            client_key: USERS.client_key,
            via: [{ kind: 'composite', parent_role_id: 'r-aud', parent_name: 'auditor' }],
          },
        ],
      }),
      [`DELETE ${R}/r-aud`]: () => new Response(null, { status: 204 }),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Delete auditor' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Delete auditor?' });
  expect(dialog).toHaveTextContent('taken from every subject, group and scope');
  expect(dialog).toHaveTextContent('You hold manage-users through it');
  await user.click(within(dialog).getByRole('button', { name: 'Delete auditor' }));
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/acme/roles');
  });
});

it('offers no delete a limited operator could not make, and says why in one line', async () => {
  renderConsoleAt(
    AT,
    roleRoutes(['manage-tenant'], {
      [`GET ${R}/r-aud/composites`]: json({ items: [USERS] }, 200, { etag: '"c"' }),
    }),
  );
  expect(
    await screen.findByText(
      'auditor reaches view-users and manage-users, which you do not hold, so you cannot delete it.',
    ),
  ).toBeVisible();
  expect(screen.queryByRole('region', { name: 'Delete' })).toBeNull();
});

it('passes axe in both themes, open and built-in', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, roleRoutes()).element,
      () => screen.findByRole('button', { name: 'Delete auditor' }),
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () => consoleAt('/console/acme/roles/r-manage-users', roleRoutes()).element,
      () => screen.findByText(/so it cannot be deleted/u),
    ),
  ).toEqual({ light: [], dark: [] });
});
