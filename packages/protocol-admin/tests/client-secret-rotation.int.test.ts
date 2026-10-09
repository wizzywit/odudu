import { tenants, withTenant } from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { auditRepository } from '@odudu/domain-audit';
import { clientRepository } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture, type TestClient } from '#/testing/admin-fixture';
import { expireRotatedClientSecrets } from '#/usecase/client-secret-expiry';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});
afterEach(() => {
  fixture.clock.set(new Date());
});

interface Rotated {
  readonly status: number;
  readonly secret: string;
  readonly body: Record<string, unknown>;
}

async function rotate(
  tenantName: string,
  client: TestClient,
  graceSeconds?: number | string,
): Promise<Rotated> {
  const token = await fixture.adminToken(tenantName, ['manage-clients']);
  const query = graceSeconds === undefined ? '' : `?grace_seconds=${String(graceSeconds)}`;
  const res = await fixture.http.inject({
    method: 'POST',
    url: `/admin/tenants/${tenantName}/clients/${client.id}/secret${query}`,
    headers: { authorization: `Bearer ${token}` },
  });
  const body = res.json<Record<string, unknown>>();
  return {
    status: res.statusCode,
    secret: typeof body.client_secret === 'string' ? body.client_secret : '',
    body,
  };
}

function tokenWith(
  tenantName: string,
  client: TestClient,
  secret: string,
): Promise<LightMyRequestResponse> {
  return fixture.tokenRequest(
    tenantName,
    { ...client, secret },
    {
      grant_type: 'client_credentials',
    },
  );
}

async function serviceClient(): Promise<{
  tenant: { id: string; name: string };
  client: TestClient;
}> {
  const tenant = await fixture.createTenant(`rot-${newId()}`);
  const client = await fixture.createConfidentialClient(tenant.name, {
    grantTypes: ['client_credentials'],
    redirectUris: [],
  });
  return { tenant, client };
}

describe('POST /clients/{id}/secret with a grace period', () => {
  it('ends the previous secret at once when no grace is asked for', async () => {
    const { tenant, client } = await serviceClient();
    const rotated = await rotate(tenant.name, client);
    expect(rotated.status).toBe(200);
    expect(rotated.body.previous_secret_expires_at).toBeNull();
    expect((await tokenWith(tenant.name, client, client.secret)).statusCode).toBe(401);
    expect((await tokenWith(tenant.name, client, rotated.secret)).statusCode).toBe(200);
  });

  it('authenticates both secrets through the window, and only the new one after it', async () => {
    const { tenant, client } = await serviceClient();
    fixture.clock.set(new Date());
    const rotated = await rotate(tenant.name, client, 3600);
    expect(rotated.status).toBe(200);
    const expiresAt = new Date(fixture.clock.now().getTime() + 3600 * 1000).toISOString();
    expect(rotated.body.previous_secret_expires_at).toBe(expiresAt);

    expect((await tokenWith(tenant.name, client, client.secret)).statusCode).toBe(200);
    expect((await tokenWith(tenant.name, client, rotated.secret)).statusCode).toBe(200);

    fixture.clock.advance(3600 * 1000);
    expect((await tokenWith(tenant.name, client, client.secret)).statusCode).toBe(401);
    expect((await tokenWith(tenant.name, client, rotated.secret)).statusCode).toBe(200);
  });

  it('accepts the longest window, a week', async () => {
    const { tenant, client } = await serviceClient();
    const rotated = await rotate(tenant.name, client, 604_800);
    expect(rotated.status).toBe(200);
    expect((await tokenWith(tenant.name, client, client.secret)).statusCode).toBe(200);
  });

  it('keeps only the secret it replaced when rotated again inside a window', async () => {
    const { tenant, client } = await serviceClient();
    const first = await rotate(tenant.name, client, 3600);
    const second = await rotate(tenant.name, client, 600);

    expect((await tokenWith(tenant.name, client, client.secret)).statusCode).toBe(401);
    expect((await tokenWith(tenant.name, client, first.secret)).statusCode).toBe(200);
    expect((await tokenWith(tenant.name, client, second.secret)).statusCode).toBe(200);
  });

  it.each([-1, 604_801, 1.5, 'soon'])('refuses grace_seconds %s', async (grace) => {
    const { tenant, client } = await serviceClient();
    const rotated = await rotate(tenant.name, client, grace);
    expect(rotated.status).toBe(400);
    expect((await tokenWith(tenant.name, client, client.secret)).statusCode).toBe(200);
  });

  it('shows neither secret on a read, only when the previous one stops working', async () => {
    const { tenant, client } = await serviceClient();
    const rotated = await rotate(tenant.name, client, 60);
    const token = await fixture.adminToken(tenant.name, ['manage-clients']);
    const read = await fixture.http.inject({
      url: `/admin/tenants/${tenant.name}/clients/${client.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(read.json()).toMatchObject({
      previous_secret_expires_at: rotated.body.previous_secret_expires_at,
    });
    expect(read.body).not.toContain(rotated.secret);
    expect(read.body).not.toContain(client.secret);
    expect(read.body).not.toContain('secret_hash');
  });

  it('audits the rotation with its window, and never a secret', async () => {
    const { tenant, client } = await serviceClient();
    const rotated = await rotate(tenant.name, client, 120);
    const rows = await withTenant(fixture.app.db, tenant.id, (tx) =>
      auditRepository(tx).list({ action: 'client.rotate_secret', resourceId: client.id, limit: 5 }),
    );
    expect(rows[0]?.detail).toMatchObject({
      grace_seconds: 120,
      previous_secret_expires_at: rotated.body.previous_secret_expires_at,
    });
    expect(JSON.stringify(rows[0]?.detail)).not.toContain(rotated.secret);
    expect(JSON.stringify(rows[0]?.detail)).not.toContain(client.secret);
  });
});

describe('expireRotatedClientSecrets', () => {
  it('clears a previous secret once its window has ended, and audits the expiry', async () => {
    const { tenant, client } = await serviceClient();
    fixture.clock.set(new Date());
    await rotate(tenant.name, client, 60);
    const issuedAt = fixture.clock.now();

    const early = await withTenant(fixture.app.db, tenant.id, (tx) =>
      expireRotatedClientSecrets(tx, new Date(issuedAt.getTime() + 59_000)),
    );
    expect(early).toBe(0);

    const later = new Date(issuedAt.getTime() + 61_000);
    const cleared = await withTenant(fixture.app.db, tenant.id, (tx) =>
      expireRotatedClientSecrets(tx, later),
    );
    expect(cleared).toBe(1);

    const row = await withTenant(fixture.app.db, tenant.id, (tx) =>
      clientRepository(tx).byId(client.id),
    );
    expect(row?.previousSecretHash).toBeNull();
    expect(row?.previousSecretExpiresAt).toBeNull();
    const rows = await withTenant(fixture.app.db, tenant.id, (tx) =>
      auditRepository(tx).list({
        action: 'client.secret_expired',
        resourceId: client.id,
        limit: 5,
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'allowed', actorSubjectId: null });
  });

  it('cannot clear another tenant’s previous secret', async () => {
    await expectCrossTenantMethodProbe(fixture.app.db, {
      seed: async (tx, tenantId) => {
        await tx.insert(tenants).values({ id: tenantId, name: `probe-${tenantId.slice(-12)}` });
        const created = await clientRepository(tx).create({
          tenantId,
          clientId: `probe-${newId()}`,
          name: 'probe',
          type: 'confidential',
          secretHash: 'current',
        });
        await clientRepository(tx).rotateSecret(created.id, 'next', {
          hash: 'current',
          expiresAt: new Date(Date.now() - 1000),
        });
        return created.id;
      },
      verifySeeded: async (tx, id) => {
        expect((await clientRepository(tx).byId(id))?.previousSecretHash).toBe('current');
      },
      attempt: async (tx) => clientRepository(tx).clearExpiredPreviousSecrets(new Date()),
      expectBlocked: (result) => {
        expect(result).toEqual([]);
      },
      verifyTenantAUnaffected: async (tx, id) => {
        expect((await clientRepository(tx).byId(id))?.previousSecretHash).toBe('current');
      },
    });
  });
});
