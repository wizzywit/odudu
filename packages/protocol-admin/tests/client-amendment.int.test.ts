import { newId } from '@odudu/kernel';
import { isWellFormedWebOrigin } from '@odudu/protocol-oidc';
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

// The tenant a caller needs before dynamic registration answers anything
// but `404` at all — closed by default (ADR 0026); mirrors
// `openRegistration` in clients.int.test.ts.
async function openRegistration(tenantName: string): Promise<void> {
  const token = await fixture.adminToken(tenantName, ['manage-tenant']);
  const res = await fixture.http.inject({
    method: 'PATCH',
    url: `/admin/tenants/${tenantName}/settings`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: { client_registration_policy: 'open' },
  });
  if (res.statusCode !== 200) {
    throw new Error(`could not open registration for ${tenantName}: ${res.body}`);
  }
}

// A GET's own `ETag`, for the tests below that amend one of the five
// wholesale list fields — `amendClient` requires `If-Match` on those
// (packages/protocol-admin/src/usecase/clients.ts), so a valid amendment to
// one still has to carry the precondition the amendment design added.
async function currentEtag(tenantName: string, clientDbId: string, token: string): Promise<string> {
  const res = await fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenantName}/clients/${clientDbId}`,
    headers: { authorization: `Bearer ${token}` },
  });
  const etag = res.headers.etag;
  if (typeof etag !== 'string') {
    throw new Error(`fixture: no ETag on GET /clients/${clientDbId}`);
  }
  return etag;
}

describe('an amendment that changes what a client may do', () => {
  it('narrowing grant_types stops the next /token call using the removed grant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const client = await fixture.createConfidentialClient(t.name, {
      grantTypes: ['client_credentials', 'refresh_token'],
    });
    const before = await fixture.tokenRequest(t.name, client, { grant_type: 'client_credentials' });
    expect(before.statusCode).toBe(200);

    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const etag = await currentEtag(t.name, client.id, token);
    const patched = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/clients/${client.id}`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'if-match': etag,
      },
      payload: { grant_types: ['refresh_token'] },
    });
    expect(patched.statusCode).toBe(200);

    const after = await fixture.tokenRequest(t.name, client, { grant_type: 'client_credentials' });
    expect(after.statusCode).toBe(400);
    expect(after.json()).toMatchObject({ error: 'unauthorized_client' });
  });

  it('refuses a redirect list registration would refuse, with the same detail', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    await openRegistration(t.name);
    const client = await fixture.createConfidentialClient(t.name, {});
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/clients/${client.id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { redirect_uris: ['https://app.example/cb#fragment'] },
    });
    expect(res.statusCode).toBe(400);
    const registration = await fixture.registerClient(t.name, {
      redirect_uris: ['https://app.example/cb#fragment'],
    });
    expect(res.json<{ detail: string }>().detail).toContain(
      registration.json<{ error_description: string }>().error_description,
    );
  });

  it('replaces a redirect list rather than appending to it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const client = await fixture.createConfidentialClient(t.name, {
      redirectUris: ['https://a.example/cb', 'https://b.example/cb'],
    });
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const etag = await currentEtag(t.name, client.id, token);
    const patched = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/clients/${client.id}`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'if-match': etag,
      },
      payload: { redirect_uris: ['https://a.example/cb'] },
    });
    expect(patched.statusCode).toBe(200);
    const read = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/clients/${client.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(read.json<{ redirect_uris: string[] }>().redirect_uris).toEqual([
      'https://a.example/cb',
    ]);
  });
});

describe('PATCH clients, web_origins', () => {
  // The database has refused these since 0015; until now its CHECK was the
  // only thing that did, and a CHECK fires with the transaction already
  // aborted, so the caller saw a 500.
  it('refuses a value the CHECK would, naming the entry', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const client = await fixture.createConfidentialClient(t.name, {});
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const etag = await currentEtag(t.name, client.id, token);

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/clients/${client.id}`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'if-match': etag,
      },
      payload: { web_origins: ['https://app.example.test/callback'] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toContain('https://app.example.test/callback');
  });

  it('accepts a bare origin and the + wildcard', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const client = await fixture.createConfidentialClient(t.name, {});
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const etag = await currentEtag(t.name, client.id, token);

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/clients/${client.id}`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'if-match': etag,
      },
      payload: { web_origins: ['https://app.example.test', '+'] },
    });

    expect(res.statusCode).toBe(200);
  });
});

// The JS predicate exists so a caller learns which value was refused instead
// of meeting the CHECK with the transaction already aborted. That only holds
// while everything JS admits the CHECK admits too, and the two are written in
// different regex dialects — JS's \s is not PostgreSQL's [:space:] — so the
// containment is asserted here against the real function rather than reasoned
// about.
describe('the web_origins predicate against the CHECK it stands in front of', () => {
  const CORPUS = [
    'https://app.example.test',
    'http://localhost:3000',
    '+',
    'https://app.example.test/callback',
    'https://app.example.test?a=b',
    'https://app.example.test#x',
    'ftp://app.example.test',
    'app.example.test',
    '',
    'https://a b',
    'https://a b',
    'https://a\u0085b',
    'https://a\u001fb',
    'https://a*b',
    'https://:bad',
    'https://host:80:90',
  ];

  it('admits nothing the database would refuse', async () => {
    for (const origin of CORPUS) {
      const rows = await fixture.owner.db.execute<{ ok: boolean | null }>(
        sql`select web_origins_are_valid(array[${origin}]::text[]) as ok`,
      );
      const sqlAccepts = rows[0]?.ok === true;
      const jsAccepts = isWellFormedWebOrigin(origin);

      expect(
        `${JSON.stringify(origin)}: js=${String(jsAccepts)} sql=${String(sqlAccepts)}`,
        'every value JS admits must be one the CHECK admits',
      ).toBe(
        `${JSON.stringify(origin)}: js=${String(jsAccepts)} sql=${String(jsAccepts && !sqlAccepts ? 'VIOLATION' : sqlAccepts)}`,
      );
    }
  });
});
