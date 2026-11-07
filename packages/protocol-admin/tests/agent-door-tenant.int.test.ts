import { withTenant } from '@odudu/db';
import { auditEvents } from '@odudu/domain-audit';
import { tenantSettingsRepository } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

// An agent acts inside the one tenant its token names. A bearer of the system
// tenant whose owner holds `manage-tenants` may list and count the tenants, which
// are routes of no tenant, and nothing of another tenant's.

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

const CAPABILITIES = ['manage-tenants', 'manage-tenant', 'manage-clients', 'view-users'];

const MINTS = {
  'a token issued straight to the agent': (scope: string) =>
    fixture.systemAgentToken(CAPABILITIES, { scope, viaMcpClient: true }),
  'an exchanged token': (scope: string) =>
    fixture.systemAgentToken(CAPABILITIES, { scope, act: { sub: 'agent-client' } }),
  'a token the endpoint signed': (scope: string) =>
    fixture.systemAgentToken(CAPABILITIES, { scope, act: { sub: 'agent-client' }, via: 'mcp' }),
};

function send(tenant: string, method: string, path: string, token: string, payload?: unknown) {
  return fixture.http.inject({
    method: method as 'GET',
    url: `/admin/tenants/${tenant}${path}`,
    headers: {
      authorization: `Bearer ${token}`,
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      'idempotency-key': `k-${newId()}`,
    },
    ...(payload === undefined ? {} : { payload: payload as never }),
  });
}

const refusals = (tenantId: string) =>
  withTenant(fixture.app.db, tenantId, (tx) =>
    tx.select().from(auditEvents).where(eq(auditEvents.action, 'capability.refused')),
  );

describe.each(Object.entries(MINTS))('a system-tenant agent holding %s', (_label, mint) => {
  it('reads nothing of another tenant, and writes nothing there', async () => {
    const other = await fixture.createTenant(`other-${newId()}`);
    const token = await mint('mcp:read mcp:write');
    const before = await withTenant(fixture.app.db, other.id, (tx) =>
      tenantSettingsRepository(tx).byId(other.id),
    );
    const attempts: [string, string, unknown?][] = [
      ['GET', '/settings'],
      ['GET', '/clients'],
      ['GET', ''],
      ['PATCH', '/settings', { display_name: 'Taken over' }],
      ['POST', '/roles', { name: 'planted' }],
      ['POST', '/groups', { name: 'planted' }],
      ['PUT', '/message-overrides/en/login.title', { message: 'Planted' }],
      ['DELETE', '/message-overrides/en/login.title'],
    ];
    for (const [method, path, body] of attempts) {
      const res = await send(other.name, method, path, token, body);
      expect(res.statusCode, `${method} ${path}`).toBe(403);
      expect(res.json(), `${method} ${path}`).toMatchObject({ detail: 'insufficient_scope' });
    }
    const after = await withTenant(fixture.app.db, other.id, (tx) =>
      tenantSettingsRepository(tx).byId(other.id),
    );
    expect(after).toEqual(before);
    expect((await refusals(other.id)).length).toBe(attempts.length);
  });

  it('still lists and counts the tenants', async () => {
    const token = await mint('mcp:read');
    for (const path of ['/admin/tenants', '/admin/tenants/count']) {
      const res = await fixture.http.inject({
        method: 'GET',
        url: path,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode, path).toBe(200);
    }
  });

  it('can still read its own tenant', async () => {
    const token = await mint('mcp:read');
    const res = await send('system', 'GET', '/settings', token);
    expect(res.statusCode).toBe(200);
  });
});

describe('a person of the system tenant', () => {
  it('still reaches another tenant with the capabilities they hold', async () => {
    const other = await fixture.createTenant(`other-${newId()}`);
    const token = await fixture.systemAdminToken(CAPABILITIES);
    const res = await send(other.name, 'GET', '/settings', token);
    expect(res.statusCode).toBe(200);
  });
});
