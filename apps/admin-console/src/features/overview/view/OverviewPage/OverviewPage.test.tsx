import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import gridCss from '#/features/overview/view/OverviewPage/OverviewPage.module.css?raw';
import discoveryCss from '#/features/overview/view/DiscoveryPanel/DiscoveryPanel.module.css?raw';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { json, problem, type Answer } from '#/testing/fakeTransport.ts';
import {
  consoleAt,
  GRACE,
  renderConsoleAt,
  resetConsole,
  whoami,
} from '#/testing/renderConsole.tsx';

afterEach(() => {
  resetConsole();
});

const ADMIN = '/console/api/admin/tenants/acme';
const ISSUER = 'https://id.example/tenants/acme';
const EVERYTHING = ['manage-clients', 'manage-keys', 'manage-tenant', 'view-audit', 'view-users'];
const HOUR_AGO = new Date(Date.now() - 3 * 3600 * 1000).toISOString();

const KEYS = [
  {
    id: 'k-active',
    status: 'active',
    kid: 'kid-active',
    alg: 'ES256',
    created_at: '2026-01-01T00:00:00Z',
    not_after: null,
  },
  {
    id: 'k-staged',
    status: 'rotating',
    kid: 'kid-staged',
    alg: 'ES256',
    created_at: HOUR_AGO,
    not_after: null,
  },
];

const EVENT = {
  id: 'a1',
  occurred_at: '2026-09-28T13:41:05Z',
  event_type: 'admin_mutation',
  action: 'client.update',
  outcome: 'allowed',
  actor_tenant_id: 't1',
  actor_subject_id: null,
  actor_client_id: null,
  actor_name: null,
  actor_origin: null,
  resource_type: 'client',
  resource_id: 'c1',
  request_id: null,
  ip: null,
  detail: {},
};

function routes(capabilities: readonly string[]): Record<string, Answer> {
  const count = (n: number) => json({ count: n, capped: false });
  return {
    'GET /console/api/session': json(GRACE),
    [`GET ${ADMIN}/whoami`]: whoami(capabilities),
    'GET /console/api/tenants/acme/discovery': json({
      issuer: ISSUER,
      token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
      grant_types_supported: ['authorization_code'],
    }),
    'GET /console/api/tenants/acme/jwks': json({
      keys: [
        { kty: 'EC', kid: 'kid-active', alg: 'ES256', use: 'sig' },
        { kty: 'EC', kid: 'kid-staged', alg: 'ES256', use: 'sig' },
      ],
    }),
    [`GET ${ADMIN}/subjects/count`]: count(42),
    [`GET ${ADMIN}/clients/count`]: count(3),
    [`GET ${ADMIN}/groups/count`]: count(2),
    [`GET ${ADMIN}/roles/count`]: count(5),
    [`GET ${ADMIN}/scopes/count`]: count(8),
    [`GET ${ADMIN}/settings`]: json({
      verify_email: true,
      reset_password_allowed: false,
      client_registration_policy: 'open',
      max_clients: 3,
    }),
    [`GET ${ADMIN}/smtp`]: json({
      configured: false,
      host: null,
      port: null,
      from_address: null,
      username: null,
      password_set: false,
      starttls: null,
      effective: 'none',
    }),
    [`GET ${ADMIN}/keys`]: json({ items: KEYS }),
    [`GET ${ADMIN}/audit`]: json({ items: [EVENT] }),
  };
}

it("shows a tenant administrator the tenant's issuer, counts, attention and latest activity", async () => {
  renderConsoleAt('/console/acme', routes(EVERYTHING));
  expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  expect(await screen.findByText(ISSUER)).toBeVisible();

  const attention = await screen.findByRole('list', { name: 'Needs attention' });
  await waitFor(() => {
    expect(within(attention).getAllByRole('listitem')).toHaveLength(3);
  });
  expect(within(attention).getByRole('link', { name: 'Open Email' })).toHaveAttribute(
    'href',
    '/console/acme/email',
  );
  expect(within(attention).getByRole('link', { name: 'Open Signing keys' })).toHaveAttribute(
    'href',
    '/console/acme/keys',
  );
  expect(within(attention).getByRole('link', { name: 'Open Settings' })).toHaveAttribute(
    'href',
    '/console/acme/settings',
  );

  const counts = screen.getByRole('region', { name: 'Counts' });
  expect(counts).toHaveTextContent('42 subjects');
  expect(counts).toHaveTextContent('3 clients of 3 allowed');

  const keys = screen.getByRole('grid', { name: 'Published keys' });
  expect(await within(keys).findByText('rotating')).toBeVisible();

  const audit = await screen.findByRole('grid', { name: 'Latest audit rows' });
  expect(audit).toHaveTextContent('client.update');
  expect(screen.getByRole('link', { name: 'Open the audit trail' })).toHaveAttribute(
    'href',
    '/console/acme/audit',
  );
});

it('leaves out what the operator cannot read, as the rail does, and asks nothing of it', async () => {
  const { calls } = renderConsoleAt('/console/acme', routes(['manage-tenant']));
  await screen.findByText(ISSUER);
  const counts = await screen.findByRole('region', { name: 'Counts' });
  expect(
    within(counts)
      .getAllByRole('link')
      .map((l) => l.textContent),
  ).toEqual(['Groups', 'Roles', 'Scopes']);
  expect(screen.queryByRole('region', { name: 'Latest activity' })).toBeNull();
  expect(await screen.findByText(/Some checks need a capability/u)).toHaveTextContent(
    'manage-keys, manage-clients',
  );
  const asked = calls.map((call) => call.path);
  expect(asked).not.toContain(`${ADMIN}/audit`);
  expect(asked).not.toContain(`${ADMIN}/keys`);
  expect(asked).not.toContain(`${ADMIN}/subjects/count`);
  expect(asked).not.toContain(`${ADMIN}/clients/count`);
  expect(asked).toContain(`${ADMIN}/roles/count`);
});

it('reads whoami again when the server refuses a read whoami said was allowed', async () => {
  const { calls } = renderConsoleAt('/console/acme', {
    ...routes(EVERYTHING),
    [`GET ${ADMIN}/settings`]: problem(403, 'about:blank', 'Forbidden'),
  });
  const whoamis = () => calls.filter((call) => call.path === `${ADMIN}/whoami`).length;
  await screen.findByText(ISSUER);
  await waitFor(() => {
    expect(whoamis()).toBe(2);
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(whoamis()).toBe(2);
});

it('passes axe in both themes, with everything and with little', async () => {
  for (const capabilities of [EVERYTHING, ['manage-tenant']]) {
    expect(
      await axeInBothThemes(
        () => consoleAt('/console/acme', routes(capabilities)).element,
        () => screen.findByText(ISSUER),
      ),
    ).toEqual({ light: [], dark: [] });
  }
});

it('sizes each panel to its content, so a short one never stretches to its neighbour', () => {
  expect(gridCss).toMatch(/\.grid\s*\{[^}]*align-items:\s*start/u);
});

it('shows a long discovery name in full, wrapping it rather than cutting it off', () => {
  const source = discoveryCss.replace(/\/\*[\s\S]*?\*\//gu, '');
  expect(source).toMatch(/\.pair dt code\s*\{[^}]*overflow-wrap:\s*break-word/u);
  expect(source).not.toMatch(/text-overflow|white-space:\s*nowrap/u);
});
