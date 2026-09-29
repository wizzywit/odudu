import { SessionEntry, sessionRepository, sessions } from '@odudu/authn-flows';
import { tenants, withTenant, type TenantScopedDatabase } from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { auditRepository } from '@odudu/domain-audit';
import { roleRepository } from '@odudu/domain-authz';
import { hashPassword, subjectRepository, userRepository } from '@odudu/domain-identity';
import {
  ADMIN_CLIENT_ID,
  clientRepository,
  MANAGE_TENANTS,
  TENANT_CAPABILITIES,
  provisionClientDefaults,
  TENANT_ADMIN,
  type ClientRecord,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import {
  clientOidcConfigRepository,
  logoutDeliveryRepository,
  refreshTokens,
  tokenGrantRepository,
} from '@odudu/protocol-oidc';
import { eq } from 'drizzle-orm';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import {
  listSubjectGrants,
  revokeClientGrants,
  revokeSubjectGrants,
  type Audit,
} from '#/usecase/grants';
import {
  countTenantSessions,
  endTenantSessions,
  listTenantSessions,
} from '#/usecase/tenant-sessions';

const LIFESPANS = {
  ssoSessionIdleSeconds: 1800,
  ssoSessionMaxSeconds: 36_000,
  rememberMeIdleSeconds: 604_800,
  rememberMeMaxSeconds: 2_592_000,
};
const CURSOR_KEY = Buffer.alloc(32, 7);
const EVERY_CAPABILITY: ReadonlySet<string> = new Set([...TENANT_CAPABILITIES, MANAGE_TENANTS]);

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

async function seedClient(tx: TenantScopedDatabase, tenantId: string): Promise<ClientRecord> {
  const serviceSubject = await subjectRepository(tx).create({ tenantId, type: 'service' });
  const client = await clientRepository(tx).create({
    tenantId,
    clientId: `rp-${newId()}`,
    name: 'Relying party',
    type: 'confidential',
    secretHash: await hashPassword('unused-secret'),
    serviceSubjectId: serviceSubject.id,
  });
  await provisionClientDefaults(tx, client.id);
  await clientOidcConfigRepository(tx).create({
    clientId: client.id,
    tenantId,
    redirectUris: [`https://${client.clientId}/callback`],
    grantTypes: ['authorization_code'],
    tokenEndpointAuthMethod: 'client_secret_basic',
    audiences: [],
    accessTokenTtlSeconds: 300,
    refreshTokenTtlSeconds: 1_209_600,
    backchannelLogoutUri: `https://${client.clientId}/backchannel`,
  });
  return client;
}

async function seedUser(tenantId: string, username: string): Promise<string> {
  return withTenant(fixture.app.db, tenantId, async (tx) => {
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await userRepository(tx).create({ subjectId: subject.id, tenantId, username, email: null });
    return subject.id;
  });
}

async function makeTenantAdmin(tenantId: string, subjectId: string): Promise<void> {
  await withTenant(fixture.app.db, tenantId, async (tx) => {
    const admin = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
    const role = await roleRepository(tx).byName(TENANT_ADMIN, admin?.id ?? '');
    if (role === null) throw new Error('no tenant-admin role');
    await roleRepository(tx).assignToSubject(subjectId, role.id);
  });
}

interface SeededSession {
  readonly sessionId: string;
  readonly grantId: string;
}

async function seedSession(
  tenantId: string,
  subjectId: string,
  client: ClientRecord,
  options: {
    lastActiveAt?: Date;
    remembered?: boolean;
    offlineGrant?: boolean;
    sessionless?: boolean;
  } = {},
): Promise<SeededSession> {
  return withTenant(fixture.app.db, tenantId, async (tx) => {
    const now = fixture.clock.now();
    const sessionId = newId();
    await sessionRepository(tx).create({
      id: sessionId,
      tenantId,
      subjectId,
      expiresAt: new Date(now.getTime() + 30 * 24 * 3_600_000),
      authenticators: ['pwd'],
      secretHash: SessionEntry.issue(sessionId).secretHash(),
      remembered: options.remembered ?? false,
    });
    if (options.lastActiveAt !== undefined) {
      await tx
        .update(sessions)
        .set({ lastActiveAt: options.lastActiveAt })
        .where(eq(sessions.id, sessionId));
    }
    const grantId = newId();
    await tokenGrantRepository(tx).create({
      id: grantId,
      tenantId,
      clientId: client.id,
      subjectId,
      scope: options.offlineGrant === true ? 'openid offline_access' : 'openid',
      audience: [],
      sessionId: options.offlineGrant === true || options.sessionless === true ? null : sessionId,
    });
    return { sessionId, grantId };
  });
}

function call(
  method: 'GET' | 'DELETE',
  tenantName: string,
  token: string,
  tail: string,
): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method,
    url: `/admin/tenants/${tenantName}/${tail}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('GET /sessions and GET /sessions/count', () => {
  it('lists every live session, naming its subject, and counts the same', async () => {
    const t = await fixture.createTenant(`ts-${newId()}`);
    const client = await withTenant(fixture.app.db, t.id, (tx) => seedClient(tx, t.id));
    const ada = await seedUser(t.id, 'ada');
    const bob = await seedUser(t.id, 'bob');
    const live = await seedSession(t.id, ada, client);
    const remembered = await seedSession(t.id, bob, client, {
      remembered: true,
      lastActiveAt: new Date(fixture.clock.now().getTime() - 3_600_000),
    });
    const idle = await seedSession(t.id, bob, client, {
      lastActiveAt: new Date(fixture.clock.now().getTime() - 3_600_000),
    });
    const token = await fixture.adminToken(t.name, ['manage-sessions']);

    const res = await call('GET', t.name, token, `sessions?client=${client.id}&limit=200`);
    expect(res.statusCode).toBe(200);
    const items = res.json<{
      items: { id: string; subject_id: string; username: string; client_ids: string[] }[];
    }>().items;
    expect(items.map((item) => item.id).sort()).toEqual(
      [live.sessionId, remembered.sessionId].sort(),
    );
    expect(items.find((item) => item.id === live.sessionId)).toMatchObject({
      subject_id: ada,
      username: 'ada',
      client_ids: [client.clientId],
    });
    expect(items.map((item) => item.id)).not.toContain(idle.sessionId);

    const count = await call('GET', t.name, token, `sessions/count?client=${client.id}`);
    expect(count.json()).toEqual({ count: 2, capped: false });
    const all = await call('GET', t.name, token, 'sessions/count');
    expect(all.json<{ count: number }>().count).toBeGreaterThanOrEqual(3);
  });

  it('pages by id', async () => {
    const t = await fixture.createTenant(`ts-${newId()}`);
    const client = await withTenant(fixture.app.db, t.id, (tx) => seedClient(tx, t.id));
    const ada = await seedUser(t.id, 'ada');
    const seeded = [
      (await seedSession(t.id, ada, client)).sessionId,
      (await seedSession(t.id, ada, client)).sessionId,
    ].sort();
    const token = await fixture.adminToken(t.name, ['manage-sessions']);

    const first = await call('GET', t.name, token, `sessions?client=${client.id}&limit=1`);
    const body = first.json<{ items: { id: string }[]; next: string }>();
    expect(body.items.map((item) => item.id)).toEqual([seeded[0]]);
    expect(first.headers.link).toContain(`client=${client.id}`);
    const second = await call(
      'GET',
      t.name,
      token,
      `sessions?client=${client.id}&limit=1&cursor=${encodeURIComponent(body.next)}`,
    );
    expect(second.json<{ items: { id: string }[] }>().items.map((item) => item.id)).toEqual([
      seeded[1],
    ]);
  });

  it('is refused without manage-sessions', async () => {
    const t = await fixture.createTenant(`ts-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    expect((await call('GET', t.name, token, 'sessions')).statusCode).toBe(403);
  });
});

describe('GET /clients/:id/sessions', () => {
  it('lists the sessions holding a grant through the client, and 404s an unknown one', async () => {
    const t = await fixture.createTenant(`ts-${newId()}`);
    const { client, other } = await withTenant(fixture.app.db, t.id, async (tx) => ({
      client: await seedClient(tx, t.id),
      other: await seedClient(tx, t.id),
    }));
    const ada = await seedUser(t.id, 'ada');
    const mine = await seedSession(t.id, ada, client);
    await seedSession(t.id, ada, other);
    const token = await fixture.adminToken(t.name, ['manage-sessions']);

    const res = await call('GET', t.name, token, `clients/${client.id}/sessions`);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ items: { id: string }[] }>().items.map((item) => item.id)).toEqual([
      mine.sessionId,
    ]);
    expect((await call('GET', t.name, token, `clients/${newId()}/sessions`)).statusCode).toBe(404);
  });
});

describe('DELETE /sessions', () => {
  it('ends every session within the caller’s ceiling, delivering logout, and counts the rest', async () => {
    const t = await fixture.createTenant(`ts-${newId()}`);
    const client = await withTenant(fixture.app.db, t.id, (tx) => seedClient(tx, t.id));
    const ada = await seedUser(t.id, 'ada');
    const root = await seedUser(t.id, 'root');
    await makeTenantAdmin(t.id, root);
    const plain = await seedSession(t.id, ada, client);
    const guarded = await seedSession(t.id, root, client);
    const token = await fixture.adminToken(t.name, ['manage-sessions']);

    const res = await call('DELETE', t.name, token, 'sessions');
    expect(res.statusCode).toBe(200);
    const body = res.json<{ ended: number; beyond_ceiling: number }>();
    expect(body.beyond_ceiling).toBe(1);
    expect(body.ended).toBeGreaterThanOrEqual(1);

    await withTenant(fixture.app.db, t.id, async (tx) => {
      const sessionsRepo = sessionRepository(tx);
      const now = fixture.clock.now();
      expect(await sessionsRepo.liveById(plain.sessionId, LIFESPANS, now)).toBeNull();
      expect(await sessionsRepo.liveById(guarded.sessionId, LIFESPANS, now)).not.toBeNull();
      const grant = await tokenGrantRepository(tx).byId(plain.grantId);
      expect(grant?.revokedAt).not.toBeNull();
      const due = await logoutDeliveryRepository(tx).claimDue({ now, limit: 10, leaseSeconds: 60 });
      expect(due.some((delivery) => delivery.clientId === client.id)).toBe(true);
      const rows = await auditRepository(tx).list({ action: 'session.end_all', limit: 5 });
      expect(rows[0]).toMatchObject({ resourceType: 'tenant', resourceId: t.id });
      expect(rows[0]?.detail).toMatchObject({ beyond_ceiling: 1 });
    });
  });
});

describe('GET /subjects/:id/grants and DELETE /subjects/:id/grants/:clientId', () => {
  it('lists every unrevoked grant, offline ones marked, then revokes one client’s', async () => {
    const t = await fixture.createTenant(`gr-${newId()}`);
    const { client, other } = await withTenant(fixture.app.db, t.id, async (tx) => ({
      client: await seedClient(tx, t.id),
      other: await seedClient(tx, t.id),
    }));
    const ada = await seedUser(t.id, 'ada');
    const bound = await seedSession(t.id, ada, client);
    const offline = await seedSession(t.id, ada, client, { offlineGrant: true });
    const elsewhere = await seedSession(t.id, ada, other);
    const expiresAt = new Date(fixture.clock.now().getTime() + 86_400_000);
    await withTenant(fixture.app.db, t.id, (tx) =>
      tx.insert(refreshTokens).values({
        tokenHash: `hash-${newId()}`,
        tenantId: t.id,
        grantId: offline.grantId,
        expiresAt,
      }),
    );
    const token = await fixture.adminToken(t.name, ['manage-sessions']);

    const res = await call('GET', t.name, token, `subjects/${ada}/grants`);
    expect(res.statusCode).toBe(200);
    const items = res.json<{
      items: {
        id: string;
        client_key: string;
        offline: boolean;
        refresh_expires_at: string | null;
      }[];
    }>().items;
    expect(items.map((item) => item.id).sort()).toEqual(
      [bound.grantId, offline.grantId, elsewhere.grantId].sort(),
    );
    expect(items.find((item) => item.id === offline.grantId)).toMatchObject({
      offline: true,
      client_key: client.clientId,
      refresh_expires_at: expiresAt.toISOString(),
    });
    expect(items.find((item) => item.id === bound.grantId)?.offline).toBe(false);

    const revoke = await call('DELETE', t.name, token, `subjects/${ada}/grants/${client.id}`);
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json()).toEqual({ revoked: 2 });

    const after = await call('GET', t.name, token, `subjects/${ada}/grants`);
    expect(after.json<{ items: { id: string }[] }>().items.map((item) => item.id)).toEqual([
      elsewhere.grantId,
    ]);
  });

  it('marks offline only a grant carrying offline_access, not any grant with no session', async () => {
    const t = await fixture.createTenant(`gr-${newId()}`);
    const client = await withTenant(fixture.app.db, t.id, (tx) => seedClient(tx, t.id));
    const ada = await seedUser(t.id, 'ada');
    const offline = await seedSession(t.id, ada, client, { offlineGrant: true });
    const sessionless = await seedSession(t.id, ada, client, { sessionless: true });
    const token = await fixture.adminToken(t.name, ['manage-sessions']);

    const items = (await call('GET', t.name, token, `subjects/${ada}/grants`)).json<{
      items: { id: string; offline: boolean; session_id: string | null }[];
    }>().items;
    expect(items.find((item) => item.id === offline.grantId)?.offline).toBe(true);
    expect(items.find((item) => item.id === sessionless.grantId)).toMatchObject({
      offline: false,
      session_id: null,
    });
  });

  it('refuses a caller below the subject’s capabilities, with a refused row', async () => {
    const t = await fixture.createTenant(`gr-${newId()}`);
    const client = await withTenant(fixture.app.db, t.id, (tx) => seedClient(tx, t.id));
    const root = await seedUser(t.id, 'root');
    await makeTenantAdmin(t.id, root);
    await seedSession(t.id, root, client);
    const token = await fixture.adminToken(t.name, ['manage-sessions']);

    const res = await call('DELETE', t.name, token, `subjects/${root}/grants/${client.id}`);
    expect(res.statusCode).toBe(403);
    const rows = await withTenant(fixture.app.db, t.id, (tx) =>
      auditRepository(tx).list({ action: 'grant.revoke', limit: 5 }),
    );
    expect(rows[0]).toMatchObject({ outcome: 'refused', resourceId: root });
  });

  it('answers 404 for a subject that does not exist', async () => {
    const t = await fixture.createTenant(`gr-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-sessions']);
    expect((await call('GET', t.name, token, `subjects/${newId()}/grants`)).statusCode).toBe(404);
  });
});

describe('DELETE /clients/:id/grants', () => {
  it('revokes the client’s grants within the caller’s ceiling and counts the rest', async () => {
    const t = await fixture.createTenant(`cg-${newId()}`);
    const client = await withTenant(fixture.app.db, t.id, (tx) => seedClient(tx, t.id));
    const ada = await seedUser(t.id, 'ada');
    const root = await seedUser(t.id, 'root');
    await makeTenantAdmin(t.id, root);
    const plain = await seedSession(t.id, ada, client, { offlineGrant: true });
    const guarded = await seedSession(t.id, root, client);
    const token = await fixture.adminToken(t.name, ['manage-sessions']);

    const res = await call('DELETE', t.name, token, `clients/${client.id}/grants`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ revoked: 1, beyond_ceiling: 1 });
    await withTenant(fixture.app.db, t.id, async (tx) => {
      expect((await tokenGrantRepository(tx).byId(plain.grantId))?.revokedAt).not.toBeNull();
      expect((await tokenGrantRepository(tx).byId(guarded.grantId))?.revokedAt).toBeNull();
    });
    expect((await call('DELETE', t.name, token, `clients/${newId()}/grants`)).statusCode).toBe(404);
  });
});

async function seedProbeTenant(
  tx: TenantScopedDatabase,
  tenantId: string,
): Promise<{ subjectId: string; client: ClientRecord; session: SeededSession }> {
  await tx.insert(tenants).values({ id: tenantId, name: `probe-${newId()}` });
  const client = await seedClient(tx, tenantId);
  const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
  const sessionId = newId();
  await sessionRepository(tx).create({
    id: sessionId,
    tenantId,
    subjectId: subject.id,
    expiresAt: new Date(fixture.clock.now().getTime() + 3_600_000),
    authenticators: ['pwd'],
    secretHash: SessionEntry.issue(sessionId).secretHash(),
  });
  const grantId = newId();
  await tokenGrantRepository(tx).create({
    id: grantId,
    tenantId,
    clientId: client.id,
    subjectId: subject.id,
    scope: '',
    audience: [],
    sessionId,
  });
  return { subjectId: subject.id, client, session: { sessionId, grantId } };
}

const noAudit = (): Promise<void> => Promise.resolve();
const actor = { actorSubjectId: newId(), actorTenantId: newId(), actorClientId: newId() };

describe('the tenant-wide session and grant reads and writes, probed with a foreign tenant_id', () => {
  it('lists and counts no session across tenants', async () => {
    await expectCrossTenantMethodProbe(fixture.app.db, {
      seed: seedProbeTenant,
      verifySeeded: async (tx) => {
        const counted = await countTenantSessions(tx, {
          lifespans: LIFESPANS,
          now: fixture.clock.now(),
        });
        expect(counted.count).toBe(1);
      },
      attempt: async (tx, seeded) => ({
        list: await listTenantSessions(tx, {
          tenantId: newId(),
          lifespans: LIFESPANS,
          now: fixture.clock.now(),
          clientDbId: seeded.client.id,
          limit: 50,
          cursor: undefined,
          cursorKey: CURSOR_KEY,
        }),
        count: await countTenantSessions(tx, { lifespans: LIFESPANS, now: fixture.clock.now() }),
      }),
      expectBlocked: (result) => {
        expect(result).toMatchObject({
          list: { kind: 'ok', items: [] },
          count: { count: 0 },
        });
      },
    });
  });

  it('ends no session across tenants', async () => {
    await expectCrossTenantMethodProbe(fixture.app.db, {
      seed: seedProbeTenant,
      verifySeeded: async (tx, seeded) => {
        const live = await sessionRepository(tx).liveById(
          seeded.session.sessionId,
          LIFESPANS,
          fixture.clock.now(),
        );
        expect(live).not.toBeNull();
      },
      attempt: (tx) =>
        endTenantSessions(
          tx,
          { audit: noAudit, kek: Buffer.alloc(32, 7) },
          {
            tenantId: newId(),
            lifespans: LIFESPANS,
            now: fixture.clock.now(),
            issuer: 'https://idp.example/tenants/probe',
            callerCapabilities: EVERY_CAPABILITY,
            ...actor,
          },
        ),
      expectBlocked: (result) => {
        expect(result).toEqual({ ended: 0, beyondCeiling: 0 });
      },
      verifyTenantAUnaffected: async (tx, seeded) => {
        const live = await sessionRepository(tx).liveById(
          seeded.session.sessionId,
          LIFESPANS,
          fixture.clock.now(),
        );
        expect(live).not.toBeNull();
      },
    });
  });

  it('lists and revokes no grant across tenants', async () => {
    const audit: Audit = () => Promise.resolve();
    await expectCrossTenantMethodProbe(fixture.app.db, {
      seed: seedProbeTenant,
      verifySeeded: async (tx, seeded) => {
        expect((await tokenGrantRepository(tx).byId(seeded.session.grantId))?.revokedAt).toBeNull();
      },
      attempt: async (tx, seeded) => ({
        list: await listSubjectGrants(tx, {
          tenantId: newId(),
          subjectId: seeded.subjectId,
          now: fixture.clock.now(),
          limit: 50,
          cursor: undefined,
          cursorKey: CURSOR_KEY,
        }),
        subject: await revokeSubjectGrants(
          tx,
          { audit },
          {
            subjectId: seeded.subjectId,
            clientDbId: seeded.client.id,
            now: fixture.clock.now(),
            callerCapabilities: EVERY_CAPABILITY,
            ...actor,
          },
        ),
        client: await revokeClientGrants(
          tx,
          { audit },
          {
            clientDbId: seeded.client.id,
            now: fixture.clock.now(),
            callerCapabilities: EVERY_CAPABILITY,
            ...actor,
          },
        ),
      }),
      expectBlocked: (result) => {
        expect(result).toEqual({
          list: { kind: 'not_found' },
          subject: { kind: 'not_found' },
          client: { kind: 'not_found' },
        });
      },
      verifyTenantAUnaffected: async (tx, seeded) => {
        expect((await tokenGrantRepository(tx).byId(seeded.session.grantId))?.revokedAt).toBeNull();
      },
    });
  });
});
