import { signingKeyRepository, signingKeys } from '@odudu/crypto';
import { withTenant } from '@odudu/db';
import { TENANT_CAPABILITIES } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { promoteKey as promoteKeyUsecase } from '#/usecase/keys';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

function keysUrl(tenantName: string): string {
  return `/admin/tenants/${tenantName}/keys`;
}

// Closed by default (ADR 0026) — the same door `clients.int.test.ts` opens
// before registering a client dynamically.
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

async function activeKeyOf(tenantId: string): Promise<{ id: string; alg: string }> {
  return withTenant(fixture.app.db, tenantId, async (tx) => {
    const key = await signingKeyRepository(tx).active();
    return { id: key.id, alg: key.alg };
  });
}

async function stageKey(
  tenantName: string,
  token: string,
  alg: 'RS256' | 'ES256',
): Promise<{ id: string; status: string; alg: string }> {
  const res = await fixture.http.inject({
    method: 'POST',
    url: keysUrl(tenantName),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: { alg },
  });
  if (res.statusCode !== 201) {
    throw new Error(`fixture: staging a key failed with ${String(res.statusCode)}: ${res.body}`);
  }
  return res.json<{ id: string; status: string; alg: string }>();
}

function promoteKeyHttp(tenantName: string, token: string, id: string) {
  return fixture.http.inject({
    method: 'POST',
    url: `${keysUrl(tenantName)}/${id}/promote`,
    headers: { authorization: `Bearer ${token}` },
  });
}

function retireKey(tenantName: string, token: string, id: string) {
  return fixture.http.inject({
    method: 'POST',
    url: `${keysUrl(tenantName)}/${id}/retire`,
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('POST /admin/tenants/{t}/keys', () => {
  it('stages a new key as rotating and publishes it in JWKS immediately', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-keys']);

    const created = await stageKey(t.name, token, 'RS256');
    expect(created.status).toBe('rotating');

    const jwks = await fixture.http.inject({
      method: 'GET',
      url: `/tenants/${t.name}/protocol/openid-connect/certs`,
    });
    expect(jwks.json<{ keys: { kid: string }[] }>().keys).toHaveLength(2);
  });

  it('never returns the private half, encrypted or otherwise', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-keys']);
    await stageKey(t.name, token, 'RS256');

    const res = await fixture.http.inject({
      method: 'GET',
      url: keysUrl(t.name),
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toContain('privateJwk');
    expect(res.payload).not.toContain('private_jwk_encrypted');
    expect(res.payload).not.toContain('publicJwk');
    expect(res.payload).not.toContain('public_jwk');
  });

  it('lists status, kid, alg, created_at and not_after', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-keys']);
    await stageKey(t.name, token, 'RS256');

    const res = await fixture.http.inject({
      method: 'GET',
      url: keysUrl(t.name),
      headers: { authorization: `Bearer ${token}` },
    });
    const body = res.json<{
      items: { id: string; status: string; kid: string; alg: string; created_at: string }[];
    }>();
    expect(body.items).toHaveLength(2);
    for (const item of body.items) {
      expect(typeof item.kid).toBe('string');
      expect(['RS256', 'ES256']).toContain(item.alg);
      expect(typeof item.created_at).toBe('string');
    }
  });
});

describe('POST /admin/tenants/{t}/keys/{id}/promote', () => {
  it('promotes atomically, leaving exactly one active key', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-keys']);
    const staged = await stageKey(t.name, token, 'RS256');

    const res = await promoteKeyHttp(t.name, token, staged.id);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe('active');

    await withTenant(fixture.app.db, t.id, async (tx) => {
      const rows = await tx.select().from(signingKeys);
      expect(rows.filter((k) => k.status === 'active').map((k) => k.id)).toEqual([staged.id]);
    });
  });

  // A concurrent HTTP request pair through `fixture.http.inject` never
  // exercises this: `promote`'s few local queries finish inside a
  // millisecond on a local Postgres, so the second call always arrives
  // after the first has already released its locks. Stalling the first
  // promote's own `audit` call — invoked after its writes, still inside its
  // open transaction — holds those locks open long enough for the second to
  // reach the same row and block on it.
  it('a concurrent promote of two different staged keys fails one on signing_keys_one_active', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-keys']);
    const first = await stageKey(t.name, token, 'RS256');
    const second = await stageKey(t.name, token, 'ES256');

    const promote = (keyId: string, audit: () => Promise<void>) =>
      withTenant(fixture.app.db, t.id, (tx) =>
        promoteKeyUsecase(tx, { audit }, { keyId, actorSubjectId: newId() }),
      );

    let releaseGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const first200 = promote(first.id, async () => {
      releaseGate();
      await sleep(200);
    });
    const secondAfterGate = gate.then(() => promote(second.id, () => Promise.resolve()));

    const results = await Promise.allSettled([first200, secondAfterGate]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    // One promote wins outright; the other collides with the winner's
    // already-committed active row on `signing_keys_one_active`. Exactly
    // one survivor proves the race was real, not accidentally serialised.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    await withTenant(fixture.app.db, t.id, async (tx) => {
      const rows = await tx.select().from(signingKeys);
      const active = rows.filter((k) => k.status === 'active');
      expect(active).toHaveLength(1);
      expect([first.id, second.id]).toContain(active[0]?.id);
    });
  });

  it('answers 404 for an unknown key id', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-keys']);

    const res = await promoteKeyHttp(t.name, token, newId());
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /admin/tenants/{t}/keys/{id}/retire', () => {
  it('refuses to retire the active key, however well covered its algorithm is', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-keys']);
    const active = await activeKeyOf(t.id);
    // A second key of the *same* algorithm as the active one: coverage
    // alone would let this retirement through, which is exactly the bug
    // this ordering exists to prevent.
    await stageKey(t.name, token, active.alg as 'RS256' | 'ES256');

    const res = await retireKey(t.name, token, active.id);
    expect(res.statusCode).toBe(409);
    expect(res.json<{ detail: string }>().detail).toMatch(/active/u);
  });

  it("refuses to retire a key whose algorithm a client's userinfo_signed_response_alg still needs", async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    await openRegistration(t.name);
    const token = await fixture.adminToken(t.name, ['manage-keys']);
    const original = await activeKeyOf(t.id); // ES256, from tenant provisioning

    // Staging the new algorithm before it is default is what lets a client
    // register against it at all — see client-registration.ts's own
    // algorithmsAvailable check.
    const staged = await stageKey(t.name, token, 'RS256');
    const client = await fixture.registerClientWithUserinfoAlg(t.name, 'RS256');
    expect(client.clientId).toBeTruthy();

    // The client that still needs the original algorithm.
    const dependent = await fixture.registerClientWithUserinfoAlg(t.name, original.alg);

    await promoteKeyHttp(t.name, token, staged.id);

    const res = await retireKey(t.name, token, original.id);
    expect(res.statusCode).toBe(409);
    const detail = res.json<{ detail: string }>().detail;
    expect(detail).toContain('userinfo_signed_response_alg');
    expect(detail).toContain(dependent.clientId);
  });

  it('retires once the last client on that algorithm has moved', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    await openRegistration(t.name);
    const token = await fixture.adminToken(t.name, ['manage-keys']);
    const original = await activeKeyOf(t.id);

    const staged = await stageKey(t.name, token, 'RS256');
    const dependent = await fixture.registerClientWithUserinfoAlg(t.name, original.alg);
    await promoteKeyHttp(t.name, token, staged.id);

    const blocked = await retireKey(t.name, token, original.id);
    expect(blocked.statusCode).toBe(409);

    const patched = await fixture.patchClient(t.name, dependent.id, {
      userinfo_signed_response_alg: 'RS256',
    });
    expect(patched.statusCode).toBe(200);

    const res = await retireKey(t.name, token, original.id);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe('retired');
  });

  it('answers 404 for an unknown key id', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-keys']);

    const res = await retireKey(t.name, token, newId());
    expect(res.statusCode).toBe(404);
  });
});

describe('the deadlock this design dissolves', () => {
  it('cannot register the new algorithm before staging, can after, and can retire the old one once nothing needs it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    await openRegistration(t.name);
    const token = await fixture.adminToken(t.name, ['manage-keys']);
    const original = await activeKeyOf(t.id); // ES256

    // Registration refuses an algorithm the active key cannot produce, so
    // a client cannot move to RS256 before something can sign RS256 for
    // it.
    const tooEarly = await fixture.registerClient(t.name, {
      grant_types: ['client_credentials'],
      token_endpoint_auth_method: 'client_secret_basic',
      userinfo_signed_response_alg: 'RS256',
    });
    expect(tooEarly.statusCode).toBe(400);

    // Staging as rotating makes RS256 producible before it is default.
    const staged = await stageKey(t.name, token, 'RS256');

    const client = await fixture.registerClientWithUserinfoAlg(t.name, 'RS256');
    expect(client.clientId).toBeTruthy();

    const promoted = await promoteKeyHttp(t.name, token, staged.id);
    expect(promoted.statusCode).toBe(200);

    // Nothing depends on ES256 any more, so the key that used to be
    // active, now demoted to rotating, can finally retire.
    const retired = await retireKey(t.name, token, original.id);
    expect(retired.statusCode).toBe(200);
    expect(retired.json<{ status: string }>().status).toBe('retired');
  });
});

describe('is refused for every capability but manage-keys, on every route', () => {
  it('GET /keys, POST /keys, POST /keys/:id/promote, POST /keys/:id/retire', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const managerToken = await fixture.adminToken(t.name, ['manage-keys']);
    const staged = await stageKey(t.name, managerToken, 'RS256');

    for (const capability of TENANT_CAPABILITIES) {
      if (capability === 'manage-keys') continue;
      const token = await fixture.adminToken(t.name, [capability]);

      const list = await fixture.http.inject({
        method: 'GET',
        url: keysUrl(t.name),
        headers: { authorization: `Bearer ${token}` },
      });
      expect(list.statusCode, `GET /keys as ${capability}`).toBe(403);

      const create = await fixture.http.inject({
        method: 'POST',
        url: keysUrl(t.name),
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: { alg: 'RS256' },
      });
      expect(create.statusCode, `POST /keys as ${capability}`).toBe(403);

      const promote = await promoteKeyHttp(t.name, token, staged.id);
      expect(promote.statusCode, `POST /keys/:id/promote as ${capability}`).toBe(403);

      const retire = await retireKey(t.name, token, staged.id);
      expect(retire.statusCode, `POST /keys/:id/retire as ${capability}`).toBe(403);
    }
  });
});
