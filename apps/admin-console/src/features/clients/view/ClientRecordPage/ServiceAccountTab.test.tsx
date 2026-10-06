import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { A, BILLING, C, clientRoutes, serviceAccountOf } from '#/testing/clientsFixtures.ts';
import { json, problem } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';
import { role } from '#/testing/subjectsFixtures.ts';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/clients/c-bill?tab=service';
const SERVICE = serviceAccountOf('c-bill');
const SERVICE_ROLES = `${A}/subjects/${SERVICE}/roles`;

const READER = role('r-read', 'reader');
const PORTAL_READER = role('r-portal', 'reader', 'portal');
const MANAGE_USERS = role('r-mu', 'manage-users', 'odudu-admin');
const NESTING = { ...role('r-nest', 'nesting'), admin_reach: ['manage-keys'] };
const CATALOGUE = [READER, PORTAL_READER, MANAGE_USERS, NESTING];

function assigned(...held: (typeof READER)[]) {
  return {
    items: held.map(({ id, name, client_id, client_key }) => ({ id, name, client_id, client_key })),
  };
}

function serviceRoutes(held: (typeof READER)[], extra = {}, capabilities?: readonly string[]) {
  return clientRoutes(capabilities, {
    [`GET ${SERVICE_ROLES}`]: json(assigned(...held), 200, { etag: '"sr-1"' }),
    [`GET ${A}/roles`]: (request) =>
      json({
        items: CATALOGUE.filter((each) => each.name.startsWith(request.search.get('name') ?? '')),
      })(request),
    ...extra,
  });
}

async function open(): Promise<void> {
  await screen.findByRole('region', { name: 'Roles' });
}

it("lists the roles of the client's service account, each with whose it is", async () => {
  renderConsoleAt(AT, serviceRoutes([READER, PORTAL_READER]));
  await open();
  const list = screen.getByRole('list', { name: "Assigned to Billing's service account" });
  expect(
    within(list)
      .getAllByRole('listitem')
      .map((item) => item.textContent),
  ).toEqual(['reader · tenant role', 'reader · Scoped to portal.']);
  expect(screen.getByText('2 roles assigned.')).toBeVisible();
});

it('sets the roles through the account it names, on the ETag it read, keeping its admin capabilities', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    serviceRoutes([MANAGE_USERS], {
      [`PUT ${SERVICE_ROLES}`]: json(assigned(MANAGE_USERS, READER), 200, { etag: '"sr-2"' }),
    }),
  );
  await open();
  const section = screen.getByRole('region', { name: 'Roles' });
  expect(within(section).getByText(/It also holds manage-users/u)).toBeVisible();
  await user.click(await within(section).findByRole('option', { name: 'reader, a tenant role' }));
  await user.click(within(section).getByRole('button', { name: 'Save Roles' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PUT')).toMatchObject({
      path: SERVICE_ROLES,
      ifMatch: '"sr-1"',
      body: { role_ids: ['r-read', 'r-mu'] },
    });
  });
});

it('reads the client again once its roles are set, since they decide its ceiling', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    serviceRoutes([], {
      [`PUT ${SERVICE_ROLES}`]: json(assigned(READER), 200, { etag: '"sr-2"' }),
    }),
  );
  await open();
  const section = screen.getByRole('region', { name: 'Roles' });
  await user.click(await within(section).findByRole('option', { name: 'reader, a tenant role' }));
  await user.click(within(section).getByRole('button', { name: 'Save Roles' }));
  await waitFor(() => {
    expect(sent.filter((s) => s.method === 'GET' && s.path === `${C}/c-bill`)).toHaveLength(2);
  });
});

it('keeps the admin capabilities and the roles that reach one the caller lacks from being chosen', async () => {
  renderConsoleAt(AT, serviceRoutes([], {}, ['manage-clients', 'manage-users', 'view-users']));
  await open();
  const section = screen.getByRole('region', { name: 'Roles' });
  const admin = await within(section).findByRole('option', { name: /manage-users/u });
  expect(admin).toHaveTextContent('an admin capability, set on the service account itself');
  const nesting = await within(section).findByRole('option', { name: /nesting/u });
  expect(nesting).toHaveTextContent('reaches manage-keys, which you do not hold');
});

it('searches the tenant roles on the server', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, serviceRoutes([]));
  await open();
  const section = screen.getByRole('region', { name: 'Roles' });
  await user.type(
    await within(section).findByRole('searchbox', { name: 'Search roles by name' }),
    'rea',
  );
  await user.click(within(section).getByRole('button', { name: 'Search' }));
  await waitFor(() => {
    expect(sent.some((s) => s.path === `${A}/roles` && s.search.get('name') === 'rea')).toBe(true);
  });
});

it("shows the server's refusal of the ceiling beside the save, and reads the client again", async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    serviceRoutes([], {
      [`PUT ${SERVICE_ROLES}`]: problem(403, 'about:blank', 'Forbidden', {
        detail: "the client's service account holds what the caller does not: manage-keys",
      }),
    }),
  );
  await open();
  const section = screen.getByRole('region', { name: 'Roles' });
  await user.click(await within(section).findByRole('option', { name: 'reader, a tenant role' }));
  await user.click(within(section).getByRole('button', { name: 'Save Roles' }));
  expect(
    await within(section).findByText(/service account holds what the caller does not/u),
  ).toBeVisible();
  await waitFor(() => {
    expect(
      sent.filter((s) => s.method === 'GET' && s.path === `${C}/c-bill`).length,
    ).toBeGreaterThan(1);
  });
});

it('needs manage-users, and says so in place of the roles', async () => {
  const { sent } = renderConsoleAt(AT, serviceRoutes([], {}, ['manage-clients', 'view-users']));
  expect(await screen.findByRole('note')).toHaveTextContent(
    "The service account's roles needs the manage-users capability.",
  );
  expect(sent.some((s) => s.path === SERVICE_ROLES)).toBe(false);
});

it('says a public client has no service account to give roles to', async () => {
  renderConsoleAt('/console/acme/clients/c-portal?tab=service', clientRoutes());
  expect(await screen.findByText(/This client has no service account/u)).toBeVisible();
});

it('shows the roles as text, and no picker, while the account holds what the caller does not', async () => {
  renderConsoleAt(
    AT,
    serviceRoutes(
      [READER],
      {
        [`GET ${C}/c-bill`]: json(
          { ...BILLING, service_account_admin_reach: ['manage-keys'] },
          200,
          {
            etag: '"c-bill-1"',
          },
        ),
      },
      ['manage-clients', 'manage-users', 'view-users'],
    ),
  );
  await open();
  expect(
    within(screen.getByRole('list', { name: "Assigned to Billing's service account" })).getByRole(
      'listitem',
    ),
  ).toHaveTextContent('reader · tenant role');
  await waitFor(() => {
    expect(screen.queryByRole('listbox')).toBeNull();
  });
  expect(screen.queryByRole('button', { name: 'Save Roles' })).toBeNull();
});

it('links to the service account itself, where its admin capabilities are set', async () => {
  renderConsoleAt(AT, serviceRoutes([]));
  await open();
  expect(screen.getByRole('link', { name: 'Open the service account' })).toHaveAttribute(
    'href',
    `/console/acme/subjects/${SERVICE}`,
  );
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, serviceRoutes([READER, MANAGE_USERS])).element,
      () => screen.findByRole('option', { name: /nesting/u }),
    ),
  ).toEqual({ light: [], dark: [] });
});
