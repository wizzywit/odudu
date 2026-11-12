import { provisionTenant, SessionEntry, sessions } from '@odudu/authn-flows';
import { generateSigningKey, signingKeys } from '@odudu/crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { auditEvents } from '@odudu/domain-audit';
import { subjectRepository } from '@odudu/domain-identity';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { tokenGrantRepository } from '#/repository/grants';
import { backchannelLogoutDeliveries } from '#/schema/logout-deliveries';
import { tokenGrants } from '#/schema/token-grants';
import { endAllAccess, endOtherSessions } from '#/usecase/end-session';

// A recovered account loses every session and grant it held. The work is a
// handful of statements however many sessions there are.

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let countingHandle: DatabaseHandle | undefined;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let counting: DatabaseHandle;
let statements = 0;

const KEK = Buffer.alloc(32, 31);
const NOW = new Date('2026-10-01T12:00:00Z');

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(containerHandle.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  app = appHandle;
  countingHandle = createDatabase(appUrl, {
    max: 1,
    onQueryForTests: () => {
      statements += 1;
    },
  });
  counting = countingHandle;
}, 120_000);

afterAll(async () => {
  await countingHandle?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

async function holder(sessionCount: number): Promise<{ tenantId: string; subjectId: string }> {
  const tenantId = newId();
  const clientDbId = newId();
  const subjectId = await withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `end-all-${tenantId}` });
    await provisionTenant(tx, tenantId);
    await tx.insert(clients).values({
      id: clientDbId,
      tenantId,
      clientId: 'rp',
      name: 'rp',
      type: 'public',
    });
    await provisionClientDefaults(tx, clientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: clientDbId,
      tenantId,
      redirectUris: ['https://rp.example/callback'],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
      backchannelLogoutUri: 'https://rp.example/backchannel',
    });
    const generated = await generateSigningKey('ES256', KEK);
    await tx.insert(signingKeys).values({
      id: newId(),
      tenantId,
      kid: generated.kid,
      alg: generated.alg,
      status: 'active',
      publicJwk: generated.publicJwk,
      privateJwkEncrypted: generated.privateJwkEncrypted,
    });
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    const ids = Array.from({ length: sessionCount }, () => newId());
    if (ids.length > 0) {
      await tx.insert(sessions).values(
        ids.map((id) => ({
          id,
          tenantId,
          subjectId: subject.id,
          expiresAt: new Date(NOW.getTime() + 3_600_000),
          authenticators: [],
          secretHash: SessionEntry.issue(id).secretHash(),
        })),
      );
      await tx.insert(tokenGrants).values(
        ids.map((sessionId) => ({
          id: newId(),
          tenantId,
          clientId: clientDbId,
          subjectId: subject.id,
          scope: 'openid',
          audience: [],
          sessionId,
        })),
      );
    }
    await tokenGrantRepository(tx).create({
      id: newId(),
      tenantId,
      clientId: clientDbId,
      subjectId: subject.id,
      scope: 'openid offline_access',
      audience: [],
    });
    return subject.id;
  });
  return { tenantId, subjectId };
}

async function recover(tenantId: string, subjectId: string): Promise<number> {
  statements = 0;
  await withTenant(counting.db, tenantId, (tx) =>
    endAllAccess(tx, { kek: KEK }, { tenantId, subjectId, now: NOW, issuer: 'https://idp.test' }),
  );
  return statements;
}

describe('endAllAccess', () => {
  it('ends every session, revokes every grant and queues one delivery per session', async () => {
    const { tenantId, subjectId } = await holder(3);
    await recover(tenantId, subjectId);

    const held = await owner.db
      .select({ expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(eq(sessions.subjectId, subjectId));
    expect(held).toHaveLength(3);
    expect(held.every((row) => row.expiresAt.getTime() <= NOW.getTime())).toBe(true);
    const unrevoked = await owner.db
      .select({ id: tokenGrants.id })
      .from(tokenGrants)
      .where(and(eq(tokenGrants.subjectId, subjectId), isNull(tokenGrants.revokedAt)));
    expect(unrevoked).toEqual([]);
    const deliveries = await owner.db
      .select({ sessionId: backchannelLogoutDeliveries.sessionId })
      .from(backchannelLogoutDeliveries)
      .where(eq(backchannelLogoutDeliveries.tenantId, tenantId));
    expect(new Set(deliveries.map((row) => row.sessionId)).size).toBe(3);
    const audited = await owner.db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(and(eq(auditEvents.tenantId, tenantId), eq(auditEvents.action, 'session.ended')));
    expect(audited).toHaveLength(3);
  });

  it('issues the same statements for fifty sessions as for two', async () => {
    const few = await holder(2);
    const many = await holder(50);
    const forFew = await recover(few.tenantId, few.subjectId);
    const forMany = await recover(many.tenantId, many.subjectId);
    expect(forMany).toBe(forFew);
  });

  it('takes a few statements a page when a subject holds more than a page of sessions', async () => {
    const { tenantId, subjectId } = await holder(450);
    const used = await recover(tenantId, subjectId);
    expect(used).toBeLessThan(60);
    const open = await owner.db
      .select({ expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(eq(sessions.subjectId, subjectId));
    expect(open.filter((row) => row.expiresAt.getTime() > NOW.getTime())).toEqual([]);
    const deliveries = await owner.db
      .select({ id: backchannelLogoutDeliveries.id })
      .from(backchannelLogoutDeliveries)
      .where(eq(backchannelLogoutDeliveries.tenantId, tenantId));
    expect(deliveries).toHaveLength(450);
  });
});

describe('endOtherSessions', () => {
  const issuer = 'https://idp.test';

  async function liveSessions(subjectId: string): Promise<string[]> {
    const rows = await owner.db
      .select({ id: sessions.id, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(eq(sessions.subjectId, subjectId));
    return rows.filter((row) => row.expiresAt.getTime() > NOW.getTime()).map((row) => row.id);
  }

  it('ends every session but the one in use, with its grants and deliveries', async () => {
    const { tenantId, subjectId } = await holder(4);
    const [keep] = await liveSessions(subjectId);
    if (keep === undefined) throw new Error('no session');
    await withTenant(app.db, tenantId, (tx) =>
      endOtherSessions(tx, { kek: KEK }, { tenantId, subjectId, now: NOW, issuer, except: keep }),
    );
    expect(await liveSessions(subjectId)).toEqual([keep]);
    const live = await owner.db
      .select({ sessionId: tokenGrants.sessionId, revokedAt: tokenGrants.revokedAt })
      .from(tokenGrants)
      .where(and(eq(tokenGrants.subjectId, subjectId), isNull(tokenGrants.revokedAt)));
    expect(live.map((row) => row.sessionId).sort()).toEqual([keep, null].sort());
    const deliveries = await owner.db
      .select({ sessionId: backchannelLogoutDeliveries.sessionId })
      .from(backchannelLogoutDeliveries)
      .where(eq(backchannelLogoutDeliveries.tenantId, tenantId));
    expect(deliveries).toHaveLength(3);
    expect(deliveries.map((row) => row.sessionId)).not.toContain(keep);
    const ended = await owner.db
      .select({ detail: auditEvents.detail })
      .from(auditEvents)
      .where(and(eq(auditEvents.tenantId, tenantId), eq(auditEvents.action, 'session.ended')));
    expect(ended).toHaveLength(3);
    expect(ended.every((row) => (row.detail as { via?: string }).via === 'self')).toBe(true);
  });

  it('ends them all when none is in use', async () => {
    const { tenantId, subjectId } = await holder(2);
    await withTenant(app.db, tenantId, (tx) =>
      endOtherSessions(tx, { kek: KEK }, { tenantId, subjectId, now: NOW, issuer, except: null }),
    );
    expect(await liveSessions(subjectId)).toEqual([]);
  });

  it('reaches no session of another tenant', async () => {
    const mine = await holder(2);
    const theirs = await holder(2);
    await withTenant(app.db, mine.tenantId, (tx) =>
      endOtherSessions(
        tx,
        { kek: KEK },
        { tenantId: mine.tenantId, subjectId: theirs.subjectId, now: NOW, issuer, except: null },
      ),
    );
    expect(await liveSessions(theirs.subjectId)).toHaveLength(2);
  });

  it('takes a few statements a page when a subject holds more than a page', async () => {
    const { tenantId, subjectId } = await holder(250);
    const [keep] = await liveSessions(subjectId);
    statements = 0;
    await withTenant(counting.db, tenantId, (tx) =>
      endOtherSessions(
        tx,
        { kek: KEK },
        { tenantId, subjectId, now: NOW, issuer, except: keep ?? null },
      ),
    );
    expect(statements).toBeLessThan(40);
    expect(await liveSessions(subjectId)).toEqual([keep]);
  });
});
