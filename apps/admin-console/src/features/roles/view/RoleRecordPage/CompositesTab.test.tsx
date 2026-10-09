import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { json, problem } from '#/testing/fakeTransport.ts';
import { adminRole } from '#/testing/groupsFixtures.ts';
import { R, READER, roleRoutes } from '#/testing/rolesFixtures.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/roles/r-aud?tab=composites';
const C = `${R}/r-aud/composites`;

it('nests a role on the ETag the list was read with, and reads the list again', async () => {
  const user = userEvent.setup();
  let nested = false;
  const { sent } = renderConsoleAt(
    AT,
    roleRoutes(undefined, {
      [`GET ${C}`]: (request) =>
        (nested
          ? json({ items: [READER] }, 200, { etag: '"c2"' })
          : json({ items: [] }, 200, { etag: '"c1"' }))(request),
      [`POST ${C}`]: () => {
        nested = true;
        return new Response(null, { status: 204, headers: { etag: '"c2"' } });
      },
    }),
  );
  expect(await screen.findByText('auditor nests no role.')).toBeVisible();
  const add = screen.getByRole('region', { name: 'Add a composite' });
  const options = await within(add).findByRole('listbox', { name: 'Role to nest in auditor' });
  expect(within(options).getByRole('option', { name: 'auditor, a tenant role' })).toHaveTextContent(
    'this role itself',
  );
  await user.click(within(options).getByRole('option', { name: 'reader, a tenant role' }));
  await user.click(within(add).getByRole('button', { name: 'Nest it in auditor' }));
  expect(await screen.findByRole('list', { name: 'Nested in auditor' })).toHaveTextContent(
    'reader',
  );
  expect(sent.find((s) => s.method === 'POST')).toMatchObject({
    ifMatch: '"c1"',
    body: { child_role_id: 'r-read' },
  });
});

it('explains a loop where it was asked for', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    roleRoutes(undefined, {
      [`POST ${C}`]: problem(409, 'about:blank', 'Conflict', {
        detail: 'would create a role composite cycle',
      }),
    }),
  );
  const add = await screen.findByRole('region', { name: 'Add a composite' });
  const options = await within(add).findByRole('listbox', { name: 'Role to nest in auditor' });
  await user.click(within(options).getByRole('option', { name: 'reader, a tenant role' }));
  await user.click(within(add).getByRole('button', { name: 'Nest it in auditor' }));
  expect(
    await within(add).findByText(
      'Refused: the role chosen already includes this role, so nesting it here would make a loop.',
    ),
  ).toBeVisible();
});

it('takes a role out on the ETag, and says when the list changed under it', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    roleRoutes(undefined, {
      [`GET ${C}`]: json({ items: [READER] }, 200, { etag: '"c1"' }),
      [`DELETE ${C}/r-read`]: problem(412, 'about:blank', 'Precondition Failed'),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Take reader out' }));
  expect(await screen.findByText(/composites changed since you opened them/u)).toBeVisible();
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'DELETE')?.ifMatch).toBe('"c1"');
  });
});

it('keeps a capability the caller lacks in place, with the reason beside it', async () => {
  renderConsoleAt(
    AT,
    roleRoutes(['manage-tenant'], {
      [`GET ${C}`]: json({ items: [adminRole('manage-keys')] }, 200, { etag: '"c1"' }),
    }),
  );
  const nested = await screen.findByRole('list', { name: 'Nested in auditor' });
  expect(
    await within(nested).findByText('You do not hold manage-keys, so you cannot give or take it.'),
  ).toBeVisible();
  expect(within(nested).queryByRole('button')).toBeNull();
});

it("shows a capability role's composites as fixed", async () => {
  renderConsoleAt(
    '/console/acme/roles/r-full?tab=composites',
    roleRoutes(undefined, {
      [`GET ${R}/r-full/composites`]: json({ items: [adminRole('manage-users')] }, 200, {
        etag: '"f"',
      }),
    }),
  );
  expect(await screen.findByText(/keeps the roles it was provisioned with/u)).toBeVisible();
  expect(screen.queryByRole('region', { name: 'Add a composite' })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Take .* out$/u })).toBeNull();
});

it('passes axe in both themes, nested and fixed', async () => {
  expect(
    await axeInBothThemes(
      () =>
        consoleAt(
          AT,
          roleRoutes(undefined, {
            [`GET ${C}`]: json({ items: [READER] }, 200, { etag: '"c1"' }),
          }),
        ).element,
      () => screen.findByRole('listbox', { name: 'Role to nest in auditor' }),
    ),
  ).toEqual({ light: [], dark: [] });
});

it('never offers a role reaching what the caller lacks, however deep it nests it', async () => {
  const deep = { ...READER, id: 'r-deep', name: 'deep', admin_reach: ['view-audit'] };
  renderConsoleAt(
    AT,
    roleRoutes(['manage-tenant'], { [`GET ${R}`]: json({ items: [READER, deep] }) }),
  );
  const options = await screen.findByRole('listbox', { name: 'Role to nest in auditor' });
  expect(within(options).getByRole('option', { name: 'deep, a tenant role' })).toHaveTextContent(
    'It reaches view-audit, which you do not hold, so you cannot give or take it.',
  );
});
