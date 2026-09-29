import { generateSigningKey, signingKeyRepository, signingKeys } from '@odudu/crypto';
import { tenants, withTenant, type TenantScopedDatabase } from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { auditRepository } from '@odudu/domain-audit';
import { clientRepository } from '@odudu/domain-tenant';
import { emailOutbox } from '@odudu/email';
import { newId } from '@odudu/kernel';
import { backchannelLogoutDeliveries, BACKCHANNEL_LOGOUT_MAX_ATTEMPTS } from '@odudu/protocol-oidc';
import { eq } from 'drizzle-orm';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { deleteKey } from '#/usecase/keys';
import { listLogoutDeliveries } from '#/usecase/logout-deliveries';
import { listMail } from '#/usecase/mail';

const CURSOR_KEY = Buffer.alloc(32, 7);
const KEK = Buffer.alloc(32, 7);

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

function get(tenantName: string, token: string, tail: string): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenantName}/${tail}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

async function queueMail(
  tx: TenantScopedDatabase,
  tenantId: string,
  to: string,
  state: { createdAt: Date; attempts?: number; lastError?: string | null; sentAt?: Date | null },
): Promise<string> {
  const id = newId();
  await tx.insert(emailOutbox).values({
    id,
    tenantId,
    toAddress: to,
    subject: 'Reset your password',
    bodyText: 'follow https://idp.example/tenants/x/login-actions/action-token?key=SECRET',
    bodyHtml: '<a href="https://idp.example/?key=SECRET">reset</a>',
    createdAt: state.createdAt,
    nextAttemptAt: state.createdAt,
    attempts: state.attempts ?? 0,
    lastError: state.lastError ?? null,
    sentAt: state.sentAt ?? null,
  });
  return id;
}

interface MailItem {
  id: string;
  to: string;
  to_masked: boolean;
  status: string;
  attempts: number;
  last_error: string | null;
}

describe('GET /mail', () => {
  it('lists the outbox most recent first, with its status and never its body', async () => {
    const t = await fixture.createTenant(`mail-${newId()}`);
    const base = fixture.clock.now().getTime();
    const ids = await withTenant(fixture.app.db, t.id, async (tx) => ({
      sent: await queueMail(tx, t.id, 'ada@example.com', {
        createdAt: new Date(base - 4000),
        attempts: 1,
        sentAt: new Date(base - 3000),
      }),
      failed: await queueMail(tx, t.id, 'bob@example.com', {
        createdAt: new Date(base - 3000),
        attempts: 5,
        lastError: '550 5.1.1 <bob@example.com>: user unknown',
      }),
      retrying: await queueMail(tx, t.id, 'cy@example.com', {
        createdAt: new Date(base - 2000),
        attempts: 1,
        lastError: 'connection refused',
      }),
      queued: await queueMail(tx, t.id, 'di@example.com', { createdAt: new Date(base - 1000) }),
    }));
    const token = await fixture.adminToken(t.name, ['manage-tenant', 'view-users']);

    const res = await get(t.name, token, 'mail');
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('SECRET');
    const items = res.json<{ items: MailItem[] }>().items;
    expect(items.map((item) => item.id)).toEqual([ids.queued, ids.retrying, ids.failed, ids.sent]);
    expect(items.map((item) => item.status)).toEqual(['queued', 'retrying', 'failed', 'sent']);
    expect(items[2]).toMatchObject({ to: 'bob@example.com', to_masked: false, attempts: 5 });

    const failed = await get(t.name, token, 'mail?status=failed');
    expect(failed.json<{ items: MailItem[] }>().items.map((item) => item.id)).toEqual([ids.failed]);

    const page = await get(t.name, token, 'mail?limit=2');
    const next = page.json<{ next: string }>().next;
    const rest = await get(t.name, token, `mail?limit=2&cursor=${encodeURIComponent(next)}`);
    expect(rest.json<{ items: MailItem[] }>().items.map((item) => item.id)).toEqual([
      ids.failed,
      ids.sent,
    ]);
  });

  it('masks the recipient, wherever it appears, for a caller who cannot read subjects', async () => {
    const t = await fixture.createTenant(`mail-${newId()}`);
    await withTenant(fixture.app.db, t.id, (tx) =>
      queueMail(tx, t.id, 'bob@example.com', {
        createdAt: fixture.clock.now(),
        attempts: 1,
        lastError: '550 5.1.1 <bob@example.com>: user unknown',
      }),
    );
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await get(t.name, token, 'mail');
    expect(res.body).not.toContain('bob@example.com');
    expect(res.json<{ items: MailItem[] }>().items[0]).toMatchObject({
      to: 'b***@example.com',
      to_masked: true,
      last_error: '550 5.1.1 <b***@example.com>: user unknown',
    });
  });

  it('is refused without manage-tenant', async () => {
    const t = await fixture.createTenant(`mail-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);
    expect((await get(t.name, token, 'mail')).statusCode).toBe(403);
  });

  it('lists nothing across tenants, probed with a foreign tenant_id', async () => {
    await expectCrossTenantMethodProbe(fixture.app.db, {
      seed: async (tx, tenantId) => {
        await tx.insert(tenants).values({ id: tenantId, name: `probe-${newId()}` });
        await queueMail(tx, tenantId, 'ada@example.com', { createdAt: new Date() });
      },
      verifySeeded: async (tx) => {
        expect(await tx.select().from(emailOutbox)).toHaveLength(1);
      },
      attempt: (tx) =>
        listMail(tx, {
          tenantId: newId(),
          revealRecipients: true,
          maxAttempts: 5,
          limit: 50,
          cursor: undefined,
          cursorKey: CURSOR_KEY,
        }),
      expectBlocked: (result) => {
        expect(result).toEqual({ kind: 'ok', items: [], next: null });
      },
    });
  });
});

async function queueDelivery(
  tx: TenantScopedDatabase,
  tenantId: string,
  clientId: string,
  state: { createdAt: Date; attempts?: number; lastError?: string; deliveredAt?: Date },
): Promise<string> {
  const id = newId();
  await tx.insert(backchannelLogoutDeliveries).values({
    id,
    tenantId,
    clientId,
    sessionId: newId(),
    endpoint: 'https://rp.example/backchannel',
    logoutToken: 'eyJ.SECRET-LOGOUT-TOKEN.sig',
    createdAt: state.createdAt,
    nextAttemptAt: state.createdAt,
    attempts: state.attempts ?? 0,
    lastError: state.lastError ?? null,
    deliveredAt: state.deliveredAt ?? null,
  });
  return id;
}

describe('GET /clients/:id/logout-deliveries', () => {
  it('lists the client’s deliveries most recent first, never the Logout Token', async () => {
    const t = await fixture.createTenant(`bcl-${newId()}`);
    const client = await fixture.createConfidentialClient(t.name, {});
    const other = await fixture.createConfidentialClient(t.name, {});
    const base = fixture.clock.now().getTime();
    const ids = await withTenant(fixture.app.db, t.id, async (tx) => {
      await queueDelivery(tx, t.id, other.id, { createdAt: new Date(base) });
      return {
        delivered: await queueDelivery(tx, t.id, client.id, {
          createdAt: new Date(base - 3000),
          attempts: 1,
          deliveredAt: new Date(base - 2000),
        }),
        failed: await queueDelivery(tx, t.id, client.id, {
          createdAt: new Date(base - 2000),
          attempts: BACKCHANNEL_LOGOUT_MAX_ATTEMPTS,
          lastError: 'HTTP 500',
        }),
        pending: await queueDelivery(tx, t.id, client.id, {
          createdAt: new Date(base - 1000),
          attempts: 1,
          lastError: 'timeout',
        }),
      };
    });
    const token = await fixture.adminToken(t.name, ['manage-clients']);

    const res = await get(t.name, token, `clients/${client.id}/logout-deliveries`);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('SECRET-LOGOUT-TOKEN');
    const items = res.json<{ items: { id: string; status: string }[] }>().items;
    expect(items.map((item) => [item.id, item.status])).toEqual([
      [ids.pending, 'pending'],
      [ids.failed, 'failed'],
      [ids.delivered, 'delivered'],
    ]);
    const failed = await get(t.name, token, `clients/${client.id}/logout-deliveries?status=failed`);
    expect(failed.json<{ items: { id: string }[] }>().items.map((item) => item.id)).toEqual([
      ids.failed,
    ]);
    expect((await get(t.name, token, `clients/${newId()}/logout-deliveries`)).statusCode).toBe(404);
  });

  it('lists nothing across tenants, probed with a foreign tenant_id', async () => {
    await expectCrossTenantMethodProbe(fixture.app.db, {
      seed: async (tx, tenantId) => {
        await tx.insert(tenants).values({ id: tenantId, name: `probe-${newId()}` });
        const client = await clientRepository(tx).create({
          tenantId,
          clientId: `rp-${newId()}`,
          name: 'Relying party',
          type: 'public',
          secretHash: null,
        });
        await queueDelivery(tx, tenantId, client.id, { createdAt: new Date() });
        return client.id;
      },
      verifySeeded: async (tx) => {
        expect(await tx.select().from(backchannelLogoutDeliveries)).toHaveLength(1);
      },
      attempt: (tx, clientId) =>
        listLogoutDeliveries(tx, {
          tenantId: newId(),
          clientDbId: clientId,
          limit: 50,
          cursor: undefined,
          cursorKey: CURSOR_KEY,
        }),
      expectBlocked: (result) => {
        expect(result).toEqual({ kind: 'not_found' });
      },
    });
  });
});

async function stageKey(tenantId: string, status: 'rotating' | 'retired'): Promise<string> {
  return withTenant(fixture.app.db, tenantId, async (tx) => {
    const generated = await generateSigningKey('ES256', KEK);
    const created = await signingKeyRepository(tx).create({
      id: newId(),
      tenantId,
      kid: generated.kid,
      alg: generated.alg,
      status,
      publicJwk: generated.publicJwk,
      privateJwkEncrypted: generated.privateJwkEncrypted,
    });
    return created.id;
  });
}

describe('DELETE /keys/:id', () => {
  it('deletes a retired key and audits it, and refuses one that is not retired', async () => {
    const t = await fixture.createTenant(`keys-${newId()}`);
    const retired = await stageKey(t.id, 'retired');
    const rotating = await stageKey(t.id, 'rotating');
    const token = await fixture.adminToken(t.name, ['manage-keys']);
    const remove = (id: string) =>
      fixture.http.inject({
        method: 'DELETE',
        url: `/admin/tenants/${t.name}/keys/${id}`,
        headers: { authorization: `Bearer ${token}` },
      });

    expect((await remove(retired)).statusCode).toBe(204);
    const refused = await remove(rotating);
    expect(refused.statusCode).toBe(409);
    expect((await remove(newId())).statusCode).toBe(404);

    await withTenant(fixture.app.db, t.id, async (tx) => {
      const left = await tx.select({ id: signingKeys.id }).from(signingKeys);
      expect(left.map((row) => row.id)).not.toContain(retired);
      expect(left.map((row) => row.id)).toContain(rotating);
      const rows = await auditRepository(tx).list({ action: 'key.delete', limit: 5 });
      expect(rows.map((row) => row.resourceId)).toEqual([retired]);
    });
  });

  it('deletes nothing across tenants, probed with a foreign tenant_id', async () => {
    await expectCrossTenantMethodProbe(fixture.app.db, {
      seed: async (tx, tenantId) => {
        await tx.insert(tenants).values({ id: tenantId, name: `probe-${newId()}` });
        const generated = await generateSigningKey('ES256', KEK);
        return (
          await signingKeyRepository(tx).create({
            id: newId(),
            tenantId,
            kid: generated.kid,
            alg: generated.alg,
            status: 'retired',
            publicJwk: generated.publicJwk,
            privateJwkEncrypted: generated.privateJwkEncrypted,
          })
        ).id;
      },
      verifySeeded: async (tx, id) => {
        expect(await tx.select().from(signingKeys).where(eq(signingKeys.id, id))).toHaveLength(1);
      },
      attempt: (tx, id) =>
        deleteKey(
          tx,
          { audit: () => Promise.resolve() },
          {
            keyId: id,
            ifMatch: undefined,
            actorSubjectId: newId(),
            actorTenantId: newId(),
            actorClientId: newId(),
          },
        ),
      expectBlocked: (result) => {
        expect(result).toEqual({ kind: 'not_found' });
      },
      verifyTenantAUnaffected: async (tx, id) => {
        expect(await tx.select().from(signingKeys).where(eq(signingKeys.id, id))).toHaveLength(1);
      },
    });
  });
});

describe('GET /clients/:id/installation', () => {
  it('answers what a relying party is configured with, and never a secret', async () => {
    const t = await fixture.createTenant(`inst-${newId()}`);
    const client = await fixture.createConfidentialClient(t.name, {
      redirectUris: ['https://rp.example/callback'],
    });
    const token = await fixture.adminToken(t.name, ['manage-clients']);

    const res = await get(t.name, token, `clients/${client.id}/installation`);
    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body).toMatchObject({
      client_id: client.clientId,
      client_type: 'confidential',
      token_endpoint_auth_method: 'client_secret_basic',
      redirect_uris: ['https://rp.example/callback'],
    });
    const issuer = String(body.issuer);
    expect(issuer).toMatch(new RegExp(`/tenants/${t.name}$`, 'u'));
    expect(body.discovery_url).toBe(`${issuer}/.well-known/openid-configuration`);
    expect(res.body).not.toContain(client.secret);
    expect((await get(t.name, token, `clients/${newId()}/installation`)).statusCode).toBe(404);
  });
});
