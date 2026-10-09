import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import {
  A,
  ADMIN,
  BILLING,
  C,
  clientRoutes,
  type ClientAnswer,
} from '#/testing/clientsFixtures.ts';
import { inTurn, json, problem } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/clients/c-bill?tab=scopes';
const OPENID = { id: 's-openid', name: 'openid', assignment: 'default' as const };
const BILLING_SCOPE = { id: 's-bill', name: 'billing', assignment: 'optional' as const };
const SCOPES = `${A}/scopes`;

const CATALOGUE = [
  { id: 's-openid', name: 'openid', description: null },
  { id: 's-bill', name: 'billing', description: 'Invoices' },
  { id: 's-reports', name: 'reports:read', description: 'Reads reports' },
].map((scope) => ({
  ...scope,
  include_in_id_token: false,
  include_in_access_token: true,
  default_client_assignment: null,
  consent_text: null,
  display_order: 0,
  created_at: '2026-09-28T08:41:53.858Z',
}));

function scopesRoutes(assigned: ClientAnswer['scopes'], extra = {}) {
  return clientRoutes(undefined, {
    [`GET ${C}/c-bill`]: json({ ...BILLING, scopes: assigned }, 200, { etag: '"c-bill-1"' }),
    [`GET ${SCOPES}`]: (request) =>
      json({
        items: CATALOGUE.filter((scope) => scope.name.startsWith(request.search.get('name') ?? '')),
      })(request),
    ...extra,
  });
}

async function open(): Promise<void> {
  await screen.findByRole('region', { name: 'Assigned scopes' });
}

it('lists the assigned scopes by name, each with how it is assigned', async () => {
  renderConsoleAt(AT, scopesRoutes([OPENID, BILLING_SCOPE]));
  await open();
  const list = screen.getByRole('list', { name: 'Scopes assigned to Billing' });
  expect(
    within(list)
      .getAllByRole('listitem')
      .map((item) => item.querySelector('code')?.textContent),
  ).toEqual(['billing', 'openid']);
  expect(screen.getByText('2 scopes assigned.', { exact: false })).toBeVisible();
  expect(within(list).getByRole('button', { name: /Assignment of billing/u })).toHaveTextContent(
    'Optional',
  );
});

it('searches the tenant scopes on the server, and assigns the one chosen', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    scopesRoutes([OPENID], {
      [`PUT ${SCOPES}/s-reports/clients/c-bill`]: json({
        client_id: 'c-bill',
        scopes: [OPENID, { id: 's-reports', name: 'reports:read', assignment: 'optional' }],
      }),
    }),
  );
  await open();
  const assign = await screen.findByRole('region', { name: 'Assign a scope' });
  await user.type(within(assign).getByRole('searchbox', { name: 'Search scopes by name' }), 'rep');
  await user.click(within(assign).getByRole('button', { name: 'Search' }));
  await waitFor(() => {
    expect(sent.some((s) => s.path === SCOPES && s.search.get('name') === 'rep')).toBe(true);
  });
  await user.click(await within(assign).findByRole('option', { name: /reports:read/u }));
  await user.click(within(assign).getByRole('button', { name: /Assign it as/u }));
  await user.click(await screen.findByRole('option', { name: 'Optional' }));
  await user.click(within(assign).getByRole('button', { name: 'Assign scope reports:read' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PUT')).toMatchObject({
      path: `${SCOPES}/s-reports/clients/c-bill`,
      body: { assignment: 'optional' },
    });
  });
});

it('reads the client again after an assignment, so the next save carries its new ETag', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    scopesRoutes([OPENID], {
      [`GET ${C}/c-bill`]: inTurn(
        json({ ...BILLING, scopes: [OPENID] }, 200, { etag: '"c-bill-1"' }),
        json({ ...BILLING, scopes: [OPENID, BILLING_SCOPE] }, 200, { etag: '"c-bill-2"' }),
      ),
      [`PUT ${SCOPES}/s-bill/clients/c-bill`]: json({
        client_id: 'c-bill',
        scopes: [OPENID, BILLING_SCOPE],
      }),
    }),
  );
  await open();
  const assign = await screen.findByRole('region', { name: 'Assign a scope' });
  await user.click(await within(assign).findByRole('option', { name: /billing/u }));
  await user.click(within(assign).getByRole('button', { name: 'Assign scope billing' }));
  const list = screen.getByRole('list', { name: 'Scopes assigned to Billing' });
  expect(await within(list).findByText('billing')).toBeVisible();
  expect(sent.filter((s) => s.method === 'GET' && s.path === `${C}/c-bill`)).toHaveLength(2);
});

it('says a scope already assigned is, and keeps it from being assigned twice', async () => {
  renderConsoleAt(AT, scopesRoutes([OPENID]));
  await open();
  const assign = await screen.findByRole('region', { name: 'Assign a scope' });
  const option = await within(assign).findByRole('option', { name: /openid/u });
  expect(option).toHaveTextContent('already assigned as default');
});

it('changes how a scope is assigned straight from the list', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    scopesRoutes([OPENID, BILLING_SCOPE], {
      [`PUT ${SCOPES}/s-bill/clients/c-bill`]: json({ client_id: 'c-bill', scopes: [OPENID] }),
    }),
  );
  await open();
  await user.click(screen.getByRole('button', { name: /Assignment of billing/u }));
  await user.click(await screen.findByRole('option', { name: 'Default' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PUT')?.body).toEqual({ assignment: 'default' });
  });
});

it('unassigns a scope, and moves focus to the list heading it leaves', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    scopesRoutes([OPENID, BILLING_SCOPE], {
      [`DELETE ${SCOPES}/s-bill/clients/c-bill`]: () => new Response(null, { status: 204 }),
    }),
  );
  await open();
  await user.click(screen.getByRole('button', { name: 'Remove billing' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'DELETE')?.path).toBe(`${SCOPES}/s-bill/clients/c-bill`);
  });
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Assigned scopes' })).toHaveFocus();
  });
});

it("says in the server's words why a scope was not assigned", async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    scopesRoutes([OPENID, BILLING_SCOPE], {
      [`DELETE ${SCOPES}/s-bill/clients/c-bill`]: problem(409, 'about:blank', 'Conflict', {
        detail: 'billing cannot be unassigned from this client',
      }),
    }),
  );
  await open();
  await user.click(screen.getByRole('button', { name: 'Remove billing' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'billing was not unassigned: billing cannot be unassigned from this client',
  );
});

it("says in the server's words that a client carries no more scopes", async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    scopesRoutes([OPENID], {
      [`PUT ${SCOPES}/s-bill/clients/c-bill`]: problem(409, 'about:blank', 'Conflict', {
        detail: 'a client carries at most 200 scopes',
      }),
    }),
  );
  await open();
  const assign = await screen.findByRole('region', { name: 'Assign a scope' });
  await user.click(await within(assign).findByRole('option', { name: /billing/u }));
  await user.click(within(assign).getByRole('button', { name: 'Assign scope billing' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'billing was not assigned: a client carries at most 200 scopes',
  );
});

it('shows only as many scopes as a page, and the rest on request', async () => {
  const user = userEvent.setup();
  const many = Array.from({ length: 120 }, (_, i) => ({
    id: `s-${String(i).padStart(3, '0')}`,
    name: `scope-${String(i).padStart(3, '0')}`,
    assignment: 'default' as const,
  }));
  renderConsoleAt(AT, scopesRoutes(many));
  await open();
  const list = screen.getByRole('list', { name: 'Scopes assigned to Billing' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(50);
  await user.click(screen.getByRole('button', { name: 'Show 70 more' }));
  expect(within(list).getAllByRole('listitem')).toHaveLength(100);
});

it('keeps every scope on the built-in admin client, and says why', async () => {
  renderConsoleAt(
    '/console/acme/clients/c-admin?tab=scopes',
    clientRoutes(undefined, {
      [`GET ${C}/c-admin`]: json({ ...ADMIN, scopes: [OPENID] }, 200, { etag: '"c-admin-1"' }),
    }),
  );
  await open();
  expect(await screen.findByText(/odudu-admin's scopes cannot be unassigned/u)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Remove openid' })).toBeNull();
});

it('offers no change to a caller without manage-tenant, and says what it needs', async () => {
  renderConsoleAt(
    AT,
    clientRoutes(['manage-clients'], {
      [`GET ${C}/c-bill`]: json({ ...BILLING, scopes: [OPENID] }, 200, { etag: '"c-bill-1"' }),
    }),
  );
  await open();
  expect(screen.getByText(/You can view this client's scopes but not change them/u)).toBeVisible();
  expect(screen.queryByRole('region', { name: 'Assign a scope' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Remove openid' })).toBeNull();
});

it('offers no change while the service account holds what the caller does not', async () => {
  renderConsoleAt(
    AT,
    clientRoutes(undefined, {
      [`GET ${C}/c-bill`]: json(
        { ...BILLING, scopes: [OPENID], service_account_admin_reach: ['manage-keys'] },
        200,
        { etag: '"c-bill-1"' },
      ),
      [`GET ${A}/whoami`]: json({
        subjectId: 's',
        issuerTenantId: 't',
        capabilities: ['manage-clients', 'manage-tenant'],
        crossTenant: false,
      }),
    }),
  );
  await open();
  expect(screen.queryByRole('region', { name: 'Assign a scope' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Remove openid' })).toBeNull();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, scopesRoutes([OPENID, BILLING_SCOPE])).element,
      () => screen.findByRole('region', { name: 'Assign a scope' }),
    ),
  ).toEqual({ light: [], dark: [] });
});
