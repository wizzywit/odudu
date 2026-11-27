import { provisionTenant, SessionEntry, sessions } from '@odudu/authn-flows';
import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { subjectRepository } from '@odudu/domain-identity';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tokenGrantRepository } from '#/repository/grants';
import { endAllAccess, endOtherSessions, endSession } from '#/usecase/end-session';

// A grant's revocation says why only where the path knows the person ended their
// own sign-in; everything else leaves it empty, which a conversation of the
// console assistant reads as "not to be carried on".

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

const KEK = Buffer.alloc(32, 33);
const NOW = new Date('2026-11-27T12:00:00Z');
const LATER = new Date('2026-11-27T12:05:00Z');
const ISSUER = 'https://idp.test';

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 5 });
}, 120_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container.stop();
});

interface Held {
  tenantId: string;
  subjectId: string;
  sessions: string[];
  grants: string[];
  // A grant exchanged from the first one, as a conversation's is from a sign-in.
  child: string;
}

async function holder(sessionCount = 1): Promise<Held> {
  const tenantId = newId();
  const clientDbId = newId();
  return withTenant(app.db, tenantId, async (tx): Promise<Held> => {
    await tx.insert(tenants).values({ id: tenantId, name: `cause-${tenantId}` });
    await provisionTenant(tx, tenantId);
    await tx.insert(clients).values({
      id: clientDbId,
      tenantId,
      clientId: 'rp',
      name: 'rp',
      type: 'public',
    });
    await provisionClientDefaults(tx, clientDbId);
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    const ids = Array.from({ length: sessionCount }, () => newId());
    const grants: string[] = [];
    for (const id of ids) {
      await tx.insert(sessions).values({
        id,
        tenantId,
        subjectId: subject.id,
        expiresAt: new Date(NOW.getTime() + 3_600_000),
        authenticators: [],
        secretHash: SessionEntry.issue(id).secretHash(),
      });
      const grantId = newId();
      await tokenGrantRepository(tx).create({
        id: grantId,
        tenantId,
        clientId: clientDbId,
        subjectId: subject.id,
        scope: 'openid',
        audience: [],
        sessionId: id,
      });
      grants.push(grantId);
    }
    const child = newId();
    await tokenGrantRepository(tx).create({
      id: child,
      tenantId,
      clientId: clientDbId,
      subjectId: subject.id,
      scope: 'mcp:read',
      audience: [],
      sessionId: ids[0] ?? null,
      exchangedFromGrantId: grants[0] ?? null,
    });
    return { tenantId, subjectId: subject.id, sessions: ids, grants, child };
  });
}

async function rowOf(id: string) {
  const rows = (await owner.db.execute(
    sql`select revoked_at, revoked_cause from token_grants where id = ${id}`,
  )) as unknown as { revoked_at: Date | null; revoked_cause: string | null }[];
  return rows[0];
}

describe('the cause of a revocation', () => {
  it('is stamped by the call that revokes first and kept by a later one', async () => {
    const h = await holder();
    await withTenant(app.db, h.tenantId, async (tx) => {
      const repo = tokenGrantRepository(tx);
      expect(await repo.revoke(h.grants[0] ?? '', NOW, 'sign_out')).toBe(true);
      expect(await repo.revoke(h.grants[0] ?? '', LATER)).toBe(false);
      await repo.revokeForSessions(h.sessions, LATER);
    });
    expect(await rowOf(h.grants[0] ?? '')).toMatchObject({ revoked_cause: 'sign_out' });
    // A grant revoked only by a cascade carries no cause of its own, and the same instant.
    const child = await rowOf(h.child);
    expect(child?.revoked_cause).toBeNull();
    expect(new Date(child?.revoked_at ?? 0).getTime()).toBe(NOW.getTime());
  });

  it('is empty when a revoke names none', async () => {
    const h = await holder();
    await withTenant(app.db, h.tenantId, (tx) =>
      tokenGrantRepository(tx).revoke(h.grants[0] ?? '', NOW),
    );
    expect(await rowOf(h.grants[0] ?? '')).toMatchObject({ revoked_cause: null });
  });

  it('is refused by the database on a live grant and for an unknown cause', async () => {
    const h = await holder();
    await expect(
      owner.db.execute(
        sql`update token_grants set revoked_cause = 'sign_out' where id = ${h.grants[0] ?? ''}`,
      ),
    ).rejects.toThrow();
    await expect(
      owner.db.execute(
        sql`update token_grants set revoked_at = now(), revoked_cause = 'whatever' where id = ${h.grants[0] ?? ''}`,
      ),
    ).rejects.toThrow();
  });

  it('is a sign-out for a logout and for a person ending their own sessions', async () => {
    const h = await holder(2);
    await withTenant(app.db, h.tenantId, (tx) =>
      endSession(
        tx,
        { kek: KEK },
        {
          tenantId: h.tenantId,
          sessionId: h.sessions[0] ?? '',
          subjectId: h.subjectId,
          now: NOW,
          issuer: ISSUER,
          via: 'logout',
        },
      ),
    );
    expect(await rowOf(h.grants[0] ?? '')).toMatchObject({ revoked_cause: 'sign_out' });
    expect((await rowOf(h.grants[1] ?? ''))?.revoked_at).toBeNull();

    await withTenant(app.db, h.tenantId, (tx) =>
      endOtherSessions(
        tx,
        { kek: KEK },
        { tenantId: h.tenantId, subjectId: h.subjectId, now: LATER, issuer: ISSUER, except: null },
      ),
    );
    expect(await rowOf(h.grants[1] ?? '')).toMatchObject({ revoked_cause: 'sign_out' });
  });

  it('is empty when an administrator ends the session and when an account is recovered', async () => {
    const h = await holder(2);
    await withTenant(app.db, h.tenantId, (tx) =>
      endSession(
        tx,
        { kek: KEK },
        {
          tenantId: h.tenantId,
          sessionId: h.sessions[0] ?? '',
          subjectId: h.subjectId,
          now: NOW,
          issuer: ISSUER,
          via: 'admin',
        },
      ),
    );
    expect(await rowOf(h.grants[0] ?? '')).toMatchObject({ revoked_cause: null });
    expect((await rowOf(h.grants[0] ?? ''))?.revoked_at).not.toBeNull();

    await withTenant(app.db, h.tenantId, (tx) =>
      endAllAccess(
        tx,
        { kek: KEK },
        { tenantId: h.tenantId, subjectId: h.subjectId, now: LATER, issuer: ISSUER },
      ),
    );
    expect(await rowOf(h.grants[1] ?? '')).toMatchObject({ revoked_cause: null });
    expect((await rowOf(h.grants[1] ?? ''))?.revoked_at).not.toBeNull();
  });
});
