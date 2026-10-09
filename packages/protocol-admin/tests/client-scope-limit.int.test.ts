import { CLIENT_SCOPE_LIMIT } from '@odudu/contracts/admin';
import { newId } from '@odudu/kernel';
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

async function authorised(
  url: string,
  token: string,
  method: 'PUT' | 'POST' | 'PATCH',
  payload: object,
  headers = {},
) {
  return fixture.http.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
    payload,
  });
}

// A tenant whose client carries exactly the limit, with more scopes defined than that.
async function fullClient() {
  const t = await fixture.createTenant(`cs-${newId()}`);
  const token = await fixture.adminToken(t.name, ['manage-tenant', 'manage-clients']);
  const client = await fixture.createConfidentialClient(t.name, {});
  await fixture.owner.sql`
    insert into client_scopes (id, tenant_id, name)
    select gen_random_uuid(), ${t.id}, 'filler-' || g from generate_series(1, ${CLIENT_SCOPE_LIMIT} + 5) g`;
  await fixture.owner.sql`
    insert into client_scope_assignments (tenant_id, client_id, client_scope_id, assignment)
    select ${t.id}, ${client.id}, s.id, 'optional'
      from client_scopes s
     where s.tenant_id = ${t.id}
       and s.id not in (select client_scope_id from client_scope_assignments where client_id = ${client.id})
     order by s.name
     limit ${CLIENT_SCOPE_LIMIT} - (select count(*) from client_scope_assignments where client_id = ${client.id})`;
  const [free] = await fixture.owner.sql<{ id: string }[]>`
    select id from client_scopes s where s.tenant_id = ${t.id}
       and s.id not in (select client_scope_id from client_scope_assignments where client_id = ${client.id}) limit 1`;
  const [held] = await fixture.owner.sql<{ id: string }[]>`
    select client_scope_id as id from client_scope_assignments where client_id = ${client.id} and assignment = 'optional' limit 1`;
  return { t, token, client, free: free?.id ?? '', held: held?.id ?? '' };
}

describe('the scopes a client carries', () => {
  it('stop at CLIENT_SCOPE_LIMIT, and a scope past it is refused naming the limit', async () => {
    const { t, token, client, free } = await fullClient();
    const res = await authorised(
      `/admin/tenants/${t.name}/scopes/${free}/clients/${client.id}`,
      token,
      'PUT',
      { assignment: 'default' },
    );
    expect(res.statusCode).toBe(409);
    expect(res.json<{ detail: string }>().detail).toBe(
      `a client carries at most ${String(CLIENT_SCOPE_LIMIT)} scopes`,
    );
    const [count] = await fixture.owner.sql<{ n: string }[]>`
      select count(*) as n from client_scope_assignments where client_id = ${client.id}`;
    expect(count?.n).toBe(String(CLIENT_SCOPE_LIMIT));
  });

  it('still change how one already carried is assigned, and take one with room made by removing another', async () => {
    const { t, token, client, free, held } = await fullClient();
    const changed = await authorised(
      `/admin/tenants/${t.name}/scopes/${held}/clients/${client.id}`,
      token,
      'PUT',
      { assignment: 'default' },
    );
    expect(changed.statusCode).toBe(200);
    const removed = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/scopes/${held}/clients/${client.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(removed.statusCode).toBe(204);
    const taken = await authorised(
      `/admin/tenants/${t.name}/scopes/${free}/clients/${client.id}`,
      token,
      'PUT',
      { assignment: 'optional' },
    );
    expect(taken.statusCode).toBe(200);
  });
});

describe('a client stored with more scopes than the limit', () => {
  it('keeps every one of them, changes and loses them as before, and takes no new one', async () => {
    const { t, token, client, free, held } = await fullClient();
    await fixture.owner.sql`
      insert into client_scope_assignments (tenant_id, client_id, client_scope_id, assignment)
      select ${t.id}, ${client.id}, id, 'optional' from client_scopes
       where tenant_id = ${t.id}
         and id not in (select client_scope_id from client_scope_assignments where client_id = ${client.id})
       limit 5`;
    const [carried] = await fixture.owner.sql<{ n: string }[]>`
      select count(*) as n from client_scope_assignments where client_id = ${client.id}`;
    expect(Number(carried?.n)).toBeGreaterThan(CLIENT_SCOPE_LIMIT);
    const [spare] = await fixture.owner.sql<{ id: string }[]>`
      select id from client_scopes where tenant_id = ${t.id}
         and id not in (select client_scope_id from client_scope_assignments where client_id = ${client.id}) limit 1`;
    const read = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/clients/${client.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json<{ scopes: unknown[] }>().scopes).toHaveLength(Number(carried?.n));
    const refused = await authorised(
      `/admin/tenants/${t.name}/scopes/${spare?.id ?? free}/clients/${client.id}`,
      token,
      'PUT',
      { assignment: 'default' },
    );
    expect(refused.statusCode).toBe(409);
    const changed = await authorised(
      `/admin/tenants/${t.name}/scopes/${held}/clients/${client.id}`,
      token,
      'PUT',
      { assignment: 'default' },
    );
    expect(changed.statusCode).toBe(200);
  });
});

describe('the scopes a new client starts with', () => {
  async function fullDefaults() {
    const t = await fixture.createTenant(`cd-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    await fixture.owner.sql`
      insert into client_scopes (id, tenant_id, name, default_client_assignment)
      select gen_random_uuid(), ${t.id}, 'marked-' || g, 'default'
        from generate_series(1, ${CLIENT_SCOPE_LIMIT} - (select count(*) from client_scopes where tenant_id = ${t.id} and default_client_assignment is not null)) g`;
    const [plain] = await fixture.owner.sql<{ id: string }[]>`
      insert into client_scopes (id, tenant_id, name) values (gen_random_uuid(), ${t.id}, 'plain') returning id`;
    const [marked] = await fixture.owner.sql<{ id: string }[]>`
      select id from client_scopes where tenant_id = ${t.id} and name = 'marked-1'`;
    return { t, token, plain: plain?.id ?? '', marked: marked?.id ?? '' };
  }

  it('are held to CLIENT_SCOPE_LIMIT: a scope marked past it is refused, on create and on amend', async () => {
    const { t, token, plain } = await fullDefaults();
    const created = await authorised(`/admin/tenants/${t.name}/scopes`, token, 'POST', {
      name: 'one-too-many',
      default_client_assignment: 'default',
    });
    expect(created.statusCode).toBe(409);
    expect(created.json<{ detail: string }>().detail).toBe(
      `at most ${String(CLIENT_SCOPE_LIMIT)} scopes are assigned to every new client`,
    );
    const amended = await authorised(`/admin/tenants/${t.name}/scopes/${plain}`, token, 'PATCH', {
      default_client_assignment: 'optional',
    });
    expect(amended.statusCode).toBe(409);
  });

  it('still take a scope marked for no client, and a change between default and optional', async () => {
    const { t, token, marked } = await fullDefaults();
    const created = await authorised(`/admin/tenants/${t.name}/scopes`, token, 'POST', {
      name: 'unmarked',
    });
    expect(created.statusCode).toBe(201);
    const amended = await authorised(`/admin/tenants/${t.name}/scopes/${marked}`, token, 'PATCH', {
      default_client_assignment: 'optional',
    });
    expect(amended.statusCode).toBe(200);
  });
});
