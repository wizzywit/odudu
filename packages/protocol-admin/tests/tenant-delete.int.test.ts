import { tenants, withTenant } from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { auditRepository } from '@odudu/domain-audit';
import { loginFailures } from '@odudu/domain-identity';
import { SYSTEM_TENANT_ID, SYSTEM_TENANT_NAME } from '@odudu/domain-tenant';
import { emailOutbox } from '@odudu/email';
import { newId } from '@odudu/kernel';
import { sql } from 'drizzle-orm';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { deleteTenantRows } from '#/usecase/tenants';
import { createPasswordSubject, createSignInClient, signInForTokens } from '#/testing/sign-in';

const PASSWORD = 'correct horse battery staple';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

const tableRowsSchema = z.array(z.object({ table_name: z.string() }));
const countRowsSchema = z.array(z.object({ n: z.number() }));

// Every table carrying a tenant, read from the catalogue rather than listed
// here, so a table added later is held to this without anyone remembering.
async function rowsPerTenantTable(tenantId: string): Promise<Map<string, number>> {
  const tables = tableRowsSchema.parse(
    await fixture.owner.db.execute(sql`
      SELECT table_name FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'tenant_id'
       ORDER BY table_name`),
  );
  const counts = new Map<string, number>();
  for (const { table_name: table } of tables) {
    const rows = countRowsSchema.parse(
      await fixture.owner.db.execute(
        sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE tenant_id = ${tenantId}`,
      ),
    );
    counts.set(table, rows[0]?.n ?? 0);
  }
  const own = countRowsSchema.parse(
    await fixture.owner.db.execute(
      sql`SELECT count(*)::int AS n FROM tenants WHERE id = ${tenantId}`,
    ),
  );
  counts.set('tenants', own[0]?.n ?? 0);
  return counts;
}

function call(
  token: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method,
    url,
    headers: {
      authorization: `Bearer ${token}`,
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });
}

// A tenant used the way one is: administered through the API, signed in to,
// and failed at, so most of what can hold a tenant's rows does.
async function populatedTenant(): Promise<{ id: string; name: string }> {
  const root = await fixture.systemAdminToken(['tenant-admin']);
  const name = `doomed-${newId()}`;
  const created = await call(root, 'POST', '/admin/tenants', { name });
  const id = created.json<{ id: string }>().id;
  const base = `/admin/tenants/${name}`;
  expect((await call(root, 'POST', `${base}/subjects`, { username: 'grace' })).statusCode).toBe(
    201,
  );
  expect(
    (
      await call(root, 'POST', `${base}/clients`, {
        client_id: 'app',
        grant_types: ['client_credentials'],
      })
    ).statusCode,
  ).toBe(201);
  expect((await call(root, 'POST', `${base}/roles`, { name: 'reader' })).statusCode).toBe(201);
  expect((await call(root, 'POST', `${base}/groups`, { name: 'staff' })).statusCode).toBe(201);
  expect((await call(root, 'POST', `${base}/scopes`, { name: 'billing' })).statusCode).toBe(201);
  expect(
    (await call(root, 'POST', `${base}/registration-tokens`, { uses: 1, ttl_seconds: 600 }))
      .statusCode,
  ).toBe(201);
  expect(
    (
      await call(root, 'PUT', `${base}/smtp`, {
        host: 'smtp.example.com',
        port: 587,
        from_address: 'noreply@example.com',
      })
    ).statusCode,
  ).toBe(200);

  const client = await createSignInClient(fixture, id, 'https://rp.example/backchannel');
  const subject = await createPasswordSubject(fixture, id, 'ada', PASSWORD);
  await signInForTokens(fixture, name, client, 'ada', PASSWORD, 'openid offline_access');
  await signInForTokens(fixture, name, client, 'ada', PASSWORD, 'openid');
  expect((await call(root, 'DELETE', `${base}/subjects/${subject}/sessions`)).statusCode).toBe(200);
  await withTenant(fixture.app.db, id, async (tx) => {
    await tx.insert(loginFailures).values({ tenantId: id, subjectId: subject, failureCount: 2 });
    await tx.insert(emailOutbox).values({
      id: newId(),
      tenantId: id,
      toAddress: 'ada@example.com',
      subject: 'Verify',
      bodyText: 'x',
      bodyHtml: 'x',
    });
  });
  return { id, name };
}

describe('DELETE /admin/tenants/:tenant', () => {
  it('removes every row the tenant holds, in every table, and audits it in system', async () => {
    const doomed = await populatedTenant();
    const before = await rowsPerTenantTable(doomed.id);
    const held = [...before].filter(([, n]) => n > 0).map(([table]) => table);
    expect(held.length, `tables holding rows: ${held.join(', ')}`).toBeGreaterThanOrEqual(20);

    const token = await fixture.systemAdminToken(['tenant-admin']);
    const res = await call(
      token,
      'DELETE',
      `/admin/tenants/${doomed.name}?confirm=${encodeURIComponent(doomed.name)}`,
    );
    expect(res.statusCode).toBe(204);

    const after = await rowsPerTenantTable(doomed.id);
    const left = [...after].filter(([, n]) => n > 0);
    expect(left, 'rows the deletion left behind').toEqual([]);

    const rows = await withTenant(fixture.app.db, SYSTEM_TENANT_ID, (tx) =>
      auditRepository(tx).list({ action: 'tenant.delete', resourceId: doomed.id, limit: 5 }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'allowed', resourceType: 'tenant' });
    expect(rows[0]?.detail).toEqual({ name: doomed.name });

    const again = await call(
      token,
      'DELETE',
      `/admin/tenants/${doomed.name}?confirm=${doomed.name}`,
    );
    expect(again.statusCode).toBe(401);
  });

  it('refuses a name that is not the tenant’s with 400 naming confirm, and deletes nothing', async () => {
    const t = await fixture.createTenant(`keep-${newId()}`);
    const token = await fixture.systemAdminToken(['manage-tenants']);
    const wrong = await call(token, 'DELETE', `/admin/tenants/${t.name}?confirm=${t.name}x`);
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json<{ errors: { path: string }[] }>().errors[0]?.path).toBe('confirm');
    const missing = await call(token, 'DELETE', `/admin/tenants/${t.name}`);
    expect(missing.statusCode).toBe(400);
    expect((await rowsPerTenantTable(t.id)).get('tenants')).toBe(1);
  });

  it('refuses the system tenant with 409, and a row saying so', async () => {
    const token = await fixture.systemAdminToken(['tenant-admin']);
    const res = await call(
      token,
      'DELETE',
      `/admin/tenants/${SYSTEM_TENANT_NAME}?confirm=${SYSTEM_TENANT_NAME}`,
    );
    expect(res.statusCode).toBe(409);
    const rows = await withTenant(fixture.app.db, SYSTEM_TENANT_ID, (tx) =>
      auditRepository(tx).list({ action: 'tenant.delete', outcome: 'refused', limit: 5 }),
    );
    expect(rows[0]?.detail).toMatchObject({ reason: 'system_tenant_guarded' });
  });

  it('refuses a caller below what the tenant’s administrators hold, with a refused row', async () => {
    const t = await fixture.createTenant(`guarded-${newId()}`);
    await fixture.adminToken(t.name, ['tenant-admin']);
    const token = await fixture.systemAdminToken(['manage-tenants']);
    const res = await call(token, 'DELETE', `/admin/tenants/${t.name}?confirm=${t.name}`);
    expect(res.statusCode).toBe(403);
    expect((await rowsPerTenantTable(t.id)).get('tenants')).toBe(1);
    const rows = await withTenant(fixture.app.db, SYSTEM_TENANT_ID, (tx) =>
      auditRepository(tx).list({ action: 'tenant.delete', resourceId: t.id, limit: 5 }),
    );
    expect(rows[0]).toMatchObject({ outcome: 'refused' });
  });

  it('is refused to a tenant’s own administrator, who holds no manage-tenants', async () => {
    const t = await fixture.createTenant(`self-${newId()}`);
    const token = await fixture.adminToken(t.name, ['tenant-admin']);
    const res = await call(token, 'DELETE', `/admin/tenants/${t.name}?confirm=${t.name}`);
    expect(res.statusCode).toBe(403);
  });
});

describe('deleteTenantRows, probed with a foreign tenant_id', () => {
  it('finds and deletes no tenant from another tenant’s context', async () => {
    await expectCrossTenantMethodProbe(fixture.app.db, {
      seed: async (tx, tenantId) => {
        const name = `probe-${newId()}`;
        await tx.insert(tenants).values({ id: tenantId, name });
        return { tenantId, name };
      },
      verifySeeded: async (tx, seeded) => {
        expect(await tx.select().from(tenants)).toHaveLength(1);
        expect(seeded.name).toMatch(/^probe-/u);
      },
      attempt: (tx, seeded) =>
        deleteTenantRows(tx, {
          tenantId: seeded.tenantId,
          confirm: seeded.name,
          callerCapabilities: new Set(['tenant-admin']),
          actorSubjectId: newId(),
          actorTenantId: newId(),
          actorClientId: newId(),
        }),
      expectBlocked: (result) => {
        expect(result).toEqual({ kind: 'not_found' });
      },
      verifyTenantAUnaffected: async (tx) => {
        expect(await tx.select().from(tenants)).toHaveLength(1);
      },
    });
  });
});
