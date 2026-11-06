import { withTenant } from '@odudu/db';
import { roleRepository } from '@odudu/domain-authz';
import { subjectRepository } from '@odudu/domain-identity';
import { newId } from '@odudu/kernel';
import { sql } from 'drizzle-orm';
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

interface ClientBody {
  id: string;
  client_id: string;
  client_secret?: string;
  service_subject_id: string | null;
  grant_types: string[];
}

async function create(
  tenantName: string,
  token: string,
  payload: Record<string, unknown>,
): Promise<ClientBody> {
  const res = await fixture.http.inject({
    method: 'POST',
    url: `/admin/tenants/${tenantName}/clients`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: { client_id: `c-${newId()}`, ...payload },
  });
  expect(res.statusCode).toBe(201);
  return res.json<ClientBody>();
}

async function subjectExists(tenantId: string, id: string): Promise<boolean> {
  return withTenant(
    fixture.app.db,
    tenantId,
    async (tx) => (await subjectRepository(tx).byId(id)) !== null,
  );
}

async function serviceSubjectCount(tenantId: string): Promise<number> {
  return withTenant(fixture.app.db, tenantId, async (tx) => {
    const rows = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from subjects where type = 'service'`,
    );
    return rows[0]?.n ?? 0;
  });
}

async function holdARole(tenantId: string, subjectId: string): Promise<void> {
  await withTenant(fixture.app.db, tenantId, async (tx) => {
    const role = await roleRepository(tx).create({ tenantId, name: `reader-${newId()}` });
    await roleRepository(tx).assignToSubject(subjectId, role.id);
  });
}

async function heldBy(
  tenantId: string,
  subjectId: string,
): Promise<{ grants: number; roles: number }> {
  return withTenant(fixture.app.db, tenantId, async (tx) => {
    const rows = await tx.execute<{ grants: number; roles: number }>(sql`
      select (select count(*)::int from token_grants where subject_id = ${subjectId}) as grants,
             (select count(*)::int from subject_roles where subject_id = ${subjectId}) as roles`);
    return rows[0] ?? { grants: -1, roles: -1 };
  });
}

async function readClient(tenantName: string, token: string, id: string): Promise<ClientBody> {
  const res = await fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenantName}/clients/${id}`,
    headers: { authorization: `Bearer ${token}` },
  });
  return res.json<ClientBody>();
}

async function etagOf(tenantName: string, token: string, id: string): Promise<string> {
  const res = await fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenantName}/clients/${id}`,
    headers: { authorization: `Bearer ${token}` },
  });
  return String(res.headers.etag);
}

function patch(
  tenantName: string,
  token: string,
  id: string,
  ifMatch: string,
  payload: Record<string, unknown>,
) {
  return fixture.http.inject({
    method: 'PATCH',
    url: `/admin/tenants/${tenantName}/clients/${id}`,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'if-match': ifMatch,
    },
    payload,
  });
}

function clientCredentials(tenantName: string, clientId: string, secret: string | undefined) {
  return fixture.http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/protocol/openid-connect/token`,
    payload: 'grant_type=client_credentials',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${clientId}:${secret ?? ''}`).toString('base64')}`,
    },
  });
}

describe('a client and its service account', () => {
  it('is given one when confidential, never when public, whichever door created it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const confidential = await create(t.name, token, {
      grant_types: ['client_credentials'],
      token_endpoint_auth_method: 'client_secret_basic',
    });
    const publicClient = await create(t.name, token, {
      redirect_uris: ['https://app.example/cb'],
      token_endpoint_auth_method: 'none',
    });
    expect(confidential.service_subject_id).not.toBeNull();
    expect(publicClient.service_subject_id).toBeNull();

    const tenantToken = await fixture.adminToken(t.name, ['manage-tenant']);
    await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${tenantToken}`, 'content-type': 'application/json' },
      payload: { client_registration_policy: 'open' },
    });
    const registered = await fixture.registerClient(t.name, {
      grant_types: ['client_credentials'],
      token_endpoint_auth_method: 'client_secret_basic',
    });
    expect(registered.statusCode).toBe(201);
    const registeredPublic = await fixture.registerClient(t.name, {
      redirect_uris: ['https://app.example/cb'],
      token_endpoint_auth_method: 'none',
    });
    expect(registeredPublic.statusCode).toBe(201);
    const read = async (clientId: string) => {
      const res = await fixture.http.inject({
        method: 'GET',
        url: `/admin/tenants/${t.name}/clients?client_id_exact=${clientId}`,
        headers: { authorization: `Bearer ${token}` },
      });
      return res.json<{ items: ClientBody[] }>().items[0];
    };
    const confidentialRead = await read(registered.json<{ client_id: string }>().client_id);
    const publicRead = await read(registeredPublic.json<{ client_id: string }>().client_id);
    expect(confidentialRead?.service_subject_id).not.toBeNull();
    expect(publicRead?.service_subject_id).toBeNull();
  });

  it('cannot change between public and confidential, so the account never has to follow', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const confidential = await create(t.name, token, {
      grant_types: ['client_credentials'],
      token_endpoint_auth_method: 'client_secret_basic',
    });
    const read = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/clients/${confidential.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/clients/${confidential.id}`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'if-match': String(read.headers.etag),
      },
      payload: { token_endpoint_auth_method: 'none' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ detail: string }>().detail).toContain('security model');
    const after = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/clients/${confidential.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.json<ClientBody>().service_subject_id).toBe(confidential.service_subject_id);
  });

  it('has none while it lacks the client credentials grant, through every door', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const signsPeopleIn = await create(t.name, token, {
      grant_types: ['authorization_code'],
      redirect_uris: ['https://app.example/cb'],
      token_endpoint_auth_method: 'client_secret_basic',
    });
    expect(signsPeopleIn.service_subject_id).toBeNull();
    expect(await serviceSubjectCount(t.id)).toBe(0);

    const tenantToken = await fixture.adminToken(t.name, ['manage-tenant']);
    await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${tenantToken}`, 'content-type': 'application/json' },
      payload: { client_registration_policy: 'open' },
    });
    const registered = await fixture.registerClient(t.name, {
      grant_types: ['authorization_code'],
      redirect_uris: ['https://app.example/cb'],
      token_endpoint_auth_method: 'client_secret_basic',
    });
    expect(registered.statusCode).toBe(201);
    expect(await serviceSubjectCount(t.id)).toBe(0);
  });

  it('is created when the grant is switched on, once, whoever races to do it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const client = await create(t.name, token, {
      grant_types: ['authorization_code'],
      redirect_uris: ['https://app.example/cb'],
      token_endpoint_auth_method: 'client_secret_basic',
    });
    const etag = await etagOf(t.name, token, client.id);
    const patches = await Promise.all(
      [1, 2, 3].map(() =>
        patch(t.name, token, client.id, etag, {
          grant_types: ['authorization_code', 'client_credentials'],
        }),
      ),
    );
    expect(patches.filter((res) => res.statusCode === 200)).toHaveLength(1);
    expect(patches.filter((res) => res.statusCode === 412)).toHaveLength(2);
    expect(await serviceSubjectCount(t.id)).toBe(1);
    const after = await readClient(t.name, token, client.id);
    expect(after.service_subject_id).not.toBeNull();
    expect(after.grant_types).toEqual(['authorization_code', 'client_credentials']);
  });

  it('is created when a grant change that keeps the client credentials grant finds none', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const client = await create(t.name, token, {
      grant_types: ['client_credentials'],
      token_endpoint_auth_method: 'client_secret_basic',
    });
    await withTenant(fixture.app.db, t.id, async (tx) => {
      await tx.execute(sql`update clients set service_subject_id = null where id = ${client.id}`);
    });
    const res = await patch(t.name, token, client.id, await etagOf(t.name, token, client.id), {
      grant_types: ['client_credentials'],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<ClientBody>().service_subject_id).not.toBeNull();
  });

  it('is taken away with everything it held when the grant is switched off, and a leaked secret buys nothing', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const client = await create(t.name, token, {
      grant_types: ['authorization_code', 'client_credentials'],
      redirect_uris: ['https://app.example/cb'],
      token_endpoint_auth_method: 'client_secret_basic',
    });
    const subject = client.service_subject_id ?? '';
    await holdARole(t.id, subject);
    const issued = await clientCredentials(t.name, client.client_id, client.client_secret);
    expect(issued.statusCode).toBe(200);

    const res = await patch(t.name, token, client.id, await etagOf(t.name, token, client.id), {
      grant_types: ['authorization_code'],
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<ClientBody>();
    expect(body.grant_types).toEqual(['authorization_code']);
    expect(body.service_subject_id).toBeNull();
    expect(await subjectExists(t.id, subject)).toBe(false);
    expect(await heldBy(t.id, subject)).toEqual({ grants: 0, roles: 0 });

    const leaked = await clientCredentials(t.name, client.client_id, client.client_secret);
    expect(leaked.statusCode).toBe(400);
    expect(leaked.json<{ error: string }>().error).toBe('unauthorized_client');
    const stale = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/clients`,
      headers: { authorization: `Bearer ${issued.json<{ access_token: string }>().access_token}` },
    });
    expect(stale.statusCode).toBe(401);
  });

  it('does not bring back the roles of an earlier account when the grant returns', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const client = await create(t.name, token, {
      grant_types: ['client_credentials'],
      token_endpoint_auth_method: 'client_secret_basic',
    });
    const first = client.service_subject_id ?? '';
    await holdARole(t.id, first);
    await patch(t.name, token, client.id, await etagOf(t.name, token, client.id), {
      grant_types: ['authorization_code'],
      redirect_uris: ['https://app.example/cb'],
    });
    const back = await patch(t.name, token, client.id, await etagOf(t.name, token, client.id), {
      grant_types: ['authorization_code', 'client_credentials'],
    });
    expect(back.statusCode).toBe(200);
    const second = back.json<ClientBody>().service_subject_id ?? '';
    expect(second).not.toBe('');
    expect(second).not.toBe(first);
    expect(await heldBy(t.id, second)).toEqual({ grants: 0, roles: 0 });
  });

  it('retires an account the upgrade left standing on the next grant change, whatever it changes to', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const client = await create(t.name, token, {
      grant_types: ['client_credentials'],
      token_endpoint_auth_method: 'client_secret_basic',
    });
    const subject = client.service_subject_id ?? '';
    await holdARole(t.id, subject);
    await withTenant(fixture.app.db, t.id, async (tx) => {
      await tx.execute(
        sql`update client_oidc_config set grant_types = ARRAY['authorization_code'],
                   redirect_uris = ARRAY['https://app.example/cb'] where client_id = ${client.id}`,
      );
      await tx.execute(sql`update clients set service_account_idle = true where id = ${client.id}`);
    });
    const res = await patch(t.name, token, client.id, await etagOf(t.name, token, client.id), {
      grant_types: ['authorization_code'],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<ClientBody>().service_subject_id).toBeNull();
    expect(await subjectExists(t.id, subject)).toBe(false);
  });

  it('is left alone, with the grant on, when a later amendment changes something else', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const client = await create(t.name, token, {
      grant_types: ['client_credentials'],
      token_endpoint_auth_method: 'client_secret_basic',
    });
    const res = await patch(t.name, token, client.id, await etagOf(t.name, token, client.id), {
      description: 'noted',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<ClientBody>().service_subject_id).toBe(client.service_subject_id);
  });

  it('is not touched by a caller of another tenant switching the grant off', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const other = await fixture.createTenant(`other-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const otherToken = await fixture.adminToken(other.name, ['manage-clients']);
    const client = await create(t.name, token, {
      grant_types: ['authorization_code', 'client_credentials'],
      redirect_uris: ['https://app.example/cb'],
      token_endpoint_auth_method: 'client_secret_basic',
    });
    const res = await patch(other.name, otherToken, client.id, '*', {
      grant_types: ['authorization_code'],
    });
    expect(res.statusCode).toBe(404);
    expect(await subjectExists(t.id, client.service_subject_id ?? '')).toBe(true);
  });

  it('records the grant list and the account in the amendment it audits', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients', 'view-audit']);
    const client = await create(t.name, token, {
      grant_types: ['authorization_code', 'client_credentials'],
      redirect_uris: ['https://app.example/cb'],
      token_endpoint_auth_method: 'client_secret_basic',
    });
    await patch(t.name, token, client.id, await etagOf(t.name, token, client.id), {
      grant_types: ['authorization_code'],
    });
    const audit = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/audit?resource_type=client&resource_id=${client.id}&outcome=allowed`,
      headers: { authorization: `Bearer ${token}` },
    });
    const amend = audit
      .json<{ items: { action: string; detail: Record<string, unknown> }[] }>()
      .items.find((item) => item.action === 'client.amend');
    expect(JSON.stringify(amend?.detail)).toContain('grant_types');
    expect(JSON.stringify(amend?.detail)).toContain('service_subject_id');
  });

  it('is deleted with the client, and a caller of another tenant can neither reach nor remove it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const other = await fixture.createTenant(`other-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const otherToken = await fixture.adminToken(other.name, ['manage-clients']);
    const client = await create(t.name, token, {
      grant_types: ['client_credentials'],
      token_endpoint_auth_method: 'client_secret_basic',
    });
    const subject = client.service_subject_id ?? '';
    expect(await subjectExists(t.id, subject)).toBe(true);
    expect(await subjectExists(other.id, subject)).toBe(false);

    const foreign = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${other.name}/clients/${client.id}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(foreign.statusCode).toBe(404);
    expect(await subjectExists(t.id, subject)).toBe(true);

    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/clients/${client.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);
    expect(await subjectExists(t.id, subject)).toBe(false);
  });

  it("refuses to delete a subject that is a client's service account, audits it, and keeps both", async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const other = await fixture.createTenant(`other-${newId()}`);
    const token = await fixture.adminToken(t.name, [
      'manage-clients',
      'manage-users',
      'view-audit',
    ]);
    const otherToken = await fixture.adminToken(other.name, ['manage-users']);
    const clientId = `svc-${newId()}`;
    const client = await create(t.name, token, {
      client_id: clientId,
      grant_types: ['client_credentials'],
      token_endpoint_auth_method: 'client_secret_basic',
    });
    const subject = client.service_subject_id ?? '';

    const foreign = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${other.name}/subjects/${subject}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(foreign.statusCode).toBe(404);
    expect(await subjectExists(t.id, subject)).toBe(true);

    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/subjects/${subject}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json<{ type: string; detail: string }>();
    expect(body.type).toBe('about:blank#service-account');
    expect(body.detail).toBe(
      `This subject is the service account of client ${clientId}. Delete the client instead.`,
    );
    expect(await subjectExists(t.id, subject)).toBe(true);

    const audit = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/audit?resource_type=subject&resource_id=${subject}&outcome=refused`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(audit.json<{ items: { action: string }[] }>().items.map((i) => i.action)).toContain(
      'subject.delete',
    );

    const removed = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/clients/${client.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(removed.statusCode).toBe(204);
    expect(await subjectExists(t.id, subject)).toBe(false);
  });

  it('refuses the same delete inside a bulk request, naming the type per item', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients', 'manage-users']);
    const client = await create(t.name, token, {
      grant_types: ['client_credentials'],
      token_endpoint_auth_method: 'client_secret_basic',
    });
    const subject = client.service_subject_id ?? '';
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/subjects/bulk`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ action: 'delete', ids: [subject] }),
    });
    expect(res.json<{ items: { status: number; type?: string }[] }>().items).toEqual([
      expect.objectContaining({ status: 409, type: 'about:blank#service-account' }),
    ]);
    expect(await subjectExists(t.id, subject)).toBe(true);
  });
});
