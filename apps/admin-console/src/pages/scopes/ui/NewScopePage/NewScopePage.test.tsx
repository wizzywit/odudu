import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { json, offline, problem, whoamiReads } from '#/testing/fakeTransport';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { ACME_ADMIN } from '#/testing/tenantPaths';
import { MAPPED, SC, scope, scopeRoutes } from '#/testing/scopesFixtures';

afterEach(() => {
  resetConsole();
});

const AT = '/console/acme/scopes/new';
const MADE = scope('s-new', 'invoices');

it('creates a scope and lands on it', async () => {
  const user = userEvent.setup();
  const { sent, router } = renderConsoleAt(
    AT,
    scopeRoutes(undefined, { [`POST ${SC}`]: json(MADE, 201) }),
  );
  expect(await screen.findByRole('heading', { level: 1, name: 'Create a scope' })).toBeVisible();
  await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'invoices');
  await user.type(screen.getByRole('textbox', { name: 'Description' }), 'Reads invoices');
  await user.click(screen.getByRole('button', { name: 'Create scope' }));
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/acme/scopes/s-new');
  });
  expect(sent.find((s) => s.method === 'POST')?.body).toEqual({
    name: 'invoices',
    description: 'Reads invoices',
  });
});

const BILLING_PARTS = {
  [`GET ${SC}/s-bill/roles`]: json(
    {
      items: [
        MAPPED,
        {
          id: 'r-far',
          name: 'keeper',
          client_id: null,
          client_key: null,
          admin_reach: ['manage-keys'],
        },
      ],
    },
    200,
    { etag: '"s-bill-r1"' },
  ),
  [`GET ${SC}/s-bill/mappers`]: json(
    { available: ['email', 'groups'], bound: ['email'], declared: [] },
    200,
    { etag: '"s-bill-m1"' },
  ),
};

it('copies a scope under a new name, with what it maps and binds, but the roles the caller could give', async () => {
  const user = userEvent.setup();
  const { sent, router } = renderConsoleAt(`${AT}?copy=s-bill`, {
    ...scopeRoutes(['manage-tenant'], {
      ...BILLING_PARTS,
      [`POST ${SC}`]: json(MADE, 201),
      [`GET ${SC}/s-new/roles`]: json({ items: [] }, 200, { etag: '"s-new-r1"' }),
      [`PUT ${SC}/s-new/roles`]: json({ items: [MAPPED] }, 200, { etag: '"s-new-r2"' }),
      [`GET ${SC}/s-new/mappers`]: json(
        { available: ['email', 'groups'], bound: [], declared: [] },
        200,
        { etag: '"s-new-m1"' },
      ),
      [`PUT ${SC}/s-new/mappers`]: json(
        { available: ['email', 'groups'], bound: ['email'], declared: [] },
        200,
        { etag: '"s-new-m2"' },
      ),
    }),
  });
  expect(
    await screen.findByText('A copy of billing, mapping auditor and binding email.'),
  ).toBeVisible();
  expect(screen.getByText(/Not copied, since you could not give it/u)).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('Invoices');
  await user.type(screen.getByRole('textbox', { name: 'Name' }), 'invoices{Enter}');
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/acme/scopes/s-new');
  });
  expect(sent.find((s) => s.method === 'POST')?.body).toMatchObject({
    name: 'invoices',
    description: 'Invoices',
  });
  expect(sent.find((s) => s.path === `${SC}/s-new/roles` && s.method === 'PUT')).toMatchObject({
    ifMatch: '"s-new-r1"',
    body: { role_ids: ['r-aud'] },
  });
  expect(sent.find((s) => s.path === `${SC}/s-new/mappers` && s.method === 'PUT')).toMatchObject({
    ifMatch: '"s-new-m1"',
    body: { mapper_names: ['email'] },
  });
});

it('stays to say which parts a copy could not take', async () => {
  const user = userEvent.setup();
  const { router } = renderConsoleAt(`${AT}?copy=s-bill`, {
    ...scopeRoutes(undefined, {
      ...BILLING_PARTS,
      [`POST ${SC}`]: json(MADE, 201),
      [`GET ${SC}/s-new/roles`]: json({ items: [] }, 200, { etag: '"s-new-r1"' }),
      [`PUT ${SC}/s-new/roles`]: problem(500),
      [`GET ${SC}/s-new/mappers`]: json(
        { available: ['email', 'groups'], bound: [], declared: [] },
        200,
        { etag: '"s-new-m1"' },
      ),
      [`PUT ${SC}/s-new/mappers`]: json(
        { available: ['email', 'groups'], bound: ['email'], declared: [] },
        200,
        { etag: '"s-new-m2"' },
      ),
    }),
  });
  await screen.findByText(/A copy of billing/u);
  await user.type(screen.getByRole('textbox', { name: 'Name' }), 'invoices{Enter}');
  expect(await screen.findByText(/its roles could not be copied/u)).toBeVisible();
  expect(screen.getByRole('link', { name: 'Open invoices' })).toHaveAttribute(
    'href',
    '/console/acme/scopes/s-new',
  );
  expect(router.state.location.pathname).toBe('/acme/scopes/new');
});

it('sends nothing more while a part-made copy stays on the page', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(`${AT}?copy=s-bill`, {
    ...scopeRoutes(undefined, {
      ...BILLING_PARTS,
      [`POST ${SC}`]: json(MADE, 201),
      [`GET ${SC}/s-new/roles`]: problem(500),
      [`GET ${SC}/s-new/mappers`]: problem(500),
    }),
  });
  await screen.findByText(/A copy of billing/u);
  const name = screen.getByRole('textbox', { name: 'Name' });
  await user.type(name, 'invoices{Enter}');
  await screen.findByText(/could not be copied/u);
  await user.type(name, 's{Enter}');
  expect(sent.filter((request) => request.method === 'POST')).toHaveLength(1);
});

it('sends nothing before whoami has said what the caller holds', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    `${AT}?copy=s-bill`,
    scopeRoutes(undefined, {
      ...BILLING_PARTS,
      [`POST ${SC}`]: json(MADE, 201),
      [`GET ${ACME_ADMIN}/whoami`]: problem(500),
    }),
  );
  await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'invoices{Enter}');
  expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();
  expect(sent.some((request) => request.method === 'POST')).toBe(false);
});

it('says the scope to copy could not be read, and makes a plain one', async () => {
  renderConsoleAt(`${AT}?copy=s-gone`, scopeRoutes());
  expect(await screen.findByText(/The scope to copy could not be read/u)).toBeVisible();
});

it('asks for a name before sending anything', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, scopeRoutes());
  await user.click(await screen.findByRole('button', { name: 'Create scope' }));
  expect(await screen.findByText('Enter a name.')).toBeVisible();
  expect(sent.some((s) => s.method === 'POST')).toBe(false);
});

it('says under the name that it is taken', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`POST ${SC}`]: problem(409, 'about:blank', 'Conflict', {
        detail: 'the name "billing" is already in use',
      }),
    }),
  );
  await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'billing{Enter}');
  expect(await screen.findByText('The name "billing" is already in use.')).toBeVisible();
});

it('offers a look, not another send, when the answer was lost, and lands when it finds it', async () => {
  const user = userEvent.setup();
  const { sent, router } = renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`POST ${SC}`]: offline(),
      [`GET ${SC}`]: json({ items: [MADE] }),
    }),
  );
  await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'invoices{Enter}');
  await user.click(await screen.findByRole('button', { name: 'Look for invoices' }));
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/acme/scopes/s-new');
  });
  expect(sent.filter((s) => s.method === 'POST')).toHaveLength(1);
});

it('reads whoami again when the creation is refused', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    scopeRoutes(undefined, { [`POST ${SC}`]: problem(403, 'about:blank', 'Forbidden') }),
  );
  await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'invoices{Enter}');
  expect(await screen.findByText(/it needs the manage-tenant capability/u)).toBeVisible();
  expect(whoamiReads(sent)).toBeGreaterThan(1);
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, scopeRoutes()).element,
      () => screen.findByRole('textbox', { name: 'Name' }),
    ),
  ).toEqual({ light: [], dark: [] });
});
