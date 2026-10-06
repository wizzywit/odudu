import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { json, problem } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';
import { ADMIN, systemRoutes } from '#/testing/tenantsFixtures.ts';
import { A, ADA_AT, ADA_ID, group, S, subjectRoutes } from '#/testing/subjectsFixtures.ts';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = `${ADA_AT}?tab=groups`;
const G = `${S}/${ADA_ID}/groups`;
const OPS = group('g-ops', '/ops', 'Runs production');
const FINANCE = group('g-fin', '/finance');

it("lists the subject's groups, and joins another on the ETag it read", async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    subjectRoutes(undefined, {
      [`GET ${G}`]: json({ items: [OPS] }, 200, { etag: '"g1"' }),
      [`GET ${A}/groups`]: json({ items: [OPS, FINANCE] }),
      [`PUT ${G}`]: json({ items: [FINANCE, OPS] }, 200, { etag: '"g2"' }),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Groups' });
  expect(within(section).getByRole('list', { name: 'ada belongs to' })).toHaveTextContent('/ops');
  const options = await within(section).findByRole('listbox', { name: 'Groups ada belongs to' });
  await user.click(within(options).getByRole('option', { name: /finance/u }));
  await user.click(within(section).getByRole('button', { name: 'Save Groups' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PUT')).toMatchObject({
      ifMatch: '"g1"',
      body: { group_ids: ['g-fin', 'g-ops'] },
    });
  });
  expect(screen.getByRole('tab', { name: 'Groups' })).toBeVisible();
});

it('says in place why a membership reaching past the caller was refused', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    subjectRoutes(undefined, {
      [`GET ${A}/groups`]: json({ items: [OPS] }),
      [`PUT ${G}`]: problem(403, 'about:blank', 'Forbidden'),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Groups' });
  await user.click(await within(section).findByRole('option', { name: /ops/u }));
  await user.click(within(section).getByRole('button', { name: 'Save Groups' }));
  expect(await within(section).findByText(/a group's roles are granted with it/u)).toBeVisible();
});

it('keeps a departure asked about during a save held when that save is refused', async () => {
  const user = userEvent.setup();
  let answer: (response: Response) => void = () => undefined;
  renderConsoleAt(
    AT,
    subjectRoutes(undefined, {
      [`GET ${A}/groups`]: json({ items: [OPS] }),
      [`PUT ${G}`]: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Groups' });
  await user.click(await within(section).findByRole('option', { name: /ops/u }));
  await user.click(within(section).getByRole('button', { name: 'Save Groups' }));
  await user.click(screen.getByRole('tab', { name: 'Roles' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Leave without saving?' });
  answer(
    new Response(
      JSON.stringify({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'no' }),
      { status: 409, headers: { 'content-type': 'application/problem+json' } },
    ),
  );
  expect(await within(section).findByText('no')).toBeVisible();
  expect(dialog).toBeVisible();
  expect(dialog).toHaveTextContent('Groups');
  expect(screen.getByRole('tab', { name: /Groups/u, hidden: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

it("asks for the name, typed, before leaving a group takes another's manage-tenants", async () => {
  const user = userEvent.setup();
  const VS = `${ADMIN}/system/subjects/s-vera`;
  const ONCALL = group('g-oncall', '/admins/oncall');
  const { sent } = renderConsoleAt(
    '/console/system/subjects/s-vera?tab=groups',
    systemRoutes({
      [`GET ${VS}`]: json(
        {
          id: 's-vera',
          type: 'user',
          username: 'vera',
          email: null,
          enabled: true,
          created_at: '2026-09-28T08:41:53.858Z',
        },
        200,
        { etag: '"v1"' },
      ),
      [`GET ${VS}/admin-capabilities`]: json({
        items: [
          {
            id: 'r-full',
            name: 'tenant-admin',
            client_id: 'c-admin',
            client_key: 'odudu-admin',
            via: [{ kind: 'group', group_id: 'g-admins', group_path: '/admins' }],
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
      [`GET ${VS}/groups`]: json({ items: [ONCALL] }, 200, { etag: '"g1"' }),
      [`GET ${ADMIN}/system/groups`]: json({ items: [ONCALL] }),
      [`PUT ${VS}/groups`]: json({ items: [] }, 200, { etag: '"g2"' }),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Groups' });
  await user.click(await within(section).findByRole('option', { name: /oncall/u }));
  await user.click(within(section).getByRole('button', { name: 'Save Groups' }));
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Take system administration from vera?',
  });
  expect(sent.some((s) => s.method === 'PUT')).toBe(false);
  await user.type(within(dialog).getByRole('textbox'), 'vera');
  await user.click(within(dialog).getByRole('button', { name: 'Save Groups' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PUT')).toMatchObject({ body: { group_ids: [] } });
  });
});

it('shows a limited operator the memberships and no way to change them', async () => {
  renderConsoleAt(
    AT,
    subjectRoutes(['view-users'], {
      [`GET ${G}`]: json({ items: [OPS] }, 200, { etag: '"g1"' }),
    }),
  );
  expect(await screen.findByRole('list', { name: 'ada belongs to' })).toHaveTextContent(
    'Runs production',
  );
  expect(screen.queryByRole('listbox')).toBeNull();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () =>
        consoleAt(
          AT,
          subjectRoutes(undefined, {
            [`GET ${G}`]: json({ items: [OPS] }, 200, { etag: '"g1"' }),
            [`GET ${A}/groups`]: json({ items: [OPS, FINANCE] }),
          }),
        ).element,
      () => screen.findByRole('listbox', { name: 'Groups ada belongs to' }),
    ),
  ).toEqual({ light: [], dark: [] });
});
