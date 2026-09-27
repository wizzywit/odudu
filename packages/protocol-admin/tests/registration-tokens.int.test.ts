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

    const minted = await withTenant(fixture.app.db, t.id, (tx) =>
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
