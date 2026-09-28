import { withTenant, type TenantScopedDatabase } from '@odudu/db';
import { clientRegistrationTokenRepository } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import {
  mintRegistrationToken,
  revokeRegistrationToken,
  type RegistrationTokenAuditEvent,
} from '#/usecase/registration-tokens';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

function tokensUrl(tenantName: string): string {
  return `/admin/tenants/${tenantName}/registration-tokens`;
}

async function setPolicy(tenantName: string, policy: 'disabled' | 'open' | 'token'): Promise<void> {
  const token = await fixture.adminToken(tenantName, ['manage-tenant']);
  const res = await fixture.http.inject({
    method: 'PATCH',
    url: `/admin/tenants/${tenantName}/settings`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: { client_registration_policy: policy },
  });
  if (res.statusCode !== 200) {
    throw new Error(`could not set the registration policy for ${tenantName}: ${res.body}`);
  }
}

function registerWithToken(tenantName: string, registrationToken: string) {
  return fixture.http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/clients-registrations/openid-connect`,
    payload: JSON.stringify({ redirect_uris: ['https://rp.example/cb'] }),
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${registrationToken}`,
    },
  });
}

describe('GET /admin/tenants/{t}/registration-tokens', () => {
  async function mint(tenantName: string, token: string): Promise<{ id: string }> {
    const res = await fixture.http.inject({
      method: 'POST',
      url: tokensUrl(tenantName),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { uses: 1, ttl_seconds: 3600 },
    });
    return res.json<{ id: string }>();
  }

  async function listAt(
    tenantName: string,
    token: string,
    query: string,
  ): Promise<{ items: { id: string }[]; next?: string }> {
    const res = await fixture.http.inject({
      method: 'GET',
      url: `${tokensUrl(tenantName)}?${query}`,
      headers: { authorization: `Bearer ${token}` },
    });
    return res.json<{ items: { id: string }[]; next?: string }>();
  }

  it('pages at the given limit, in id order', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const minted = [
      await mint(t.name, token),
      await mint(t.name, token),
      await mint(t.name, token),
    ];
    const sortedIds = minted.map((m) => m.id).sort();

    const first = await listAt(t.name, token, 'limit=1');
    expect(first.items.map((item) => item.id)).toEqual([sortedIds[0]]);
    if (first.next === undefined) throw new Error('expected a next cursor');

    const second = await listAt(t.name, token, `limit=1&cursor=${encodeURIComponent(first.next)}`);
    expect(second.items.map((item) => item.id)).toEqual([sortedIds[1]]);
    if (second.next === undefined) throw new Error('expected a next cursor');

    const third = await listAt(t.name, token, `limit=1&cursor=${encodeURIComponent(second.next)}`);
    expect(third.items.map((item) => item.id)).toEqual([sortedIds[2]]);
    expect(third.next).toBeUndefined();
  });

  it('still finds the next token once the page-1 anchor has been revoked', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const minted = [
      await mint(t.name, token),
      await mint(t.name, token),
      await mint(t.name, token),
    ];
    const sortedIds = minted.map((m) => m.id).sort();

    const first = await listAt(t.name, token, 'limit=1');
    const anchorId = first.items[0]?.id;
    if (anchorId === undefined || first.next === undefined) {
      throw new Error('expected a first page with a next cursor');
    }

    await fixture.http.inject({
      method: 'DELETE',
      url: `${tokensUrl(t.name)}/${anchorId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    const second = await listAt(t.name, token, `limit=1&cursor=${encodeURIComponent(first.next)}`);
    expect(second.items.map((item) => item.id)).toEqual([sortedIds[1]]);
  });

  it('refuses an invalid cursor with 400', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);

    const res = await fixture.http.inject({
      method: 'GET',
      url: `${tokensUrl(t.name)}?cursor=not-a-real-cursor`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toBe('cursor is invalid or expired');
  });
});

describe('POST /admin/tenants/{t}/registration-tokens', () => {
  it('answers the token exactly once, and a following GET lists it without one', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);

    const mint = await fixture.http.inject({
      method: 'POST',
      url: tokensUrl(t.name),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { uses: 1, ttl_seconds: 3600 },
    });
    expect(mint.statusCode).toBe(201);
    const minted = mint.json<{
      id: string;
      token: string;
      remaining_uses: number;
      expires_at: string;
    }>();
    expect(typeof minted.token).toBe('string');
    expect(minted.remaining_uses).toBe(1);

    const list = await fixture.http.inject({
      method: 'GET',
      url: tokensUrl(t.name),
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.payload).not.toContain(minted.token);
    const body = list.json<{
      items: { id: string; remaining_uses: number; created_at: string; expires_at: string }[];
    }>();
    expect(body.items.map((item) => item.id)).toContain(minted.id);
  });

  it('mints a token that registers a client under the token policy', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    await setPolicy(t.name, 'token');
    const adminToken = await fixture.adminToken(t.name, ['manage-clients']);

    const mint = await fixture.http.inject({
      method: 'POST',
      url: tokensUrl(t.name),
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: { uses: 1, ttl_seconds: 3600 },
    });
    const minted = mint.json<{ token: string }>();

    const registered = await registerWithToken(t.name, minted.token);
    expect(registered.statusCode).toBe(201);
  });

  it.each([
    ['uses over int32', { uses: 2_147_483_648, ttl_seconds: 3600 }],
    ['ttl_seconds over a year', { uses: 1, ttl_seconds: 31_536_001 }],
    ['ttl_seconds under the minimum', { uses: 1, ttl_seconds: 59 }],
  ])('refuses %s with 400, not 500', async (_label, payload) => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);

    const res = await fixture.http.inject({
      method: 'POST',
      url: tokensUrl(t.name),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload,
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /admin/tenants/{t}/registration-tokens/{id}', () => {
  it('refuses further registration with a revoked token', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    await setPolicy(t.name, 'token');
    const adminToken = await fixture.adminToken(t.name, ['manage-clients']);

    const mint = await fixture.http.inject({
      method: 'POST',
      url: tokensUrl(t.name),
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: { uses: 1, ttl_seconds: 3600 },
    });
    const minted = mint.json<{ id: string; token: string }>();

    const revoke = await fixture.http.inject({
      method: 'DELETE',
      url: `${tokensUrl(t.name)}/${minted.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(revoke.statusCode).toBe(204);

    const registered = await registerWithToken(t.name, minted.token);
    expect(registered.statusCode).toBe(401);
  });

  it('answers 404 for an id that names no token', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const adminToken = await fixture.adminToken(t.name, ['manage-clients']);

    const revoke = await fixture.http.inject({
      method: 'DELETE',
      url: `${tokensUrl(t.name)}/${newId()}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(revoke.statusCode).toBe(404);
  });

  // `GET` never lists a token already spent to zero uses or expired — a
  // `DELETE` of one answers the same `404` an unknown id does, rather than
  // a `204` for a row nothing in this API still shows the caller.
  it('answers 404 for a token already spent to zero uses', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    await setPolicy(t.name, 'token');
    const adminToken = await fixture.adminToken(t.name, ['manage-clients']);

    const mint = await fixture.http.inject({
      method: 'POST',
      url: tokensUrl(t.name),
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: { uses: 1, ttl_seconds: 3600 },
    });
    const minted = mint.json<{ id: string; token: string }>();
    const registered = await registerWithToken(t.name, minted.token);
    if (registered.statusCode !== 201) {
      throw new Error(
        `expected registration to spend the token, got ${String(registered.statusCode)}`,
      );
    }

    const revoke = await fixture.http.inject({
      method: 'DELETE',
      url: `${tokensUrl(t.name)}/${minted.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(revoke.statusCode).toBe(404);
  });
});

// Same seam keys.int.test.ts's own `audit` describe drives — pinned directly
// here so a mutation's exactly-once call, and the shape of what it records,
// do not depend on going through HTTP or a live audit query.
describe('audit', () => {
  function collector(): {
    events: RegistrationTokenAuditEvent[];
    audit: (tx: TenantScopedDatabase, e: RegistrationTokenAuditEvent) => Promise<void>;
  } {
    const events: RegistrationTokenAuditEvent[] = [];
    return {
      events,
      audit: (_tx, event) => {
        events.push(event);
        return Promise.resolve();
      },
    };
  }

  it('records uses and ttl_seconds on mint, and never the token', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { events, audit } = collector();

    const { minted } = await withTenant(fixture.app.db, t.id, (tx) =>
      mintRegistrationToken(
        tx,
        { audit },
        {
          tenantId: t.id,
          uses: 3,
          ttlSeconds: 600,
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe('registration_token.mint');
    expect(events[0]?.detail).toEqual({ uses: 3, ttl_seconds: 600 });
    expect(JSON.stringify(events[0]?.detail)).not.toContain(minted.token);
  });

  it('calls audit exactly once on a successful revoke, and not on not_found', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const minted = await withTenant(fixture.app.db, t.id, (tx) =>
      clientRegistrationTokenRepository(tx).mint({ tenantId: t.id, uses: 1, ttlSeconds: 3600 }),
    );

    const ok = collector();
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      revokeRegistrationToken(
        tx,
        { audit: ok.audit },
        {
          tokenId: minted.id,
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('deleted');
    expect(ok.events).toHaveLength(1);
    expect(ok.events[0]?.action).toBe('registration_token.revoke');
    expect(JSON.stringify(ok.events[0]?.detail)).not.toContain(minted.token);

    const refused = collector();
    const notFound = await withTenant(fixture.app.db, t.id, (tx) =>
      revokeRegistrationToken(
        tx,
        { audit: refused.audit },
        {
          tokenId: newId(),
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(notFound.kind).toBe('not_found');
    expect(refused.events).toHaveLength(0);
  });
});
