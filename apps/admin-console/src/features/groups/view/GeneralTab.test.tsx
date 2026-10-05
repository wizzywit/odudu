import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { inTurn, json, problem } from '#/testing/fakeTransport.ts';
import { adminRole, G, group, groupRoutes, PLATFORM } from '#/testing/groupsFixtures.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';
import { assigned } from '#/testing/subjectsFixtures.ts';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/groups/g-plat';
const FULL = adminRole('tenant-admin');

it("shows a group's name as fixed, and saves its description on the ETag it read", async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    groupRoutes(undefined, {
      [`PATCH ${G}/g-plat`]: json({ ...PLATFORM, description: 'Runs it' }, 200, { etag: '"p2"' }),
    }),
  );
  expect(await screen.findByRole('heading', { level: 1, name: '/eng/platform' })).toBeVisible();
  expect(
    within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', {
      name: 'Groups',
    }),
  ).toHaveAttribute('href', '/console/acme/groups');
  expect(screen.getByText(/A group's name is fixed once it is made/u)).toBeVisible();
  expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull();
  const section = screen.getByRole('region', { name: 'Description' });
  await user.type(within(section).getByRole('textbox', { name: 'Description' }), 'Runs it');
  await user.click(within(section).getByRole('button', { name: 'Save Description' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')).toMatchObject({
      ifMatch: '"g-plat-1"',
      body: { description: 'Runs it' },
    });
  });
});

it('shows a description changed elsewhere beside yours, and sends nothing more', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    groupRoutes(undefined, {
      [`GET ${G}/g-plat`]: inTurn(
        json(PLATFORM, 200, { etag: '"g-plat-1"' }),
        json({ ...PLATFORM, description: 'Theirs' }, 200, { etag: '"g-plat-2"' }),
      ),
      [`PATCH ${G}/g-plat`]: problem(412, 'about:blank', 'Precondition Failed'),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Description' });
  await user.type(within(section).getByRole('textbox', { name: 'Description' }), 'Mine');
  await user.click(within(section).getByRole('button', { name: 'Save Description' }));
  expect(await within(section).findByText(/changed elsewhere/u)).toBeVisible();
  expect(within(section).getByRole('button', { name: 'Keep mine in Description' })).toBeVisible();
  expect(sent.filter((s) => s.method === 'PATCH')).toHaveLength(1);
});

it('moves a group, never under itself, and explains a loop or a ceiling where it happens', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    '/console/acme/groups/g-eng',
    groupRoutes(undefined, {
      [`PATCH ${G}/g-eng`]: inTurn(
        problem(409, 'about:blank', 'Conflict', { detail: 'would create a group reparent cycle' }),
        problem(403, 'about:blank', 'Forbidden', {
          detail: 'the caller does not hold: view-users',
        }),
      ),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Place in the tree' });
  expect(within(section).getByText('At the top level.')).toBeVisible();
  const parents = await within(section).findByRole('listbox', { name: 'Parent' });
  expect(within(parents).getByRole('option', { name: /platform/u })).toHaveTextContent(
    'beneath /eng, so the move would make a loop',
  );
  await user.click(within(parents).getByRole('option', { name: /finance/u }));
  expect(within(section).getByText('Under /finance.')).toBeVisible();
  await user.click(within(section).getByRole('button', { name: 'Save Place in the tree' }));
  expect(
    await within(section).findByText(/the move would make a loop. Nothing was changed./u),
  ).toBeVisible();
  expect(sent.find((s) => s.method === 'PATCH')).toMatchObject({
    ifMatch: '"g-eng-1"',
    body: { parent_id: 'g-fin' },
  });
  await user.click(within(section).getByRole('button', { name: 'Save Place in the tree' }));
  expect(
    await within(section).findByText(
      'Refused: it would hand out view-users, which you do not hold yourself.',
    ),
  ).toBeVisible();
});

it('marks a group joined by every new subject, and holds it back while it hands out a capability', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    groupRoutes(undefined, {
      [`PUT ${G}/g-plat/default`]: json({ ...PLATFORM, default_for_new_subjects: true }, 200, {
        etag: '"p3"',
      }),
    }),
  );
  const section = await screen.findByRole('region', { name: 'New subjects' });
  await user.click(
    await within(section).findByRole('switch', { name: 'Joined by every new subject' }),
  );
  await user.click(within(section).getByRole('button', { name: 'Save New subjects' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PUT')).toMatchObject({
      ifMatch: '"g-plat-1"',
      body: { default: true },
    });
  });
});

it('says why a group above handing out a capability cannot be made a default', async () => {
  renderConsoleAt(
    AT,
    groupRoutes(undefined, {
      [`GET ${G}/g-eng/roles`]: json({ items: [assigned(adminRole('view-users'))] }, 200, {
        etag: '"r"',
      }),
    }),
  );
  const section = await screen.findByRole('region', { name: 'New subjects' });
  expect(
    await within(section).findByText(/so receive view-users, and a group every new subject joins/u),
  ).toBeVisible();
  expect(within(section).queryByRole('switch')).toBeNull();
});

it('deletes a group and everything beneath it once its path is typed', async () => {
  const user = userEvent.setup();
  const { sent, router } = renderConsoleAt(
    '/console/acme/groups/g-eng',
    groupRoutes(undefined, {
      [`DELETE ${G}/g-eng`]: () => new Response(null, { status: 204 }),
    }),
  );
  await user.click(
    await screen.findByRole('button', { name: 'Delete /eng and every group beneath it' }),
  );
  const dialog = await screen.findByRole('alertdialog', { name: 'Delete /eng?' });
  expect(dialog).toHaveTextContent('deletes every group beneath it too');
  const confirm = within(dialog).getByRole('button', { name: 'Delete /eng' });
  expect(confirm).toBeDisabled();
  await user.type(within(dialog).getByRole('textbox'), '/eng');
  await user.click(confirm);
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/acme/groups');
  });
  expect(sent.filter((s) => s.method === 'DELETE')).toHaveLength(1);
  // Nothing reads the deleted group again, which would only find it gone.
  const after = sent.slice(sent.findIndex((s) => s.method === 'DELETE') + 1);
  expect(after.filter((s) => s.path.startsWith(`${G}/g-eng`))).toEqual([]);
});

it('offers no delete or move a limited operator could not make, and says why in one line', async () => {
  renderConsoleAt(
    AT,
    groupRoutes(['manage-tenant'], {
      [`GET ${G}/g-eng/roles`]: json({ items: [assigned(FULL)] }, 200, { etag: '"r"' }),
    }),
  );
  expect(
    await screen.findByText(/The groups above \/eng\/platform hand out view-users/u),
  ).toBeVisible();
  expect(screen.getByText(/so you cannot delete it/u)).toBeVisible();
  expect(screen.queryByRole('button', { name: /^Delete/u })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Delete' })).toBeNull();
  const place = screen.getByRole('region', { name: 'Place in the tree' });
  expect(within(place).queryByRole('listbox')).toBeNull();
  // The description is no door to what anybody holds, so it stays open.
  expect(screen.getByRole('textbox', { name: 'Description' })).toBeVisible();
});

it('passes axe in both themes, open and limited', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, groupRoutes()).element,
      () => screen.findByRole('listbox', { name: 'Parent' }),
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () =>
        consoleAt(
          AT,
          groupRoutes(['manage-tenant'], {
            [`GET ${G}/g-eng/roles`]: json({ items: [assigned(FULL)] }, 200, { etag: '"r"' }),
          }),
        ).element,
      () => screen.findByText(/so you cannot delete it/u),
    ),
  ).toEqual({ light: [], dark: [] });
});

it('reads a group a third level down through each parent', async () => {
  const deep = group('g-deep', '/eng/platform/deep', 'g-plat');
  renderConsoleAt(
    '/console/acme/groups/g-deep',
    groupRoutes(undefined, {
      [`GET ${G}/g-deep`]: json(deep, 200, { etag: '"d"' }),
      [`GET ${G}/g-deep/roles`]: json({ items: [] }, 200, { etag: '"dr"' }),
    }),
  );
  const place = await screen.findByRole('region', { name: 'Place in the tree' });
  expect(within(place).getByText('Under /eng/platform.')).toBeVisible();
  expect(await within(place).findByRole('listbox', { name: 'Parent' })).toBeVisible();
});
