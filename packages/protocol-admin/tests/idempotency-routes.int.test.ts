import { TENANT_CAPABILITIES } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { sql } from 'drizzle-orm';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

async function world() {
  const t = await fixture.createTenant(`idem-${newId()}`);
  const token = await fixture.adminToken(t.name, [...TENANT_CAPABILITIES]);
  return { t, token };
}

function post(
  tenant: string,
  token: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method: 'POST',
    url: `/admin/tenants/${tenant}${path}`,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
}

async function count(sqlText: ReturnType<typeof sql>): Promise<number> {
  const rows = await fixture.owner.db.execute(sqlText);
  return (rows as unknown as { n: number }[])[0]?.n ?? 0;
}

const rolesNamed = (tenantId: string, name: string) =>
  count(sql`select count(*)::int as n from roles where tenant_id = ${tenantId} and name = ${name}`);
const auditRows = (tenantId: string, action: string) =>
  count(
    sql`select count(*)::int as n from audit_events where tenant_id = ${tenantId} and action = ${action}`,
  );
const keyRows = (tenantId: string) =>
  count(sql`select count(*)::int as n from idempotency_keys where tenant_id = ${tenantId}`);

function problemType(res: LightMyRequestResponse): string {
  return res.json<{ type: string }>().type;
}

describe('a POST with an Idempotency-Key', () => {
  it('runs once and answers a retry with the same status, body and headers', async () => {
    const { t, token } = await world();
    const name = `role-${newId()}`;
    const headers = { 'idempotency-key': `k-${newId()}` };
    const first = await post(t.name, token, '/roles', { name }, headers);
    expect(first.statusCode).toBe(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();

    const replay = await post(t.name, token, '/roles', { name }, headers);
    expect(replay.statusCode).toBe(201);
    expect(replay.body).toBe(first.body);
    expect(replay.headers.etag).toBe(first.headers.etag);
    expect(replay.headers['content-type']).toBe(first.headers['content-type']);
    expect(replay.headers['cache-control']).toBe('no-store');
    expect(replay.headers['idempotent-replayed']).toBe('true');

    expect(await rolesNamed(t.id, name)).toBe(1);
    expect(await auditRows(t.id, 'role.create')).toBe(1);
    expect(await keyRows(t.id)).toBe(1);
  });

  it('answers a body the route would not have serialised differently, byte for byte', async () => {
    const { t, token } = await world();
    const name = `role-${newId()}`;
    const plain = await post(t.name, token, '/roles', { name });
    const keyed = await post(
      t.name,
      token,
      '/roles',
      { name: `${name}-keyed` },
      { 'idempotency-key': `k-${newId()}` },
    );
    expect(keyed.headers['content-type']).toBe(plain.headers['content-type']);
    expect(Object.keys(keyed.json<object>()).sort()).toEqual(
      Object.keys(plain.json<object>()).sort(),
    );
  });

  it('refuses the key reused for a different body, applying nothing', async () => {
    const { t, token } = await world();
    const headers = { 'idempotency-key': `k-${newId()}` };
    const one = `role-${newId()}`;
    const two = `role-${newId()}`;
    await post(t.name, token, '/roles', { name: one }, headers);
    const refused = await post(t.name, token, '/roles', { name: two }, headers);
    expect(refused.statusCode).toBe(422);
    expect(problemType(refused)).toBe('about:blank#idempotency-key-reused');
    expect(await rolesNamed(t.id, two)).toBe(0);
  });

  it('refuses the key reused on another path, and answers one key on two paths apart', async () => {
    const { t, token } = await world();
    const headers = { 'idempotency-key': `k-${newId()}` };
    await post(t.name, token, '/roles', { name: `role-${newId()}` }, headers);
    const elsewhere = await post(t.name, token, '/groups', { name: `group-${newId()}` }, headers);
    expect(elsewhere.statusCode).toBe(201);
  });

  it('keeps tenants apart: the same key in another tenant runs its own call', async () => {
    const a = await world();
    const b = await world();
    const headers = { 'idempotency-key': `shared-${newId()}` };
    const nameA = `role-${newId()}`;
    const nameB = `role-${newId()}`;
    await post(a.t.name, a.token, '/roles', { name: nameA }, headers);
    const second = await post(b.t.name, b.token, '/roles', { name: nameB }, headers);
    expect(second.statusCode).toBe(201);
    expect(second.headers['idempotent-replayed']).toBeUndefined();
    expect(await rolesNamed(b.t.id, nameB)).toBe(1);
  });

  it('never replays one caller’s response to another', async () => {
    const { t, token } = await world();
    const other = await fixture.adminToken(t.name, [...TENANT_CAPABILITIES]);
    const headers = { 'idempotency-key': `k-${newId()}` };
    const name = `role-${newId()}`;
    const first = await post(t.name, token, '/roles', { name }, headers);
    expect(first.statusCode).toBe(201);
    const stolen = await post(t.name, other, '/roles', { name }, headers);
    expect(stolen.statusCode).toBe(422);
    expect(problemType(stolen)).toBe('about:blank#idempotency-key-reused');
    expect(stolen.body).not.toContain(first.json<{ id: string }>().id);
  });

  it('never replays a person’s response to an agent acting for them', async () => {
    const { t, token } = await world();
    const agent = await fixture.agentToken(t.name, [...TENANT_CAPABILITIES], {
      scope: 'mcp:write',
      act: { sub: 'agent-client' },
      viaMcpClient: true,
    });
    const headers = { 'idempotency-key': `k-${newId()}` };
    const name = `role-${newId()}`;
    await post(t.name, token, '/roles', { name }, headers);
    const refused = await post(t.name, agent, '/roles', { name }, headers);
    expect([403, 422]).toContain(refused.statusCode);
    expect(refused.headers['idempotent-replayed']).toBeUndefined();
  });

  it('stores nothing for a refusal, so the same key may be used once the cause is gone', async () => {
    const { t, token } = await world();
    const name = `role-${newId()}`;
    await post(t.name, token, '/roles', { name });
    const headers = { 'idempotency-key': `k-${newId()}` };
    const refused = await post(t.name, token, '/roles', { name }, headers);
    expect(refused.statusCode).toBe(409);
    expect(await keyRows(t.id)).toBe(0);
  });

  it('stores nothing for a failure, and undoes what the failed call wrote', async () => {
    const { t, token } = await world();
    const name = `role-${newId()}`;
    const headers = { 'idempotency-key': `k-${newId()}` };
    await fixture.failNextWriteAfterAudit();
    const failed = await post(t.name, token, '/roles', { name }, headers);
    expect(failed.statusCode).toBe(500);
    expect(await keyRows(t.id)).toBe(0);
    expect(await rolesNamed(t.id, name)).toBe(0);

    const retry = await post(t.name, token, '/roles', { name }, headers);
    expect(retry.statusCode).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
    expect(await rolesNamed(t.id, name)).toBe(1);
  });

  it('runs a call once when two arrive together, and answers the other from it or as in flight', async () => {
    const { t, token } = await world();
    const name = `role-${newId()}`;
    const headers = { 'idempotency-key': `k-${newId()}` };
    const [a, b] = await Promise.all([
      post(t.name, token, '/roles', { name }, headers),
      post(t.name, token, '/roles', { name }, headers),
    ]);
    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses[0]).toBe(201);
    expect([201, 409]).toContain(statuses[1]);
    if (statuses[1] === 409) {
      const lost = a.statusCode === 409 ? a : b;
      expect(problemType(lost)).toBe('about:blank#idempotency-in-flight');
    }
    expect(await rolesNamed(t.id, name)).toBe(1);
    expect(await auditRows(t.id, 'role.create')).toBe(1);
    const third = await post(t.name, token, '/roles', { name }, headers);
    expect(third.statusCode).toBe(201);
    expect(third.headers['idempotent-replayed']).toBe('true');
  });

  it('answers a replayed If-Match write from the record, before the precondition is read again', async () => {
    const { t, token } = await world();
    const staged = await post(t.name, token, '/keys', { alg: 'RS256' });
    const id = staged.json<{ id: string }>().id;
    const etag = staged.headers.etag;
    expect(etag).toBeTypeOf('string');
    const headers = { 'idempotency-key': `k-${newId()}`, 'if-match': String(etag) };
    const first = await post(t.name, token, `/keys/${id}/promote`, undefined, headers);
    expect(first.statusCode).toBe(200);

    const replay = await post(t.name, token, `/keys/${id}/promote`, undefined, headers);
    expect(replay.statusCode).toBe(200);
    expect(replay.body).toBe(first.body);
    expect(replay.headers.etag).toBe(first.headers.etag);

    const withoutKey = await post(t.name, token, `/keys/${id}/promote`, undefined, {
      'if-match': String(etag),
    });
    expect(withoutKey.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('refuses a key that is empty, too long or made of other characters, before running anything', async () => {
    const { t, token } = await world();
    for (const key of ['', 'a'.repeat(256), 'has space', 'café']) {
      const name = `role-${newId()}`;
      const res = await post(t.name, token, '/roles', { name }, { 'idempotency-key': key });
      expect(res.statusCode, JSON.stringify(key)).toBe(400);
      expect(problemType(res)).toBe('about:blank#idempotency-key-invalid');
      expect(await rolesNamed(t.id, name)).toBe(0);
    }
  });

  it('is refused for a caller who may not call the route, whatever the key', async () => {
    const { t } = await world();
    const weak = await fixture.adminToken(t.name, ['view-users']);
    const res = await post(
      t.name,
      weak,
      '/roles',
      { name: `role-${newId()}` },
      { 'idempotency-key': `k-${newId()}` },
    );
    expect(res.statusCode).toBe(403);
    expect(await keyRows(t.id)).toBe(0);
  });
});

describe('a POST without an Idempotency-Key', () => {
  it('behaves as it always has: no record, no replay, a repeat applies again', async () => {
    const { t, token } = await world();
    const first = await post(t.name, token, '/roles', { name: `role-${newId()}` });
    const second = await post(t.name, token, '/roles', { name: `role-${newId()}` });
    expect([first.statusCode, second.statusCode]).toEqual([201, 201]);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(await keyRows(t.id)).toBe(0);
  });
});

describe('a route whose response carries a secret shown once', () => {
  it('refuses the key and runs nothing, rather than store the secret or repeat the call', async () => {
    const { t, token } = await world();
    const before = await count(
      sql`select count(*)::int as n from client_registration_tokens where tenant_id = ${t.id}`,
    );
    const res = await post(
      t.name,
      token,
      '/registration-tokens',
      { uses: 1, ttl_seconds: 3600 },
      { 'idempotency-key': `k-${newId()}` },
    );
    expect(res.statusCode).toBe(400);
    expect(problemType(res)).toBe('about:blank#idempotency-unsupported');
    expect(
      await count(
        sql`select count(*)::int as n from client_registration_tokens where tenant_id = ${t.id}`,
      ),
    ).toBe(before);
    expect(await keyRows(t.id)).toBe(0);
  });

  it('still works without a key', async () => {
    const { t, token } = await world();
    const res = await post(t.name, token, '/registration-tokens', { uses: 1, ttl_seconds: 3600 });
    expect(res.statusCode).toBe(201);
  });
});

describe('a PUT, PATCH or DELETE', () => {
  it('ignores the header altogether, even one that would be refused on a POST', async () => {
    const { t, token } = await world();
    const created = await post(t.name, token, '/roles', { name: `role-${newId()}` });
    const id = created.json<{ id: string }>().id;
    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/roles/${id}`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'not a valid key' },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['idempotent-replayed']).toBeUndefined();
    expect(await keyRows(t.id)).toBe(0);
  });

  it('stores no record for a PATCH that names a key', async () => {
    const { t, token } = await world();
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/settings`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': `k-${newId()}`,
      },
      payload: JSON.stringify({ verify_email: true }),
    });
    expect(res.statusCode).toBe(200);
    expect(await keyRows(t.id)).toBe(0);
  });
});

describe('the OpenAPI document', () => {
  it('names the Idempotency-Key header on every POST that accepts it, and on nothing else', async () => {
    const res = await fixture.http.inject({ method: 'GET', url: '/admin/openapi.json' });
    const doc = res.json<{
      paths: Record<string, Record<string, { parameters: { $ref?: string }[] }>>;
      components: { parameters: Record<string, { name: string; in: string; required: boolean }> };
    }>();
    expect(doc.components.parameters.IdempotencyKey).toMatchObject({
      name: 'Idempotency-Key',
      in: 'header',
      required: false,
    });
    const carrying: string[] = [];
    for (const [path, operations] of Object.entries(doc.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        const names = operation.parameters.some(
          (parameter) => parameter.$ref === '#/components/parameters/IdempotencyKey',
        );
        if (names) carrying.push(`${method} ${path}`);
        if (method !== 'post') expect(names, `${method} ${path}`).toBe(false);
      }
    }
    expect(carrying.length).toBeGreaterThan(20);
    expect(carrying).not.toContain('post /admin/tenants/{tenant}/registration-tokens');
    expect(carrying).toContain('post /admin/tenants/{tenant}/roles');
  });
});
