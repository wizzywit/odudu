import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { json, problem, type Sent } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';
import {
  A,
  ADA_AT,
  ADA_ID,
  ADMIN_ROLES,
  assigned,
  role,
  S,
  subjectRoutes,
} from '#/testing/subjectsFixtures.ts';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = `${ADA_AT}?tab=roles`;
const R = `${S}/${ADA_ID}/roles`;
const E = `${S}/${ADA_ID}/effective-roles`;
const BILLING = role('r-billing', 'billing-reader');
const AUDITOR = role('r-auditor', 'billing-auditor');
const FULL = ADMIN_ROLES[0] ?? role('r-full', 'tenant-admin', 'odudu-admin');

function held(r: ReturnType<typeof role>, via: unknown[]) {
  return { ...assigned(r), via };
}

const roleList = (request: Sent) =>
  json({
    items:
      request.search.get('client') === 'c-odudu-admin'
        ? ADMIN_ROLES
        : request.search.get('name') === 'tenant-admin'
          ? [FULL]
          : [BILLING, AUDITOR, FULL],
  })(request);

it('shows every role the subject holds, and how', async () => {
  renderConsoleAt(
    AT,
    subjectRoutes(undefined, {
      [`GET ${R}`]: json({ items: [assigned(AUDITOR)] }, 200, { etag: '"r1"' }),
      [`GET ${E}`]: json({
        items: [
          held(BILLING, [
            { kind: 'group', group_id: 'g', group_path: '/finance' },
            { kind: 'composite', parent_role_id: 'r-auditor', parent_name: 'billing-auditor' },
          ]),
          held(AUDITOR, [{ kind: 'direct' }]),
        ],
      }),
    }),
  );
  const table = await screen.findByRole('grid', { name: 'Every role ada holds' });
  expect(within(table).getByRole('row', { name: /billing-reader/u })).toHaveTextContent(
    'through group /finance, within billing-auditor',
  );
  expect(within(table).getByRole('row', { name: /billing-auditor/u })).toHaveTextContent(
    'directly',
  );
});

it('assigns a role, sending the admin capabilities back as they were', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    subjectRoutes(undefined, {
      [`GET ${R}`]: json({ items: [assigned(FULL)] }, 200, { etag: '"r1"' }),
      [`GET ${A}/roles`]: roleList,
      [`PUT ${R}`]: json({ items: [assigned(FULL), assigned(BILLING)] }, 200, { etag: '"r2"' }),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Roles' });
  const list = await within(section).findByRole('listbox', { name: 'Roles ada holds directly' });
  expect(within(list).getByRole('option', { name: /tenant-admin/u })).toHaveTextContent(
    'set it under Admin capabilities',
  );
  await user.click(within(list).getByRole('option', { name: /billing-reader/u }));
  await user.click(within(section).getByRole('button', { name: 'Save Roles' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PUT')).toMatchObject({
      ifMatch: '"r1"',
      body: { role_ids: ['r-billing', 'r-full'] },
    });
  });
});

it('changes the admin capabilities by checkbox, keeping the other roles', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    subjectRoutes(undefined, {
      [`GET ${R}`]: json({ items: [assigned(BILLING), assigned(FULL)] }, 200, { etag: '"r1"' }),
      [`PUT ${R}`]: json({ items: [assigned(BILLING)] }, 200, { etag: '"r2"' }),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Admin capabilities' });
  const full = await within(section).findByRole('checkbox', { name: 'Full (tenant-admin)' });
  expect(full).toBeChecked();
  expect(
    within(section).getByRole('checkbox', { name: 'manage-keys' }),
  ).toHaveAccessibleDescription(/Carried by Full/u);
  await user.click(full);
  await user.click(within(section).getByRole('checkbox', { name: 'view-audit' }));
  await user.click(within(section).getByRole('button', { name: 'Save Admin capabilities' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PUT')).toMatchObject({
      ifMatch: '"r1"',
      body: { role_ids: ['r-billing', 'r-view-audit'] },
    });
  });
});

it('says how a capability not assigned here is held, and where it is changed', async () => {
  renderConsoleAt(
    AT,
    subjectRoutes(undefined, {
      [`GET ${E}`]: json({
        items: [
          held(role('r-view-audit', 'view-audit', 'odudu-admin'), [
            { kind: 'group', group_id: 'g', group_path: '/auditors' },
          ]),
        ],
      }),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Admin capabilities' });
  expect(
    await within(section).findByRole('checkbox', { name: 'view-audit' }),
  ).toHaveAccessibleDescription(/Held through group \/auditors\./u);
  expect(within(section).getByRole('link', { name: 'Groups' })).toHaveAttribute(
    'href',
    `${ADA_AT}?tab=groups`,
  );
});

it('holds back each capability the caller does not hold, saying why', async () => {
  renderConsoleAt(AT, subjectRoutes(['view-users', 'manage-users', 'view-audit']));
  const section = await screen.findByRole('region', { name: 'Admin capabilities' });
  const keys = await within(section).findByRole('checkbox', { name: 'manage-keys' });
  expect(keys).toBeDisabled();
  expect(keys).toHaveAccessibleDescription(/You do not hold manage-keys/u);
  expect(within(section).getByRole('checkbox', { name: 'Full (tenant-admin)' })).toBeDisabled();
  expect(within(section).getByRole('checkbox', { name: 'view-audit' })).toBeEnabled();
});

it('offers no change to a subject holding a capability the caller does not', async () => {
  renderConsoleAt(
    AT,
    subjectRoutes(['view-users', 'manage-users'], {
      [`GET ${E}`]: json({
        items: [held(role('r-manage-keys', 'manage-keys', 'odudu-admin'), [{ kind: 'direct' }])],
      }),
    }),
  );
  expect(
    await screen.findByText(
      'ada holds manage-keys, which you do not, so you can view ada but change nothing here.',
    ),
  ).toBeVisible();
  await screen.findByRole('region', { name: 'Admin capabilities' });
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByRole('listbox')).toBeNull();
});

it('words the last-administrator guard in place', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    subjectRoutes(undefined, {
      [`GET ${R}`]: json({ items: [assigned(FULL)] }, 200, { etag: '"r1"' }),
      [`PUT ${R}`]: problem(409, 'about:blank#last-administrator', 'Conflict', {
        detail: 'this would leave no enabled subject holding tenant-admin',
      }),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Admin capabilities' });
  await user.click(await within(section).findByRole('checkbox', { name: 'Full (tenant-admin)' }));
  await user.click(within(section).getByRole('button', { name: 'Save Admin capabilities' }));
  expect(
    await within(section).findByText(/ada is the last enabled administrator here/u),
  ).toBeVisible();
});

it('shows a limited operator what is held, as text', async () => {
  renderConsoleAt(
    AT,
    subjectRoutes(['view-users'], {
      [`GET ${R}`]: json({ items: [assigned(FULL), assigned(BILLING)] }, 200, { etag: '"r1"' }),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Admin capabilities' });
  expect(await within(section).findByText('Full (tenant-admin)')).toBeVisible();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByRole('listbox')).toBeNull();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () =>
        consoleAt(
          AT,
          subjectRoutes(['view-users', 'manage-users', 'view-audit'], {
            [`GET ${R}`]: json({ items: [assigned(BILLING)] }, 200, { etag: '"r1"' }),
            [`GET ${A}/roles`]: roleList,
            [`GET ${E}`]: json({ items: [held(BILLING, [{ kind: 'direct' }])] }),
          }),
        ).element,
      async () => {
        await screen.findByRole('listbox', { name: 'Roles ada holds directly' });
        await screen.findByRole('checkbox', { name: 'manage-keys' });
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
