import { sessionRepository } from '@odudu/authn-flows';
import { hashPassword, subjectRepository } from '@odudu/domain-identity';
import {
  clientRepository,
  provisionClientDefaults,
  TENANT_CAPABILITIES,
  type ClientRecord,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import {
  clientOidcConfigRepository,
  logoutDeliveryRepository,
  tokenGrantRepository,
} from '@odudu/protocol-oidc';
import { withTenant } from '@odudu/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { endSession, listSessions, type SessionAuditEvent } from '#/usecase/sessions';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

// A confidential client registered with a back-channel logout URI, and a
// live session for `subjectId` that holds a grant issued through it — the
// minimum a test needs to see `client_ids` populated and a delivery
// enqueued when the session ends.
async function seedSessionWithGrant(
  tenantId: string,
  subjectId: string,
): Promise<{ sessionId: string; client: ClientRecord }> {
  return withTenant(fixture.app.db, tenantId, async (tx) => {
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

    const sessionId = newId();
    await sessionRepository(tx).create({
      id: sessionId,
      tenantId,
      subjectId,
      expiresAt: new Date(fixture.clock.now().getTime() + 3_600_000),
      authenticators: ['pwd'],
    });
    await tokenGrantRepository(tx).create({
      id: newId(),
      tenantId,
      clientId: client.id,
      subjectId,
      scope: '',
      audience: [],
      sessionId,
    });
    return { sessionId, client };
  });
}

describe('GET /admin/tenants/{t}/subjects/{id}/sessions', () => {
  it('lists a live session with the client ids it holds grants for', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: subjectId } = await fixture.createSubject(t.name, `alice-${newId()}`);
    const { sessionId, client } = await seedSessionWithGrant(t.id, subjectId);

    const token = await fixture.adminToken(t.name, ['manage-sessions']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects/${subjectId}/sessions`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json<{
      items: {
        id: string;
        created_at: string;
        last_active_at: string;
        remembered: boolean;
        client_ids: string[];
      }[];
    }>().items;
    const found = items.find((item) => item.id === sessionId);
    expect(found).toBeDefined();
    expect(found?.remembered).toBe(false);
    expect(typeof found?.created_at).toBe('string');
    expect(typeof found?.last_active_at).toBe('string');
    expect(found?.client_ids).toEqual([client.clientId]);
  });

  it('never returns an orphaned session for a foreign subject', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: subjectId } = await fixture.createSubject(t.name, `bob-${newId()}`);
    const { id: otherSubjectId } = await fixture.createSubject(t.name, `carol-${newId()}`);
    await seedSessionWithGrant(t.id, otherSubjectId);

    const token = await fixture.adminToken(t.name, ['manage-sessions']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects/${subjectId}/sessions`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ items: unknown[] }>().items).toEqual([]);
  });

  // The capability matrix row: every capability but manage-sessions is
  // refused, manage-sessions alone admits.
  it.each(TENANT_CAPABILITIES.filter((c) => c !== 'manage-sessions'))(
    'refuses a caller holding only %s',
    async (capability) => {
      const t = await fixture.createTenant(`acme-${newId()}`);
      const { id: subjectId } = await fixture.createSubject(t.name, `x-${newId()}`);
      const token = await fixture.adminToken(t.name, [capability]);
      const res = await fixture.http.inject({
        method: 'GET',
        url: `/admin/tenants/${t.name}/subjects/${subjectId}/sessions`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    },
  );
});

describe('DELETE /admin/tenants/{t}/subjects/{id}/sessions/{sid}', () => {
  it('ends a session: revokes its grants and enqueues a back-channel delivery', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: subjectId } = await fixture.createSubject(t.name, `dana-${newId()}`);
    const { sessionId, client } = await seedSessionWithGrant(t.id, subjectId);

    const token = await fixture.adminToken(t.name, ['manage-sessions']);
    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/subjects/${subjectId}/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);

    await withTenant(fixture.app.db, t.id, async (tx) => {
      const grants = await tokenGrantRepository(tx).bySession(sessionId);
      expect(grants.every((grant) => grant.revokedAt !== null)).toBe(true);

      const due = await logoutDeliveryRepository(tx).claimDue({
        now: fixture.clock.now(),
        limit: 10,
        leaseSeconds: 60,
      });
      const delivery = due.find((d) => d.clientId === client.id);
      expect(delivery).toBeDefined();
    });
  });

  it('is idempotent: a second DELETE of the same session answers 204', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: subjectId } = await fixture.createSubject(t.name, `erin-${newId()}`);
    const { sessionId } = await seedSessionWithGrant(t.id, subjectId);

    const token = await fixture.adminToken(t.name, ['manage-sessions']);
    const url = `/admin/tenants/${t.name}/subjects/${subjectId}/sessions/${sessionId}`;
    const headers = { authorization: `Bearer ${token}` };

    const first = await fixture.http.inject({ method: 'DELETE', url, headers });
    expect(first.statusCode).toBe(204);

    const second = await fixture.http.inject({ method: 'DELETE', url, headers });
    expect(second.statusCode).toBe(204);
  });

  it('refuses an unknown session id with 404', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: subjectId } = await fixture.createSubject(t.name, `frank-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-sessions']);
    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/subjects/${subjectId}/sessions/${newId()}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses a session belonging to a different subject with 404', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: subjectId } = await fixture.createSubject(t.name, `greg-${newId()}`);
    const { id: otherSubjectId } = await fixture.createSubject(t.name, `hana-${newId()}`);
    const { sessionId } = await seedSessionWithGrant(t.id, otherSubjectId);

    const token = await fixture.adminToken(t.name, ['manage-sessions']);
    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/subjects/${subjectId}/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it.each(TENANT_CAPABILITIES.filter((c) => c !== 'manage-sessions'))(
    'refuses a caller holding only %s',
    async (capability) => {
      const t = await fixture.createTenant(`acme-${newId()}`);
      const { id: subjectId } = await fixture.createSubject(t.name, `y-${newId()}`);
      const { sessionId } = await seedSessionWithGrant(t.id, subjectId);
      const token = await fixture.adminToken(t.name, [capability]);
      const res = await fixture.http.inject({
        method: 'DELETE',
        url: `/admin/tenants/${t.name}/subjects/${subjectId}/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    },
  );
});

// Drives the usecase directly, the way subjects.int.test.ts's own
// describe('audit', ...) does, so a mutation's exactly-once call and a
// refusal's zero calls are pinned without going through HTTP.
describe('audit', () => {
  function collector(): {
    events: SessionAuditEvent[];
    audit: (e: SessionAuditEvent) => Promise<void>;
  } {
    const events: SessionAuditEvent[] = [];
    return {
      events,
      audit: (event) => {
        events.push(event);
        return Promise.resolve();
      },
    };
  }

  it('calls audit exactly once ending a session, and not on a not_found refusal', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: subjectId } = await fixture.createSubject(t.name, `ina-${newId()}`);
    const { sessionId } = await seedSessionWithGrant(t.id, subjectId);

    const ok = collector();
    const ended = await withTenant(fixture.app.db, t.id, (tx) =>
      endSession(
        tx,
        { audit: ok.audit, kek: Buffer.alloc(32, 7) },
        {
          tenantId: t.id,
          subjectId,
          sessionId,
          actorSubjectId: 'test',
          issuer: 'https://issuer.example/tenants/acme',
          now: fixture.clock.now(),
        },
      ),
    );
    expect(ended.kind).toBe('ended');
    expect(ok.events).toHaveLength(1);
    expect(ok.events[0]?.action).toBe('session.end');

    const refused = collector();
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      endSession(
        tx,
        { audit: refused.audit, kek: Buffer.alloc(32, 7) },
        {
          tenantId: t.id,
          subjectId,
          sessionId: newId(),
          actorSubjectId: 'test',
          issuer: 'https://issuer.example/tenants/acme',
          now: fixture.clock.now(),
        },
      ),
    );
    expect(outcome.kind).toBe('not_found');
    expect(refused.events).toHaveLength(0);
  });

  it('probes listSessions against a foreign tenant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const u = await fixture.createTenant(`umbrella-${newId()}`);
    const { id: subjectId } = await fixture.createSubject(t.name, `jo-${newId()}`);
    await seedSessionWithGrant(t.id, subjectId);

    const items = await withTenant(fixture.app.db, u.id, (tx) =>
      listSessions(tx, { tenantId: u.id, subjectId, now: fixture.clock.now() }),
    );
    expect(items).toEqual([]);
  });
});
