import { generateSigningKey, signJwt } from '@odudu/crypto';
import { withTenant } from '@odudu/db';
import { sql } from 'drizzle-orm';
import { auditEvents } from '@odudu/domain-audit';
import { TENANT_CAPABILITIES } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
const FAILING_AUDIT_PREFIX = 'audit-insert-fails-';
const WORKING_AUDIT_PREFIX = 'audit-insert-works-';

// Stands in for an audit table that cannot be written: any row bound to a
// request id with the failing prefix is refused by the database.
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
  await fixture.owner.db.execute(sql`
    create function refuse_marked_audit_insert() returns trigger
      language plpgsql as $$
      begin
        if new.request_id like 'audit-insert-fails-%' then
          raise exception 'audit_events refused this row';
        end if;
        return new;
      end $$`);
  await fixture.owner.db.execute(sql`
    create trigger refuse_marked_audit_insert before insert on audit_events
      for each row execute function refuse_marked_audit_insert()`);
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

function claimsOf(token: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(
    Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
  );
  if (typeof parsed !== 'object' || parsed === null) throw new Error('not a JWT payload');
  return parsed as Record<string, unknown>;
}

function rowsOf(tenantId: string) {
  return withTenant(fixture.app.db, tenantId, (tx) => tx.select().from(auditEvents));
}

function call(
  method: 'GET' | 'POST',
  url: string,
  token: string | undefined,
  requestId: string,
): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method,
    url,
    headers: {
      'x-request-id': requestId,
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
    },
    ...(method === 'POST' ? { payload: { client_id: `refused-${newId()}` } } : {}),
  });
}

function headersBut(res: LightMyRequestResponse, excluded: readonly string[]) {
  return Object.fromEntries(
    Object.entries(res.headers).filter(([name]) => !excluded.includes(name)),
  );
}

function comparable(res: LightMyRequestResponse) {
  return { status: res.statusCode, headers: headersBut(res, ['date']), body: res.body };
}

// Two request ids of one length, so only the id itself differs.
function withoutRequestId(res: LightMyRequestResponse) {
  const body = Object.fromEntries(
    Object.entries(res.json<Record<string, unknown>>()).filter(([key]) => key !== 'instance'),
  );
  return { status: res.statusCode, headers: headersBut(res, ['date', 'x-request-id']), body };
}

async function twoTenants() {
  const x = await fixture.createTenant(`issuer-${newId()}`);
  const y = await fixture.createTenant(`target-${newId()}`);
  return { x, y };
}

describe('a token issued by another tenant of this deployment', () => {
  it('is refused exactly like garbage, and recorded in the target tenant', async () => {
    const { x, y } = await twoTenants();
    const token = await fixture.adminToken(x.name, [...TENANT_CAPABILITIES]);
    const requestId = newId();

    const foreign = await call('GET', `/admin/tenants/${y.name}/subjects`, token, requestId);
    const garbage = await call('GET', `/admin/tenants/${y.name}/subjects`, 'garbage', requestId);

    expect(foreign.statusCode).toBe(401);
    expect(comparable(foreign)).toEqual(comparable(garbage));

    const rows = await rowsOf(y.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventType: 'admin_access',
      action: 'token.foreign_issuer',
      outcome: 'refused',
      actorTenantId: x.id,
      actorSubjectId: claimsOf(token).sub,
      requestId,
      detail: { reason: 'foreign_issuer' },
    });
    expect(rows[0]?.actorClientId).not.toBeNull();
    expect(await rowsOf(x.id)).toHaveLength(0);
  });

  it('writes nothing when the signature is not one the named tenant made', async () => {
    const { x, y } = await twoTenants();
    const genuine = await fixture.adminToken(x.name, [...TENANT_CAPABILITIES]);
    const kek = Buffer.alloc(32, 9);
    const stranger = await generateSigningKey('ES256', kek);
    const forged = await signJwt(claimsOf(genuine), {
      key: {
        id: newId(),
        tenantId: x.id,
        status: 'active',
        createdAt: new Date(),
        notAfter: null,
        ...stranger,
      },
      kek,
      typ: 'at+jwt',
    });

    const res = await call('GET', `/admin/tenants/${y.name}/subjects`, forged, newId());

    expect(res.statusCode).toBe(401);
    expect(await rowsOf(y.id)).toHaveLength(0);
    expect(await rowsOf(x.id)).toHaveLength(0);
  });

  it('writes nothing for an issuer this deployment does not serve', async () => {
    // Signed with X's own key, so only the issuer's shape can refuse it.
    const { x, y } = await twoTenants();
    const genuine = await fixture.adminToken(x.name, [...TENANT_CAPABILITIES]);
    const evil = await fixture.signWithTenantKey(x.name, {
      ...claimsOf(genuine),
      iss: `https://evil.example/tenants/${x.name}`,
    });

    const res = await call('GET', `/admin/tenants/${y.name}/subjects`, evil, newId());

    expect(res.statusCode).toBe(401);
    expect(await rowsOf(y.id)).toHaveLength(0);
    expect(await rowsOf(x.id)).toHaveLength(0);
  });

  it('writes nothing when no bearer token is presented', async () => {
    const { y } = await twoTenants();

    const res = await call('GET', `/admin/tenants/${y.name}/subjects`, undefined, newId());

    expect(res.statusCode).toBe(401);
    expect(await rowsOf(y.id)).toHaveLength(0);
  });
});

describe('a 403 to an authenticated caller', () => {
  it.each(['POST', 'GET'] as const)(
    'records capability.refused for %s /clients, naming the missing capability',
    async (method) => {
      const t = await fixture.createTenant(`acme-${newId()}`);
      const token = await fixture.adminToken(t.name, ['view-audit']);
      const requestId = newId();

      const res = await call(method, `/admin/tenants/${t.name}/clients`, token, requestId);

      expect(res.statusCode).toBe(403);
      const rows = await rowsOf(t.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        eventType: 'admin_access',
        action: 'capability.refused',
        outcome: 'refused',
        actorTenantId: t.id,
        actorSubjectId: claimsOf(token).sub,
        requestId,
        detail: { capability: 'manage-clients', reason: 'missing_capability' },
      });
      expect(rows[0]?.actorClientId).not.toBeNull();
    },
  );

  it('names manage-tenants when a system admin lacking it reaches another tenant', async () => {
    const u = await fixture.createTenant(`umbrella-${newId()}`);
    const token = await fixture.systemAdminToken(['view-users']);

    const res = await call('GET', `/admin/tenants/${u.name}/subjects`, token, newId());

    expect(res.statusCode).toBe(403);
    const rows = await rowsOf(u.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'capability.refused',
      actorTenantId: fixture.systemTenantId,
      detail: { capability: 'manage-tenants', reason: 'missing_capability' },
    });
  });
});

describe('an audit table that refuses the write', () => {
  it('answers a foreign-issuer token with the same 401', async () => {
    const { x, y } = await twoTenants();
    const token = await fixture.adminToken(x.name, [...TENANT_CAPABILITIES]);
    const url = `/admin/tenants/${y.name}/subjects`;

    const recorded = await call('GET', url, token, `${WORKING_AUDIT_PREFIX}${newId()}`);
    const unrecorded = await call('GET', url, token, `${FAILING_AUDIT_PREFIX}${newId()}`);

    expect(recorded.statusCode).toBe(401);
    expect(withoutRequestId(unrecorded)).toEqual(withoutRequestId(recorded));
    expect(await rowsOf(y.id)).toHaveLength(1);
  });

  it('answers a missing capability with the same 403', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-audit']);
    const url = `/admin/tenants/${t.name}/clients`;

    const recorded = await call('GET', url, token, `${WORKING_AUDIT_PREFIX}${newId()}`);
    const unrecorded = await call('GET', url, token, `${FAILING_AUDIT_PREFIX}${newId()}`);

    expect(recorded.statusCode).toBe(403);
    expect(withoutRequestId(unrecorded)).toEqual(withoutRequestId(recorded));
    expect(await rowsOf(t.id)).toHaveLength(1);
  });
});
