import { executionRepository } from '@odudu/authn-flows';
import { MAX_LIMIT } from '@odudu/contracts/admin';
import { signingKeyRepository } from '@odudu/crypto';
import { tenants, withTenant, type RequestContext } from '@odudu/db';
import { clientRepository, TENANT_CAPABILITIES, TENANT_NAME_RULE } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { ADMIN_CLIENT_REDIRECT_URI, clientOidcConfigRepository } from '@odudu/protocol-oidc';
import { eq, sql } from 'drizzle-orm';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FIXTURE_CONSOLE_BASE_URL,
  FIXTURE_CONSOLE_JWKS,
  startAdminFixture,
  type AdminFixture,
} from '#/testing/admin-fixture';
import { createTenant } from '#/usecase/tenants';

// Matches the fixture's own KEK (packages/protocol-admin/src/testing/
// admin-fixture.ts) — a fixed value is fine, since nothing outside this
// file needs to read what it encrypts.
const KEK = Buffer.alloc(32, 7);
const NO_CONTEXT: RequestContext = { requestId: null, ip: null };

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

describe('POST /admin/tenants', () => {
  it('provisions the flow and the admin client with the tenant', async () => {
    const token = await fixture.systemAdminToken(['manage-tenants']);
    const name = `acme-${newId()}`;
    const res = await fixture.http.inject({
      method: 'POST',
      url: '/admin/tenants',
      headers: { authorization: `Bearer ${token}` },
      payload: { name, display_name: 'Acme' },
    });
    expect(res.statusCode).toBe(201);
    const { id } = res.json<{ id: string }>();
    await withTenant(fixture.app.db, id, async (tx) => {
      expect(await executionRepository(tx).forTenant(id)).not.toHaveLength(0);
      expect(await clientRepository(tx).byClientId('odudu-admin')).not.toBeNull();
    });
  });

  it("registers the console's redirect and post-logout URIs on the new admin client", async () => {
    const token = await fixture.systemAdminToken(['manage-tenants']);
    const res = await fixture.http.inject({
      method: 'POST',
      url: '/admin/tenants',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: `console-${newId()}` },
    });
    expect(res.statusCode).toBe(201);
    const { id } = res.json<{ id: string }>();
    const config = await withTenant(fixture.app.db, id, async (tx) => {
      const client = await clientRepository(tx).byClientId('odudu-admin');
      if (client === null) throw new Error('the admin client was not provisioned');
      return clientOidcConfigRepository(tx).byClientId(client.id);
    });
    expect(config?.redirectUris).toEqual([
      ADMIN_CLIENT_REDIRECT_URI,
      `${FIXTURE_CONSOLE_BASE_URL}/console/auth/callback`,
    ]);
    expect(config?.postLogoutRedirectUris).toEqual([`${FIXTURE_CONSOLE_BASE_URL}/console/`]);
  });

  it("registers the console's key on the new admin client, which authenticates with it", async () => {
    const token = await fixture.systemAdminToken(['manage-tenants']);
    const res = await fixture.http.inject({
      method: 'POST',
      url: '/admin/tenants',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: `keyed-${newId()}` },
    });
    expect(res.statusCode).toBe(201);
    const { id } = res.json<{ id: string }>();
    const stored = await withTenant(fixture.app.db, id, async (tx) => {
      const client = await clientRepository(tx).byClientId('odudu-admin');
      if (client === null) throw new Error('the admin client was not provisioned');
      return { client, config: await clientOidcConfigRepository(tx).byClientId(client.id) };
    });
    expect(stored.client).toMatchObject({ type: 'confidential', secretHash: null });
    expect(stored.config).toMatchObject({
      tokenEndpointAuthMethod: 'private_key_jwt',
      jwks: FIXTURE_CONSOLE_JWKS,
    });
  });

  it('records the caller’s request id and address on its own tenant.create row', async () => {
    // manage-tenants and view-audit both on the system tenant's own admin
    // client — the same cross-tenant reach a system admin uses to read a
    // tenant it did not create through the fixture's own bookkeeping.
    const token = await fixture.systemAdminToken(['manage-tenants', 'view-audit']);
    const name = `acme-${newId()}`;
    const created = await fixture.http.inject({
      method: 'POST',
      url: '/admin/tenants',
      headers: { authorization: `Bearer ${token}`, 'x-request-id': 'probe-456' },
      payload: { name },
    });
    expect(created.statusCode).toBe(201);

    const audit = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${name}/audit?action=tenant.create`,
      headers: { authorization: `Bearer ${token}` },
    });
    const body = audit.json<{ items: { request_id: string | null; ip: string | null }[] }>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.request_id).toBe('probe-456');
    expect(body.items[0]?.ip).toBe('127.0.0.1');
  });

  it('refuses a numeric name rather than creating a tenant called "123"', async () => {
    const token = await fixture.systemAdminToken(['manage-tenants']);
    const res = await fixture.http.inject({
      method: 'POST',
      url: '/admin/tenants',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 123 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('answers 409 for a name another tenant already holds', async () => {
    const token = await fixture.systemAdminToken(['manage-tenants']);
    const name = `acme-${newId()}`;
    const first = await fixture.http.inject({
      method: 'POST',
      url: '/admin/tenants',
      headers: { authorization: `Bearer ${token}` },
      payload: { name },
    });
    expect(first.statusCode).toBe(201);
    const again = await fixture.http.inject({
      method: 'POST',
      url: '/admin/tenants',
      headers: { authorization: `Bearer ${token}` },
      payload: { name },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json<{ detail: string }>().detail).toContain(name);
  });

  it('refuses the name system', async () => {
    const token = await fixture.systemAdminToken(['manage-tenants']);
    const res = await fixture.http.inject({
      method: 'POST',
      url: '/admin/tenants',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'system' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('refuses the name count, which a tenant collection route would shadow', async () => {
    const token = await fixture.systemAdminToken(['manage-tenants']);
    const res = await fixture.http.inject({
      method: 'POST',
      url: '/admin/tenants',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'count' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('refuses a name that is not a DNS label, creating nothing', async () => {
    const token = await fixture.systemAdminToken(['manage-tenants']);
    const name = 'Acme';
    const res = await fixture.http.inject({
      method: 'POST',
      url: '/admin/tenants',
      headers: { authorization: `Bearer ${token}` },
      payload: { name },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toBe(TENANT_NAME_RULE);

    const listed = await fixture.http.inject({
      method: 'GET',
      url: '/admin/tenants',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listed.json<{ items: { name: string }[] }>().items).not.toContainEqual(
      expect.objectContaining({ name }),
    );
  });

  it('refuses a tenant-local admin holding every tenant capability', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, [...TENANT_CAPABILITIES]);
    const res = await fixture.http.inject({
      method: 'POST',
      url: '/admin/tenants',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: `sneaky-${newId()}` },
    });
    // The issuer comparison in router.ts refuses this before any
    // capability is read: a token minted in T names neither `/admin/tenants`'
    // target (the system tenant) nor T itself as `iss`, so this collapses
    // into the same 401 a forged system-tenant token would get, never the
    // 403 a system admin without manage-tenants would.
    expect(res.statusCode).toBe(401);
  });

  it('refuses a system admin holding a capability other than manage-tenants', async () => {
    const token = await fixture.systemAdminToken(['view-users']);
    const res = await fixture.http.inject({
      method: 'POST',
      url: '/admin/tenants',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: `sneaky-${newId()}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /admin/tenants', () => {
  it('pages with an opaque cursor that actually advances', async () => {
    const token = await fixture.systemAdminToken(['manage-tenants']);
    const prefix = `page-${newId()}`;
    for (const suffix of ['a1', 'a2', 'a3']) {
      await fixture.createTenant(`${prefix}-${suffix}`);
    }

    const first = await fixture.http.inject({
      method: 'GET',
      url: '/admin/tenants?limit=2',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json<{ items: { id: string }[]; next?: string }>();
    expect(firstBody.items).toHaveLength(2);
    expect(first.headers.link).toMatch(/rel="next"/u);

    const second = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants?limit=2&cursor=${encodeURIComponent(firstBody.next ?? '')}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json<{ items: { id: string }[] }>();
    expect(secondBody.items).toHaveLength(2);

    // The point of a cursor: the second page holds rows the first did not,
    // not merely that a `next` member was present.
    const firstIds = new Set(firstBody.items.map((item) => item.id));
    for (const item of secondBody.items) {
      expect(firstIds.has(item.id)).toBe(false);
    }
  });

  it('omits the next link and body member once the collection fits on one page', async () => {
    const token = await fixture.systemAdminToken(['manage-tenants']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: '/admin/tenants?limit=200',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers.link).toBeUndefined();
    expect(res.json()).not.toHaveProperty('next');
  });

  it('returns no total', async () => {
    const token = await fixture.systemAdminToken(['manage-tenants']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: '/admin/tenants',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json()).not.toHaveProperty('total');
    expect(res.json()).not.toHaveProperty('total_size');
  });

  it('lists the system tenant itself, not only tenants created through the API', async () => {
    const token = await fixture.systemAdminToken(['manage-tenants']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: '/admin/tenants?limit=200',
      headers: { authorization: `Bearer ${token}` },
    });
    const body = res.json<{ items: { id: string }[] }>();
    expect(body.items.map((item) => item.id)).toContain(fixture.systemTenantId);
  });

  it('refuses a system admin holding a capability other than manage-tenants', async () => {
    const token = await fixture.systemAdminToken(['view-users']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: '/admin/tenants',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('clamps an over-large limit rather than refusing it', async () => {
    const token = await fixture.systemAdminToken(['manage-tenants']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: '/admin/tenants?limit=1000',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ items: unknown[] }>().items.length).toBeLessThanOrEqual(MAX_LIMIT);
  });
});

// Every tenant in this file shares one database, so each search is scoped
// by a prefix no other test's tenant can carry.
function uniquePrefix(): string {
  return `q${newId().replace(/-/gu, '').slice(-10)}`;
}

async function seedTenant(name: string, displayName: string | null = null): Promise<string> {
  const t = await fixture.createTenant(name);
  if (displayName !== null) {
    await fixture.owner.db.update(tenants).set({ displayName }).where(eq(tenants.id, t.id));
  }
  return t.id;
}

async function listTenantsAt(query: string): Promise<LightMyRequestResponse> {
  const token = await fixture.systemAdminToken(['manage-tenants']);
  return fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants?${query}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

function namesOf(res: LightMyRequestResponse): string[] {
  return res.json<{ items: { name: string }[] }>().items.map((t) => t.name);
}

// PostgreSQL's own answer, in the order a searched listing promises, so no
// expectation here folds a string in JavaScript.
async function displayNameMatches(prefix: string): Promise<string[]> {
  const rows = await fixture.owner.db.execute<{ name: string }>(sql`
    select name from tenants
     where starts_with(lower(display_name), lower(${prefix}))
     order by lower(display_name) collate "C", id
  `);
  return rows.map((row) => row.name);
}

describe('GET /admin/tenants — search and exact filters', () => {
  it('finds a name case-insensitively', async () => {
    const p = uniquePrefix();
    await seedTenant(`${p}-ada`);
    await seedTenant(`${p}-grace`);

    const res = await listTenantsAt(`name=${p.toUpperCase()}-A`);
    expect(res.statusCode).toBe(200);
    expect(namesOf(res)).toEqual([`${p}-ada`]);
  });

  it('orders display-name matches by the folded display name, then by id', async () => {
    const p = uniquePrefix();
    await seedTenant(`${p}-1`, `${p} Acme c`);
    await seedTenant(`${p}-2`, `${p.toUpperCase()} acme A`);
    await seedTenant(`${p}-3`, `${p} ACME b`);
    await seedTenant(`${p}-4`, `${p} acme a`);
    await seedTenant(`${p}-5`, `${p} Beta`);

    const res = await listTenantsAt(`display_name=${encodeURIComponent(`${p} acme`)}`);
    expect(res.statusCode).toBe(200);
    const expected = await displayNameMatches(`${p} acme`);
    expect(expected).toHaveLength(4);
    expect(namesOf(res)).toEqual(expected);
  });

  it('pages a display-name search one row at a time, each match once and in order', async () => {
    const p = uniquePrefix();
    for (const [suffix, display] of [
      ['1', 'B'],
      ['2', 'a'],
      ['3', 'C'],
    ] as const) {
      await seedTenant(`${p}-${suffix}`, `${p}-${display}`);
    }

    const seen: string[] = [];
    let query = `display_name=${p}&limit=1`;
    for (let page = 0; page < 5; page += 1) {
      const res = await listTenantsAt(query);
      expect(res.statusCode).toBe(200);
      const body = res.json<{ items: { name: string }[]; next?: string }>();
      seen.push(...body.items.map((t) => t.name));
      if (body.next === undefined) break;
      query = `display_name=${p}&limit=1&cursor=${encodeURIComponent(body.next)}`;
    }
    expect(seen).toEqual([`${p}-2`, `${p}-1`, `${p}-3`]);
  });

  it('reads _ and % in a display name as ordinary characters', async () => {
    const p = uniquePrefix();
    await seedTenant(`${p}-x`, `${p}axb`);
    await seedTenant(`${p}-u`, `${p}a_b`);
    await seedTenant(`${p}-c`, `${p}a%b`);

    expect(namesOf(await listTenantsAt(`display_name=${p}a_b`))).toEqual([`${p}-u`]);
    expect(namesOf(await listTenantsAt(`display_name=${p}a%25`))).toEqual([`${p}-c`]);
  });

  it('filters by ?enabled=, ANDed with a search', async () => {
    const p = uniquePrefix();
    const off = await seedTenant(`${p}-off`);
    await seedTenant(`${p}-on`);
    await fixture.owner.db.update(tenants).set({ enabled: false }).where(eq(tenants.id, off));

    expect(namesOf(await listTenantsAt(`name=${p}&enabled=false`))).toEqual([`${p}-off`]);
    expect(namesOf(await listTenantsAt(`name=${p}&enabled=true`))).toEqual([`${p}-on`]);
    const disabled = await listTenantsAt('enabled=false&limit=200');
    expect(disabled.statusCode).toBe(200);
    const items = disabled.json<{ items: { enabled: boolean }[] }>().items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((t) => !t.enabled)).toBe(true);
  });

  it('refuses an unknown parameter with 400 naming it', async () => {
    const res = await listTenantsAt('search=acme');
    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toContain('search');
  });

  it('refuses a search over name and display_name at once', async () => {
    const res = await listTenantsAt('name=a&display_name=b');
    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toContain('one field at a time');
  });

  it('refuses an enabled value that is not true or false', async () => {
    expect((await listTenantsAt('enabled=yes')).statusCode).toBe(400);
  });

  it.each([
    ['another search', 'name={p}-a&limit=1', 'name={p}-b&limit=1'],
    ['a filter added', 'name={p}&limit=1', 'name={p}&enabled=true&limit=1'],
    ['a filter dropped', 'name={p}&enabled=true&limit=1', 'name={p}&limit=1'],
  ])('refuses a cursor replayed under %s', async (_label, minted, replayedUnder) => {
    const p = uniquePrefix();
    for (const suffix of ['a1', 'a2', 'b1', 'b2']) await seedTenant(`${p}-${suffix}`);

    const first = await listTenantsAt(minted.replaceAll('{p}', p));
    const next = first.json<{ next?: string }>().next;
    if (next === undefined) throw new Error('expected a next cursor');

    const replayed = await listTenantsAt(
      `${replayedUnder.replaceAll('{p}', p)}&cursor=${encodeURIComponent(next)}`,
    );
    expect(replayed.statusCode).toBe(400);
    expect(replayed.json<{ detail: string }>().detail).toBe('cursor is invalid or expired');
  });
});

describe('createTenant', () => {
  it('calls audit exactly once when it creates a tenant', async () => {
    const events: unknown[] = [];
    const outcome = await createTenant(
      {
        database: fixture.app.db,
        kek: KEK,
        audit: (_tx, event) => {
          events.push(event);
          return Promise.resolve();
        },
      },
      {
        name: `audited-${newId()}`,
        actorSubjectId: 'test-subject',
        actorTenantId: 'test-tenant',
        actorClientId: 'test-client',
      },
      NO_CONTEXT,
    );
    expect(outcome.kind).toBe('created');
    expect(events).toHaveLength(1);
  });

  it('does not call audit when it refuses the system name', async () => {
    const events: unknown[] = [];
    const outcome = await createTenant(
      {
        database: fixture.app.db,
        kek: KEK,
        audit: (_tx, event) => {
          events.push(event);
          return Promise.resolve();
        },
      },
      {
        name: 'system',
        actorSubjectId: 'test-subject',
        actorTenantId: 'test-tenant',
        actorClientId: 'test-client',
      },
      NO_CONTEXT,
    );
    expect(outcome.kind).toBe('name_refused');
    expect(events).toHaveLength(0);
  });

  it('does not call audit when it refuses a name that is not a DNS label', async () => {
    const events: unknown[] = [];
    const outcome = await createTenant(
      {
        database: fixture.app.db,
        kek: KEK,
        audit: (_tx, event) => {
          events.push(event);
          return Promise.resolve();
        },
      },
      {
        name: 'Acme',
        actorSubjectId: 'test-subject',
        actorTenantId: 'test-tenant',
        actorClientId: 'test-client',
      },
      NO_CONTEXT,
    );
    expect(outcome.kind).toBe('name_invalid');
    expect(events).toHaveLength(0);
  });

  it('mints a signing key in the same transaction as the row', async () => {
    const outcome = await createTenant(
      { database: fixture.app.db, kek: KEK, audit: () => Promise.resolve() },
      {
        name: `keyed-${newId()}`,
        actorSubjectId: 'test-subject',
        actorTenantId: 'test-tenant',
        actorClientId: 'test-client',
      },
      NO_CONTEXT,
    );
    if (outcome.kind !== 'created') throw new Error('expected the tenant to be created');
    await withTenant(fixture.app.db, outcome.tenant.id, async (tx) => {
      expect(await signingKeyRepository(tx).listPublishable()).not.toHaveLength(0);
    });
  });
});

describe('GET /admin/tenants/{t} and PATCH /admin/tenants/{t}', () => {
  it('reads the tenant singly, with an ETag over the same shape the list carries', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers.etag).toEqual(expect.any(String));
    expect(res.json<{ id: string; name: string; enabled: boolean }>()).toMatchObject({
      id: t.id,
      name: t.name,
      enabled: true,
    });
  });

  it('renames the display name and disables the tenant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { display_name: 'Acme Holdings', enabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ display_name: string; enabled: boolean }>()).toMatchObject({
      display_name: 'Acme Holdings',
      enabled: false,
    });

    // Read back from the row, not through the API: a disabled tenant is
    // one its own administrators can no longer authenticate against, which
    // is the whole point of the flag.
    const rows = await withTenant(fixture.app.db, t.id, (tx) =>
      tx.select({ enabled: tenants.enabled }).from(tenants).where(eq(tenants.id, t.id)),
    );
    expect(rows[0]?.enabled).toBe(false);
  });

  it('refuses a rename, naming the issuer URLs already minted as the reason', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { name: `renamed-${newId()}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toContain('issuer URL');
  });

  it('refuses disabling the system tenant, which every cross-tenant admin needs', async () => {
    const token = await fixture.systemAdminToken(['manage-tenants', 'manage-tenant']);

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: '/admin/tenants/system',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(409);

    const after = await fixture.http.inject({
      method: 'GET',
      url: '/admin/tenants/system',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.json<{ enabled: boolean }>().enabled).toBe(true);
  });

  it('answers 412 for a stale If-Match and changes nothing', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const read = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const etag = String(read.headers.etag);

    const first = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'if-match': etag,
      },
      payload: { display_name: 'First' },
    });
    expect(first.statusCode).toBe(200);

    const second = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'if-match': etag,
      },
      payload: { display_name: 'Second' },
    });
    expect(second.statusCode).toBe(412);

    const after = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.json<{ display_name: string }>().display_name).toBe('First');
  });

  it('records one audit row for an amendment and none for a refusal', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant', 'view-audit']);

    const refused = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { name: 'nope' },
    });
    expect(refused.statusCode).toBe(400);

    const amended = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { display_name: 'Acme' },
    });
    expect(amended.statusCode).toBe(200);

    const audit = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/audit`,
      headers: { authorization: `Bearer ${token}` },
    });
    const actions = audit
      .json<{ items: { action: string }[] }>()
      .items.filter((item) => item.action === 'tenant.amend');
    expect(actions).toHaveLength(1);
  });
});
