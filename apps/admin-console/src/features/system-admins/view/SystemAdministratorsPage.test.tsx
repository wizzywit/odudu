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
    created_at: '2026-09-28T08:41:53.858Z',
  };
}

function subjects(holders: readonly unknown[], others: readonly unknown[] = []): Answer {
  return (request) => {
    const username = request.search.get('username');
    const all = request.search.get('capability') === null ? [...holders, ...others] : holders;
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

it('lists who holds manage-tenants in system, however they hold it', async () => {
  const { sent } = renderConsoleAt(AT, routes());
  expect(
    await screen.findByRole('heading', { level: 1, name: 'System administrators' }),
  ).toBeVisible();
  const table = await screen.findByRole('grid', { name: 'System administrators' });
  expect(within(table).getByText('ada')).toBeVisible();
  expect(within(table).getByText('root')).toBeVisible();
  expect(await screen.findByText('2 system administrators')).toBeVisible();
  expect(screen.getByText(/directly, through a group or under another role/u)).toBeVisible();
  const reads = sent.filter((s) => s.path === `${S}/subjects`);
  expect(reads[0]?.search.get('capability')).toBe('manage-tenants');
});

it("creates one through system's guided administrator step", async () => {
  const user = userEvent.setup();
  const { router } = renderConsoleAt(AT, routes());
  const create = await screen.findByRole('button', { name: 'Create a system administrator' });
  await waitFor(() => {
    expect(create).toBeEnabled();
  });
  await user.click(create);
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Add a system administrator' }),
  ).toBeVisible();
  expect(router.state.location.pathname).toBe('/system/system-admins/new');
  expect(
    screen
      .getByRole('navigation', { name: 'Areas of system' })
      .querySelector('[aria-current="page"]'),
  ).toHaveTextContent('System administrators');
  expect(sessionStorage.getItem(KEY)).toContain('"tenant":"system"');
});

it('grants tenant-admin to a subject chosen from system', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, routes());
  const choose = await screen.findByRole('group', { name: 'Subject in system' });
  await user.type(within(choose).getByRole('searchbox'), 'gr{Enter}');
  await user.click(await within(choose).findByRole('option', { name: /grace/u }));
  const grant = screen.getByRole('button', { name: 'Grant tenant-admin to grace' });
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
  expect(await screen.findByText('grace is now a system administrator.')).toBeVisible();
});

it('marks a subject who already holds it, from the list it already read', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, routes());
  await screen.findByRole('grid', { name: 'System administrators' });
  const choose = await screen.findByRole('group', { name: 'Subject in system' });
  const ada = await within(choose).findByRole('option', { name: /ada/u });
  expect(ada).toHaveAttribute('aria-disabled', 'true');
  expect(ada).toHaveAccessibleDescription(/already a system administrator/u);
  const grace = within(choose).getByRole('option', { name: /grace/u });
  expect(grace).not.toHaveAttribute('aria-disabled');
  expect(grace).not.toHaveAccessibleDescription(/already a system administrator/u);
  await user.click(ada);
  expect(screen.getByRole('button', { name: 'Grant tenant-admin' })).toBeDisabled();
  const perRow = sent.filter((s) => /\/subjects\/s-[a-z]+$/u.test(s.path));
  expect(perRow).toEqual([]);
});

it('marks a holder the list is narrowed away from, by one read per picker search', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(`${AT}?q=root`, routes());
  const table = await screen.findByRole('grid', { name: 'System administrators' });
  expect(within(table).queryByText('ada')).toBeNull();
  const choose = await screen.findByRole('group', { name: 'Subject in system' });
  const ada = await within(choose).findByRole('option', { name: /ada/u });
  await waitFor(() => {
    expect(ada).toHaveAccessibleDescription(/already a system administrator/u);
  });
  await user.type(within(choose).getByRole('searchbox'), 'gr{Enter}');
  await within(choose).findByRole('option', { name: /grace/u });
  const holderReads = sent.filter(
    (s) =>
      s.path === `${S}/subjects` &&
      s.search.get('capability') === 'manage-tenants' &&
      s.search.get('cursor') === null,
  );
  const byQuery = holderReads.map((s) => s.search.get('username') ?? '');
  expect(byQuery.filter((q) => q === 'gr')).toHaveLength(1);
});

it('revokes behind a typed confirmation, keeping the roles that are not an administrator’s', async () => {
  const user = userEvent.setup();
  let revoked = false;
  const { sent } = renderConsoleAt(
    AT,
    routes({
      [`GET ${S}/subjects`]: (request) => subjects(revoked ? [ROOT_ROW] : [ROOT_ROW, ADA])(request),
      [`PUT ${S}/subjects/s-ada/roles`]: (request) => {
        revoked = true;
        return json({ items: [] }, 200, { etag: '"s-ada-2"' })(request);
      },
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Revoke ada' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Revoke ada?' });
  expect(dialog).toHaveTextContent('ada loses tenant-admin and manage-tenants in system');
  const confirm = within(dialog).getByRole('button', { name: 'Revoke' });
  expect(confirm).toBeDisabled();
  await user.type(within(dialog).getByRole('textbox', { name: 'Type ada to confirm' }), 'ada');
  await user.click(confirm);
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PUT')).toMatchObject({
      path: `${S}/subjects/s-ada/roles`,
      ifMatch: '"s-ada-1"',
      body: { role_ids: ['reader'] },
    });
  });
  expect(await screen.findByText('ada is no longer a system administrator.')).toBeVisible();
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: 'Revoke ada' })).toBeNull();
  });
});

it('says when the revoked holder still holds manage-tenants some other way', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, routes());
  await user.click(await screen.findByRole('button', { name: 'Revoke ada' }));
  await user.type(
    within(await screen.findByRole('alertdialog')).getByRole('textbox'),
    'ada{Enter}',
  );
  expect(
    await screen.findByText(/who still holds manage-tenants through a group or a role/u),
  ).toBeVisible();
});

it('says so when you are about to revoke yourself', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, routes());
  await user.click(await screen.findByRole('button', { name: 'Revoke root' }));
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Revoke your own system administration?',
  });
  expect(dialog).toHaveTextContent('You are revoking your own system administration');
  expect(within(dialog).getByRole('textbox', { name: 'Type root to confirm' })).toBeVisible();
});

it('says beforehand that the only enabled holder cannot be revoked, and offers nothing', async () => {
  renderConsoleAt(
    AT,
    routes({
      [`GET ${S}/subjects`]: subjects([ROOT_ROW, subject('s-old', 'old', { enabled: false })]),
      [`GET ${S}/subjects/count`]: counted(2, 1),
    }),
  );
  const revoke = await screen.findByRole('button', { name: 'Revoke root' });
  await waitFor(() => {
    expect(revoke).toBeDisabled();
  });
  expect(revoke).toHaveAccessibleDescription(
    /root is the only enabled system administrator, so revoking them is refused/u,
  );
  expect(screen.getByRole('button', { name: 'Revoke old' })).toBeEnabled();
});

it("shows the last-administrator guard's refusal plainly when the server answers it", async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    routes({
      [`PUT ${S}/subjects/s-ada/roles`]: problem(
        409,
        'about:blank#last-administrator',
        'Conflict',
        {
          detail: 'this would leave no enabled subject holding manage-tenants',
        },
      ),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Revoke ada' }));
  const dialog = await screen.findByRole('alertdialog');
  await user.type(within(dialog).getByRole('textbox'), 'ada{Enter}');
  // Beside the action it refused: the dialog stays, saying why.
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'ada was not revoked: this would leave no enabled subject holding manage-tenants.',
  );
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('says a revoke met roles changed under it, beside the action, and changes nothing', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    routes({
      [`PUT ${S}/subjects/s-ada/roles`]: problem(412, 'about:blank', 'Precondition Failed'),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Revoke ada' }));
  const dialog = await screen.findByRole('alertdialog');
  await user.type(within(dialog).getByRole('textbox'), 'ada{Enter}');
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'ada was not revoked: their roles changed while this ran. Try again.',
  );
});

it('says a grant met roles changed under it, beside the Grant button', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    routes({
      [`PUT ${S}/subjects/s-grace/roles`]: problem(412, 'about:blank', 'Precondition Failed'),
    }),
  );
  const choose = await screen.findByRole('group', { name: 'Subject in system' });
  await user.click(await within(choose).findByRole('option', { name: /grace/u }));
  const grant = screen.getByRole('button', { name: 'Grant tenant-admin to grace' });
  await waitFor(() => {
    expect(grant).toBeEnabled();
  });
  await user.click(grant);
  const section = screen.getByRole('region', { name: 'Grant to an existing subject' });
  expect(
    await within(section).findByText(
      'grace was not granted tenant-admin: their roles changed while this ran. Try again.',
    ),
  ).toBeVisible();
});

it('does not call a revoke done when whether they still hold it could not be checked', async () => {
  const user = userEvent.setup();
  const service = subject('s-svc', 'unused', { type: 'service', username: null, email: null });
  renderConsoleAt(
    AT,
    routes({
      [`GET ${S}/subjects`]: subjects([ROOT_ROW, service]),
      ...roles('s-svc', ['r-admin']),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Revoke s-svc' }));
  await user.type(
    within(await screen.findByRole('alertdialog')).getByRole('textbox'),
    's-svc{Enter}',
  );
  expect(
    await screen.findByText(
      'tenant-admin and manage-tenants were taken from s-svc. Whether they still hold manage-tenants another way could not be checked: the list shows it.',
    ),
  ).toBeVisible();
  expect(screen.queryByText('s-svc is no longer a system administrator.')).toBeNull();
});

it('changes nothing for a holder who holds it only through a group or another role', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, routes(roles('s-ada', ['reader'])));
  await user.click(await screen.findByRole('button', { name: 'Revoke ada' }));
  const dialog = await screen.findByRole('alertdialog');
  await user.type(within(dialog).getByRole('textbox'), 'ada{Enter}');
  const alert = await within(dialog).findByRole('alert');
  expect(alert).toHaveTextContent(
    'Nothing was changed: ada holds manage-tenants only through a group or a role that nests it. Change that group or role from ada’s record.',
  );
  expect(within(alert).getByRole('link', { name: 'ada’s record' })).toHaveAttribute(
    'href',
    '/console/system/subjects/s-ada',
  );
  expect(sent.some((s) => s.method === 'PUT')).toBe(false);
  // Pressing it again would change nothing again.
  expect(within(dialog).getByRole('button', { name: 'Revoke' })).toBeDisabled();
});

it('names what a limited operator lacks, rather than offering what the server would refuse', async () => {
  const { sent } = renderConsoleAt(
    AT,
    routes({ [`GET ${S}/whoami`]: whoami(['manage-tenants', 'view-users']) }),
  );
  await screen.findByRole('grid', { name: 'System administrators' });
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Create a system administrator' })).toBeDisabled();
  });
  expect(screen.getByRole('button', { name: 'Revoke ada' })).toBeDisabled();
  const notes = screen.getAllByRole('note').map((note) => note.textContent);
  expect(notes).toContain('Creating a system administrator needs the manage-users capability.');
  expect(notes).toContain('Granting or revoking tenant-admin needs the manage-keys capability.');
  expect(sent.filter((s) => s.method !== 'GET')).toHaveLength(0);
});

it('is no page for a tenant administrator', async () => {
  renderConsoleAt('/console/acme/system-admins', {
    'GET /console/api/session': json(GRACE),
    [`GET ${ADMIN}/acme/whoami`]: whoami(['manage-tenant']),
  });
  expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
});

it('passes axe in both themes with a refusal in the revoke dialog', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, routes(roles('s-ada', ['reader']))).element,
      async () => {
        await user.click(await screen.findByRole('button', { name: 'Revoke ada' }));
        const dialog = await screen.findByRole('alertdialog');
        await user.type(within(dialog).getByRole('textbox'), 'ada{Enter}');
        await within(dialog).findByRole('alert');
      },
    ),
  ).toEqual({ light: [], dark: [] });
});

it('passes axe in both themes: the list, the only holder, and the revoke dialog', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, routes()).element,
      () => screen.findByRole('grid', { name: 'System administrators' }),
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () =>
        consoleAt(
          AT,
          routes({
            [`GET ${S}/subjects`]: subjects([ROOT_ROW]),
            [`GET ${S}/subjects/count`]: counted(1),
          }),
        ).element,
      async () => {
        await waitFor(() => {
          expect(screen.getByRole('button', { name: 'Revoke root' })).toBeDisabled();
        });
      },
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, routes()).element,
      async () => {
        await user.click(await screen.findByRole('button', { name: 'Revoke ada' }));
        await screen.findByRole('alertdialog');
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
