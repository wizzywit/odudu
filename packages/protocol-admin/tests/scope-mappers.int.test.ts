import { withTenant, type TenantScopedDatabase } from '@odudu/db';
import { clientScopeRepository, TENANT_CAPABILITIES } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { standardClaimMappers } from '@odudu/protocol-oidc';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { setScopeMappers, type ScopeMapperAuditEvent } from '#/usecase/scope-mappers';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

async function createScope(token: string, tenantName: string, name: string): Promise<string> {
  const res = await fixture.http.inject({
    method: 'POST',
    url: `/admin/tenants/${tenantName}/scopes`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: { name },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ id: string }>().id;
}

function readMappers(token: string, tenantName: string, scopeId: string) {
  return fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenantName}/scopes/${scopeId}/mappers`,
    headers: { authorization: `Bearer ${token}` },
  });
}

function putMappers(token: string, tenantName: string, scopeId: string, mapperNames: string[]) {
  return fixture.http.inject({
    method: 'PUT',
    url: `/admin/tenants/${tenantName}/scopes/${scopeId}/mappers`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: { mapper_names: mapperNames },
  });
}

describe('GET /admin/tenants/{t}/scopes/{id}/mappers', () => {
  it('lists the registry available names and which are bound', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const scopeId = await createScope(token, t.name, `s-${newId()}`);

    const before = await readMappers(token, t.name, scopeId);
    expect(before.statusCode).toBe(200);
    const beforeBody = before.json<{ available: string[]; bound: string[] }>();
    expect(beforeBody.available).toContain('sub');
    expect(beforeBody.available).toContain('profile');
    expect(beforeBody.bound).toEqual([]);

    const put = await putMappers(token, t.name, scopeId, ['sub']);
    expect(put.statusCode).toBe(200);
    expect(put.json<{ bound: string[] }>().bound).toEqual(['sub']);

    const after = await readMappers(token, t.name, scopeId);
    expect(after.json<{ bound: string[] }>().bound).toEqual(['sub']);
  });

  it('404s for a scope id that belongs to a different tenant', async () => {
    const t1 = await fixture.createTenant(`acme-${newId()}`);
    const t2 = await fixture.createTenant(`acme-${newId()}`);
    const token1 = await fixture.adminToken(t1.name, ['manage-tenant']);
    const token2 = await fixture.adminToken(t2.name, ['manage-tenant']);
    const scopeId = await createScope(token1, t1.name, `s-${newId()}`);

    const res = await readMappers(token2, t2.name, scopeId);
    expect(res.statusCode).toBe(404);
  });
});

describe('PUT /admin/tenants/{t}/scopes/{id}/mappers', () => {
  it('replaces the whole binding set', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const scopeId = await createScope(token, t.name, `s-${newId()}`);

    await putMappers(token, t.name, scopeId, ['sub', 'roles']);
    const first = await readMappers(token, t.name, scopeId);
    expect(first.json<{ bound: string[] }>().bound.sort()).toEqual(['roles', 'sub']);

    await putMappers(token, t.name, scopeId, ['sub']);
    const second = await readMappers(token, t.name, scopeId);
    expect(second.json<{ bound: string[] }>().bound).toEqual(['sub']);
  });

  it('accepts a duplicate name in the same request rather than 500ing on the insert', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const scopeId = await createScope(token, t.name, `s-${newId()}`);

    const res = await putMappers(token, t.name, scopeId, ['sub', 'sub']);

    expect(res.statusCode).toBe(200);
    expect(res.json<{ bound: string[] }>().bound).toEqual(['sub']);
  });

  it('refuses an unregistered mapper name with 400, listing the known ones', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const scopeId = await createScope(token, t.name, `s-${newId()}`);

    const res = await putMappers(token, t.name, scopeId, ['not-a-real-mapper']);

    expect(res.statusCode).toBe(400);
    const body = res.json<{ detail: string }>();
    expect(body.detail).toMatch(/not-a-real-mapper/u);
    expect(body.detail).toMatch(/sub/u);
  });

  it('404s for an unknown scope id', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await putMappers(token, t.name, newId(), ['sub']);

    expect(res.statusCode).toBe(404);
  });

  it('is invisible from a different tenant', async () => {
    const t1 = await fixture.createTenant(`acme-${newId()}`);
    const t2 = await fixture.createTenant(`acme-${newId()}`);
    const token1 = await fixture.adminToken(t1.name, ['manage-tenant']);
    const token2 = await fixture.adminToken(t2.name, ['manage-tenant']);
    const scopeId = await createScope(token1, t1.name, `s-${newId()}`);

    const res = await putMappers(token2, t2.name, scopeId, ['sub']);

    expect(res.statusCode).toBe(404);
  });
});

describe('is refused for every capability but manage-tenant, on both mapper routes', () => {
  it('GET and PUT /scopes/:id/mappers', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const adminToken = await fixture.adminToken(t.name, ['manage-tenant']);
    const scopeId = await createScope(adminToken, t.name, `s-${newId()}`);

    for (const capability of TENANT_CAPABILITIES) {
      if (capability === 'manage-tenant') continue;
      const token = await fixture.adminToken(t.name, [capability]);

      const read = await readMappers(token, t.name, scopeId);
      expect(read.statusCode, `GET /scopes/:id/mappers as ${capability}`).toBe(403);

      const put = await putMappers(token, t.name, scopeId, ['sub']);
      expect(put.statusCode, `PUT /scopes/:id/mappers as ${capability}`).toBe(403);
    }
  });
});

// Driven directly against the usecase, the same way scopes.int.test.ts pins
// its own audit calls, so a mutation's exactly-once call and a refusal's
// zero calls are asserted without going through HTTP.
describe('audit', () => {
  function collector(): {
    events: ScopeMapperAuditEvent[];
    audit: (tx: TenantScopedDatabase, e: ScopeMapperAuditEvent) => Promise<void>;
  } {
    const events: ScopeMapperAuditEvent[] = [];
    return {
      events,
      audit: (_tx, event) => {
        events.push(event);
        return Promise.resolve();
      },
    };
  }

  it('calls audit exactly once on a successful set, and not on an unknown-mapper refusal', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const scopeId = await createScope(token, t.name, `s-${newId()}`);
    const claimMappers = standardClaimMappers();

    const ok = collector();
    await withTenant(fixture.app.db, t.id, (tx) =>
      setScopeMappers(
        tx,
        claimMappers,
        { audit: ok.audit },
        {
          scopeId,
          mapperNames: ['sub'],
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(ok.events).toHaveLength(1);
    expect(ok.events[0]?.action).toBe('scope.mappers_set');

    const refused = collector();
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      setScopeMappers(
        tx,
        claimMappers,
        { audit: refused.audit },
        {
          scopeId,
          mapperNames: ['not-a-real-mapper'],
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('unknown_mapper');
    expect(refused.events).toHaveLength(0);
  });

  it('probes the repository with a foreign tenant_id and finds nothing', async () => {
    const t1 = await fixture.createTenant(`acme-${newId()}`);
    const t2 = await fixture.createTenant(`acme-${newId()}`);
    const scopeId = await withTenant(fixture.app.db, t1.id, async (tx) => {
      const scope = await clientScopeRepository(tx).create({
        tenantId: t1.id,
        name: `s-${newId()}`,
      });
      return scope.id;
    });

    const outcome = await withTenant(fixture.app.db, t2.id, (tx) =>
      setScopeMappers(
        tx,
        standardClaimMappers(),
        { audit: () => Promise.resolve() },
        {
          scopeId,
          mapperNames: ['sub'],
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('not_found');
  });
});
