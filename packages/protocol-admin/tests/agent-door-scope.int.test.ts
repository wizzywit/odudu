import { withTenant } from '@odudu/db';
import { auditEvents } from '@odudu/domain-audit';
import { clientScopeRepository } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

// A built-in scope is what a person recognises on the consent screen and what
// every client's tokens are built from, so an agent amends the scopes a person
// made and none of these, whatever the body names.

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

const BUILTINS = ['openid', 'offline_access', 'mcp:write'];

const MINTS = {
  'a token issued straight to the agent': (tenant: string) =>
    fixture.agentToken(tenant, ['manage-tenant'], { scope: 'mcp:write', viaMcpClient: true }),
  'a token the endpoint signed': (tenant: string) =>
    fixture.agentToken(tenant, ['manage-tenant'], {
      scope: 'mcp:write',
      act: { sub: 'agent-client' },
      via: 'mcp',
    }),
};

async function scopeId(tenantId: string, name: string): Promise<string> {
  const row = await withTenant(fixture.app.db, tenantId, (tx) =>
    clientScopeRepository(tx).byNames([name]),
  );
  const [found] = row;
  if (found === undefined) throw new Error(`no scope ${name}`);
  return found.id;
}

async function etagOf(tenant: string, id: string, token: string): Promise<string> {
  const res = await fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenant}/scopes/${id}`,
    headers: { authorization: `Bearer ${token}` },
  });
  return String(res.headers.etag);
}

function patch(tenant: string, id: string, token: string, etag: string, payload: unknown) {
  return fixture.http.inject({
    method: 'PATCH',
    url: `/admin/tenants/${tenant}/scopes/${id}`,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'if-match': etag,
    },
    payload: payload as never,
  });
}

const refusals = (tenantId: string) =>
  withTenant(fixture.app.db, tenantId, (tx) =>
    tx.select().from(auditEvents).where(eq(auditEvents.action, 'capability.refused')),
  );

describe.each(Object.entries(MINTS))('an agent holding %s', (_label, mint) => {
  it.each(BUILTINS)('cannot amend the built-in scope %s, in any field', async (name) => {
    const t = await fixture.createTenant(`scope-${newId()}`);
    const id = await scopeId(t.id, name);
    const token = await mint(t.name);
    const etag = await etagOf(t.name, id, token);
    for (const body of [{ description: 'Changed' }, { display_order: 99 }]) {
      const res = await patch(t.name, id, token, etag, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(403);
      expect(res.json()).toMatchObject({ detail: 'insufficient_scope' });
    }
    expect(await refusals(t.id)).toHaveLength(2);
    const after = await etagOf(t.name, id, token);
    expect(after).toBe(etag);
  });

  it('still amends a scope a person made', async () => {
    const t = await fixture.createTenant(`scope-${newId()}`);
    const admin = await fixture.adminToken(t.name, ['manage-tenant']);
    const made = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/scopes`,
      headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
      payload: { name: `orders-${newId()}` },
    });
    const id = made.json<{ id: string }>().id;
    const token = await mint(t.name);
    const res = await patch(t.name, id, token, await etagOf(t.name, id, token), {
      description: 'Orders',
      display_order: 3,
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('a person', () => {
  it('still amends a built-in scope with their own token', async () => {
    const t = await fixture.createTenant(`scope-${newId()}`);
    const id = await scopeId(t.id, 'offline_access');
    const admin = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await patch(t.name, id, admin, await etagOf(t.name, id, admin), {
      display_order: 5,
    });
    expect(res.statusCode).toBe(200);
  });
});
