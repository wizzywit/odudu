import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { BILLING, C, clientRoutes } from '#/testing/clientsFixtures';
import { inTurn, json, pending, problem, whoamiReads } from '#/testing/fakeTransport';
import { resetConsole } from '#/testing/resetConsole';
import { ACME_ADMIN } from '#/testing/tenantPaths';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { BILLING_CARRIES, carrier, SC, scopeRoutes } from '#/testing/scopesFixtures';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/scopes/s-bill?tab=clients';

async function open() {
  return screen.findByRole('region', { name: 'Clients carrying billing' });
}

it('lists the clients that carry the scope by name and client id, each with its assignment', async () => {
  const { sent } = renderConsoleAt(AT, scopeRoutes());
  await open();
  const list = await screen.findByRole('list', { name: 'Clients carrying billing' });
  const row = within(list).getByRole('listitem');
  expect(row).toHaveTextContent('Billing');
  expect(row).toHaveTextContent('billing');
  expect(within(row).getByRole('button', { name: /Assignment for Billing/u })).toHaveTextContent(
    'Default',
  );
  expect(screen.getByText(/ 1 client\.$/u)).toBeVisible();
  expect(sent.some((s) => s.path === `${SC}/s-bill/clients`)).toBe(true);
});

it('loads the next page of clients by the cursor the server gave', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`GET ${SC}/s-bill/clients`]: (request) =>
        request.search.get('cursor') === null
          ? json({ items: [BILLING_CARRIES], next: 'cur2' })(request)
          : json({ items: [carrier('c-portal', 'portal', 'Portal', 'optional')] })(request),
    }),
  );
  await open();
  await user.click(await screen.findByRole('button', { name: 'Load more clients' }));
  expect(await screen.findByText('Portal')).toBeVisible();
  expect(sent.some((s) => s.search.get('cursor') === 'cur2')).toBe(true);
});

it('says it is loading more, and holds the button, while the next page is on its way', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`GET ${SC}/s-bill/clients`]: (request) =>
        request.search.get('cursor') === null
          ? json({ items: [BILLING_CARRIES], next: 'cur2' })(request)
          : pending()(request),
    }),
  );
  await open();
  await user.click(await screen.findByRole('button', { name: 'Load more clients' }));
  expect(await screen.findByRole('button', { name: 'Loading more clients…' })).toBeDisabled();
});

it('says no client carries a scope none carries', async () => {
  renderConsoleAt('/console/acme/scopes/s-rep?tab=clients', scopeRoutes());
  expect(await screen.findByText('No client carries reports:read.')).toBeVisible();
});

it('searches clients on the server, never in the browser, and assigns the one chosen', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`PUT ${SC}/s-bill/clients/c-portal`]: json({ client_id: 'c-portal', scopes: [] }, 200, {
        etag: '"c-portal-2"',
      }),
    }),
  );
  const assign = await screen.findByRole('region', { name: 'Assign to a client' });
  expect(within(assign).getByRole('button', { name: 'Assign to a client' })).toBeDisabled();
  await user.type(within(assign).getByRole('searchbox', { name: 'Search clients by name' }), 'por');
  await user.click(within(assign).getByRole('button', { name: 'Search' }));
  await waitFor(() => {
    expect(
      sent.some((s) => s.path === `${ACME_ADMIN}/clients` && s.search.get('name') === 'por'),
    ).toBe(true);
  });
  await user.click(await within(assign).findByRole('option', { name: /portal/u }));
  const assignButton = within(assign).getByRole('button', { name: 'Assign to portal' });
  expect(assignButton).toHaveAttribute('data-variant', 'primary');
  await user.click(assignButton);
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PUT')).toMatchObject({
      path: `${SC}/s-bill/clients/c-portal`,
      body: { assignment: 'default' },
    });
  });
  expect(await screen.findByText(/^billing is assigned to .+ as default\.$/u)).toBeVisible();
  await waitFor(() => {
    expect(within(assign).queryByRole('button', { name: 'Assign to portal' })).toBeNull();
  });
});

it("reads the scope's own client list again after an assignment", async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`PUT ${SC}/s-bill/clients/c-portal`]: json({ client_id: 'c-portal', scopes: [] }),
    }),
  );
  const assign = await screen.findByRole('region', { name: 'Assign to a client' });
  await user.click(await within(assign).findByRole('option', { name: /portal/u }));
  await user.click(within(assign).getByRole('button', { name: 'Assign to portal' }));
  await waitFor(() => {
    expect(
      sent.filter((s) => s.path === `${SC}/s-bill/clients` && s.method === 'GET').length,
    ).toBeGreaterThan(1);
  });
});

const BILLING_SCOPES = [{ id: 's-rep', name: 'reports:read', assignment: 'default' }];

// The client's page was open before the assignment, and is read again on
// opening it, which the fake never answers: what it shows, and saves on, is
// what the assignment's answer left in the console's cache.
function clientThenScope() {
  return {
    ...clientRoutes(),
    ...scopeRoutes(undefined, {
      [`GET ${C}/c-bill`]: inTurn(json(BILLING, 200, { etag: '"c-bill-1"' }), pending()),
      [`PUT ${SC}/s-rep/clients/c-bill`]: json(
        { client_id: 'c-bill', scopes: BILLING_SCOPES },
        200,
        { etag: '"c-bill-2"' },
      ),
      [`DELETE ${SC}/s-rep/clients/c-bill`]: () =>
        new Response(null, { status: 204, headers: { etag: '"c-bill-3"' } }),
      [`PATCH ${C}/c-bill`]: json(BILLING, 200, { etag: '"c-bill-9"' }),
    }),
  };
}

async function followLink(user: ReturnType<typeof userEvent.setup>, name: string) {
  const [link] = await screen.findAllByRole('link', { name });
  if (link === undefined) throw new Error(`no link named ${name}`);
  await user.click(link);
}

async function toScopeClients(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await screen.findByRole('region', { name: 'Token lifetimes' });
  await followLink(user, 'Scopes');
  await user.click(await screen.findByRole('row', { name: /reports:read/u }));
  await user.click(await screen.findByRole('tab', { name: 'Clients' }));
}

async function saveTokens(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await followLink(user, 'Clients');
  await user.click(await screen.findByRole('row', { name: /Billing/u }));
  await user.click(await screen.findByRole('tab', { name: 'Tokens' }));
  const section = await screen.findByRole('region', { name: 'Token lifetimes' });
  await user.click(
    within(section).getByRole('switch', { name: "Use the tenant's refresh token lifetime" }),
  );
  await user.click(within(section).getByRole('button', { name: 'Save Token lifetimes' }));
}

it("saves a client's next change on the ETag the assignment answered", async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt('/console/acme/clients/c-bill?tab=tokens', clientThenScope());
  await toScopeClients(user);
  const assign = await screen.findByRole('region', { name: 'Assign to a client' });
  await user.click(await within(assign).findByRole('option', { name: /Billing/u }));
  await user.click(within(assign).getByRole('button', { name: 'Assign to Billing' }));
  await waitFor(() => {
    expect(sent.some((s) => s.method === 'PUT')).toBe(true);
  });
  await saveTokens(user);
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.ifMatch).toBe('"c-bill-2"');
  });
});

it("saves a client's next change on the ETag the unassignment answered", async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt('/console/acme/clients/c-bill?tab=tokens', {
    ...clientThenScope(),
    [`GET ${SC}/s-rep/clients`]: json({ items: [carrier('c-bill', 'billing', 'Billing')] }),
  });
  await toScopeClients(user);
  await user.click(await screen.findByRole('button', { name: 'Unassign Billing' }));
  await waitFor(() => {
    expect(sent.some((s) => s.method === 'DELETE')).toBe(true);
  });
  await saveTokens(user);
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.ifMatch).toBe('"c-bill-3"');
  });
});

it('changes an assignment and unassigns, each at once', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`PUT ${SC}/s-bill/clients/c-bill`]: json({ client_id: 'c-bill', scopes: [] }),
      [`DELETE ${SC}/s-bill/clients/c-bill`]: () => new Response(null, { status: 204 }),
    }),
  );
  const row = await within(
    await screen.findByRole('list', { name: 'Clients carrying billing' }),
  ).findByRole('listitem');
  await user.click(within(row).getByRole('button', { name: /Assignment for Billing/u }));
  await user.click(await screen.findByRole('option', { name: 'Optional' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PUT')?.body).toEqual({ assignment: 'optional' });
  });
  expect(within(row).getByRole('button', { name: 'Unassign Billing' })).toHaveTextContent(
    'Unassign',
  );
  await user.click(within(row).getByRole('button', { name: 'Unassign Billing' }));
  await waitFor(() => {
    expect(sent.some((s) => s.method === 'DELETE')).toBe(true);
  });
  expect(await screen.findByText('billing is no longer assigned to Billing.')).toBeVisible();
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Clients carrying billing' })).toHaveFocus();
  });
});

it("words a 403 over the client's service account, naming the capability", async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`PUT ${SC}/s-bill/clients/c-portal`]: problem(403, 'about:blank', 'Forbidden', {
        detail: 'the caller does not hold: manage-keys',
      }),
    }),
  );
  const assign = await screen.findByRole('region', { name: 'Assign to a client' });
  await user.click(await within(assign).findByRole('option', { name: /portal/u }));
  await user.click(within(assign).getByRole('button', { name: 'Assign to portal' }));
  expect(await screen.findByText(/Refused: it would hand out manage-keys/u)).toBeVisible();
  expect(whoamiReads(sent)).toBeGreaterThan(1);
});

it('lists the carriers but offers no client search to a caller without manage-clients', async () => {
  const { sent } = renderConsoleAt(AT, scopeRoutes(['manage-tenant']));
  await open();
  expect(await screen.findByRole('note')).toHaveTextContent('needs the manage-clients capability');
  expect(screen.queryByRole('region', { name: 'Assign to a client' })).toBeNull();
  expect(sent.some((s) => s.path === `${ACME_ADMIN}/clients`)).toBe(false);
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, scopeRoutes()).element,
      () => screen.findByRole('region', { name: 'Assign to a client' }),
    ),
  ).toEqual({ light: [], dark: [] });
});
