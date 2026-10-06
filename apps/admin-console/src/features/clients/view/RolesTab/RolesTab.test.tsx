import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { A, clientRoutes } from '#/testing/clientsFixtures.ts';
import { json, problem } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/clients/c-bill?tab=roles';
const ROLES = `${A}/roles`;

function owned(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    description: null,
    client_id: 'c-bill',
    client_key: 'billing',
    default_for_new_subjects: false,
    created_at: '2026-09-28T08:41:53.858Z',
    admin_reach: [],
    ...extra,
  };
}

const INVOICER = owned('r-inv', 'invoicer', { description: 'Raises invoices' });
const AUDITOR = owned('r-aud', 'auditor', { default_for_new_subjects: true });

function rolesRoutes(items: readonly object[], extra = {}, capabilities?: readonly string[]) {
  return clientRoutes(capabilities, {
    [`GET ${ROLES}`]: json({ items }),
    [`GET ${ROLES}/count`]: json({ count: items.length, capped: false }),
    ...extra,
  });
}

async function open(): Promise<void> {
  await screen.findByRole('grid', { name: 'Roles of Billing' });
}

it("lists the client's own roles, counted, asking the server for that client's roles alone", async () => {
  const { sent } = renderConsoleAt(AT, rolesRoutes([INVOICER, AUDITOR]));
  await open();
  const table = screen.getByRole('grid', { name: 'Roles of Billing' });
  expect(within(table).getByText('invoicer')).toBeVisible();
  expect(within(table).getByText('Raises invoices')).toBeVisible();
  expect(within(table).getByText('get it')).toBeVisible();
  expect(await screen.findByText('2 roles')).toBeVisible();
  expect(sent.find((s) => s.path === ROLES)?.search.get('client')).toBe('c-bill');
  expect(sent.find((s) => s.path === `${ROLES}/count`)?.search.get('client')).toBe('c-bill');
  expect(screen.getByRole('link', { name: 'Open them in Roles' })).toHaveAttribute(
    'href',
    '/console/acme/roles?client=c-bill',
  );
});

it('opens a role on its own page', async () => {
  const user = userEvent.setup();
  const { router } = renderConsoleAt(AT, rolesRoutes([INVOICER]));
  await open();
  await user.click(screen.getByRole('row', { name: /invoicer/u }));
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/acme/roles/r-inv');
  });
});

it('says a client with no role of its own has none', async () => {
  renderConsoleAt(AT, rolesRoutes([]));
  expect(await screen.findByText('This client has no role of its own yet.')).toBeVisible();
});

it('makes a role scoped to the client, and clears the form', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    rolesRoutes([], { [`POST ${ROLES}`]: json(owned('r-new', 'approver'), 201) }),
  );
  await screen.findByRole('region', { name: 'New role' });
  const section = screen.getByRole('region', { name: 'New role' });
  await user.type(within(section).getByRole('textbox', { name: 'Role name' }), 'approver');
  await user.type(within(section).getByRole('textbox', { name: 'Description' }), 'Approves them');
  await user.click(within(section).getByRole('button', { name: 'Create role' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'POST')?.body).toEqual({
      name: 'approver',
      client_id: 'c-bill',
      description: 'Approves them',
    });
  });
  await waitFor(() => {
    expect(within(section).getByRole('textbox', { name: 'Role name' })).toHaveValue('');
  });
});

it('asks for a name before sending anything', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, rolesRoutes([]));
  const section = await screen.findByRole('region', { name: 'New role' });
  await user.click(within(section).getByRole('button', { name: 'Create role' }));
  expect(within(section).getByText('Enter a name.')).toBeVisible();
  expect(sent.filter((s) => s.method === 'POST')).toHaveLength(0);
});

it('places a name already in use under the name', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    rolesRoutes([], {
      [`POST ${ROLES}`]: problem(409, 'about:blank', 'Conflict', {
        detail: 'The role "approver" already exists for this client',
      }),
    }),
  );
  const section = await screen.findByRole('region', { name: 'New role' });
  await user.type(within(section).getByRole('textbox', { name: 'Role name' }), 'approver');
  await user.click(within(section).getByRole('button', { name: 'Create role' }));
  expect(
    await within(section).findByText('The role "approver" already exists for this client.'),
  ).toBeVisible();
});

it('lists the roles to a caller who can read but not make them, and says what it needs', async () => {
  renderConsoleAt(AT, rolesRoutes([INVOICER], {}, ['manage-clients', 'view-users']));
  await open();
  expect(screen.getByText(/You can view Billing's roles but not make roles/u)).toBeVisible();
  expect(screen.queryByRole('region', { name: 'New role' })).toBeNull();
});

it('says the roles need manage-tenant to a caller who can read neither way', async () => {
  renderConsoleAt(AT, rolesRoutes([], {}, ['manage-clients']));
  expect(await screen.findByRole('note')).toHaveTextContent(
    'Roles needs the manage-tenant capability.',
  );
  expect(screen.queryByRole('grid')).toBeNull();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, rolesRoutes([INVOICER, AUDITOR])).element,
      () => open(),
    ),
  ).toEqual({ light: [], dark: [] });
});
