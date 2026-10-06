import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { json } from '#/testing/fakeTransport.ts';
import {
  adminRole,
  AUDITOR,
  ENG,
  G,
  groupRoutes,
  mapped,
  record,
  PORTAL_READER,
} from '#/testing/groupsFixtures.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';
import { assigned, S } from '#/testing/subjectsFixtures.ts';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/groups/g-eng?tab=roles';
const R = `${G}/g-eng/roles`;
const KEYS = adminRole('manage-keys');

it('lists the roles a group carries, a client role told apart, and replaces them on the ETag', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    groupRoutes(undefined, {
      [`GET ${R}`]: json({ items: [mapped(PORTAL_READER)] }, 200, { etag: '"r1"' }),
      [`PUT ${R}`]: json({ items: [mapped(AUDITOR), mapped(PORTAL_READER)] }, 200, {
        etag: '"r2"',
      }),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Roles' });
  const listed = within(section).getByRole('list', { name: 'Carried by /eng' });
  expect(listed).toHaveTextContent('reader');
  expect(listed).toHaveTextContent('client portal');
  const options = await within(section).findByRole('listbox', { name: 'Roles /eng carries' });
  expect(within(options).getByRole('option', { name: 'auditor, a tenant role' })).toHaveTextContent(
    'Reads the books',
  );
  await user.click(within(options).getByRole('option', { name: 'auditor, a tenant role' }));
  await user.click(within(section).getByRole('button', { name: 'Save Roles' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PUT')).toMatchObject({
      ifMatch: '"r1"',
      body: { role_ids: ['r-aud', 'r-portal'] },
    });
  });
});

it('reads each mapped role reach from the one answer', async () => {
  const { sent } = renderConsoleAt(
    AT,
    groupRoutes(undefined, {
      [`GET ${R}`]: json({ items: [mapped(AUDITOR), mapped(PORTAL_READER)] }, 200, {
        etag: '"r1"',
      }),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Roles' });
  await within(section).findByRole('listbox', { name: 'Roles /eng carries' });
  expect(sent.filter((s) => /\/roles\/[^/]+$/u.test(s.path))).toEqual([]);
});

it('offers no capability-handing role to a group with a default beneath it, and says why', async () => {
  renderConsoleAt(
    AT,
    groupRoutes(undefined, {
      [`GET ${G}/g-eng`]: json(record(ENG, [], true), 200, { etag: '"g-eng-1"' }),
      [`GET ${R}`]: json({ items: [] }, 200, { etag: '"r1"' }),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Roles' });
  const options = await within(section).findByRole('listbox', { name: 'Roles /eng carries' });
  expect(
    within(options).getByRole('option', { name: 'view-users, a role of client odudu-admin' }),
  ).toHaveTextContent('Every new subject joins a group beneath this one');
  expect(
    within(options).getByRole('option', { name: 'auditor, a tenant role' }),
  ).not.toHaveTextContent('Every new subject joins');
});

it('keeps a capability the caller lacks out of reach, given or taken', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    groupRoutes(['manage-tenant', 'view-users'], {
      [`GET ${R}`]: json({ items: [mapped(KEYS)] }, 200, { etag: '"r1"' }),
      [`PUT ${R}`]: json({ items: [] }, 200, { etag: '"r2"' }),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Roles' });
  const options = await within(section).findByRole('listbox', { name: 'Roles /eng carries' });
  expect(
    within(options).getByRole('option', { name: 'tenant-admin, a role of client odudu-admin' }),
  ).toHaveTextContent('Full carries capabilities you do not hold');
  await user.click(within(options).getByRole('option', { name: 'auditor, a tenant role' }));
  await user.click(
    within(options).getByRole('option', { name: 'manage-keys, a role of client odudu-admin' }),
  );
  expect(within(section).getByText(/cannot take away either/u)).toBeVisible();
  await user.click(within(section).getByRole('button', { name: 'Save Roles' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PUT')?.body).toEqual({
      role_ids: ['r-aud', 'r-manage-keys'],
    });
  });
});

it('asks first when a role taken off the group is one you hold through it', async () => {
  const user = userEvent.setup();
  const AUDIT = adminRole('view-audit');
  const { sent } = renderConsoleAt(
    AT,
    groupRoutes(undefined, {
      [`GET ${R}`]: json({ items: [mapped(AUDIT)] }, 200, { etag: '"r1"' }),
      [`GET ${S}/s1/admin-capabilities`]: json({
        items: [
          {
            ...assigned(AUDIT),
            via: [{ kind: 'group', group_id: 'g-eng', group_path: '/eng' }],
          },
        ],
        complete: true,
      }),
      [`GET ${S}/s1/groups`]: json({ items: [ENG] }, 200, { etag: '"m"' }),
      [`PUT ${R}`]: json({ items: [] }, 200, { etag: '"r2"' }),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Roles' });
  const options = await within(section).findByRole('listbox', { name: 'Roles /eng carries' });
  await user.click(
    within(options).getByRole('option', { name: 'view-audit, a role of client odudu-admin' }),
  );
  await user.click(within(section).getByRole('button', { name: 'Save Roles' }));
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Take roles your own access runs through?',
  });
  expect(dialog).toHaveTextContent('You hold view-audit through /eng');
  expect(sent.some((s) => s.method === 'PUT')).toBe(false);
  await user.click(within(dialog).getByRole('button', { name: 'Save Roles' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PUT')?.body).toEqual({ role_ids: [] });
  });
});

it('passes axe in both themes, mapped and asking', async () => {
  const user = userEvent.setup();
  const AUDIT = adminRole('view-audit');
  expect(
    await axeInBothThemes(
      () =>
        consoleAt(
          AT,
          groupRoutes(undefined, {
            [`GET ${R}`]: json({ items: [mapped(AUDIT), mapped(PORTAL_READER)] }, 200, {
              etag: '"r1"',
            }),
            [`GET ${S}/s1/admin-capabilities`]: json({
              items: [
                {
                  ...assigned(AUDIT),
                  via: [{ kind: 'group', group_id: 'g-eng', group_path: '/eng' }],
                },
              ],
              complete: true,
            }),
            [`GET ${S}/s1/groups`]: json({ items: [ENG] }, 200, { etag: '"m"' }),
          }),
        ).element,
      async () => {
        const options = await screen.findByRole('listbox', { name: 'Roles /eng carries' });
        await user.click(
          within(options).getByRole('option', { name: 'view-audit, a role of client odudu-admin' }),
        );
        await user.click(screen.getByRole('button', { name: 'Save Roles' }));
        await screen.findByRole('alertdialog', {
          name: 'Take roles your own access runs through?',
        });
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
