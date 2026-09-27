import { subjectRepository, subjects } from '@odudu/domain-identity';
import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import {
  provisionTenant,
  SessionEntry,
  sessionRepository,
  type SessionLifespans,
} from '@odudu/authn-flows';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tokenGrantRepository, type TokenGrantRecord } from '#/repository/grants';
import { refreshTokenRepository } from '#/repository/refresh';
import { generateRefreshToken, hashRefreshToken } from '#/service/refresh';
import { rotateRefreshToken } from '#/usecase/refresh-rotation';
import { tokenGrants } from '#/schema/token-grants';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

const AUDIENCE = ['https://api.example'];

const NO_LOG = { error: () => undefined };

// The grant under test here carries no session (issueRefreshToken never
// sets one), so which pair this names never affects the outcome.
const LIFESPANS: SessionLifespans = {
  ssoSessionIdleSeconds: 1_800,
  ssoSessionMaxSeconds: 36_000,
  rememberMeIdleSeconds: 604_800,
  rememberMeMaxSeconds: 2_592_000,
};

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);

  const appUrl = await createAppRole(container.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

async function seedTenantClientSubject(
  tx: TenantScopedDatabase,
  tenantId: string,
): Promise<{ clientDbId: string; subjectId: string }> {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
  await provisionTenant(tx, tenantId);
  const clientDbId = newId();
  await tx.insert(clients).values({
    id: clientDbId,
    tenantId,
    clientId: `client-${tenantId}`,
    name: 'A client',
    type: 'confidential',
    secretHash: 'hashed:secret',
  });
  await provisionClientDefaults(tx, clientDbId);
  const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
  return { clientDbId, subjectId: subject.id };
}

async function createGrant(tx: TenantScopedDatabase, tenantId: string): Promise<TokenGrantRecord> {
  const { clientDbId, subjectId } = await seedTenantClientSubject(tx, tenantId);
  return tokenGrantRepository(tx).create({
    id: newId(),
    tenantId,
    clientId: clientDbId,
    subjectId,
    scope: 'openid',
    audience: AUDIENCE,
  });
}

async function issueRefreshToken(
  tx: TenantScopedDatabase,
  tenantId: string,
): Promise<{ grant: TokenGrantRecord; token: string }> {
  const grant = await createGrant(tx, tenantId);
  const token = generateRefreshToken();
  await refreshTokenRepository(tx).create({
    tokenHash: hashRefreshToken(token),
    tenantId,
    grantId: grant.id,
    expiresAt: new Date(Date.now() + 1_209_600_000),
  });
  return { grant, token };
}

describe('tokenGrantRepository', () => {
  it('creates and finds a grant by id', async () => {
    const tenantId = newId();

    const created = await withTenant(app.db, tenantId, (tx) => createGrant(tx, tenantId));

    const found = await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).byId(created.id),
    );
    expect(found?.id).toBe(created.id);
    expect(found?.revokedAt).toBeNull();
  });

  it('revokes a grant', async () => {
    const tenantId = newId();
    const created = await withTenant(app.db, tenantId, (tx) => createGrant(tx, tenantId));

    await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).revoke(created.id, new Date()),
    );

    const found = await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).byId(created.id),
    );
    expect(found?.revokedAt).not.toBeNull();
  });

  it('reports whether a revoke changed the grant, and keeps the first revocation time', async () => {
    const tenantId = newId();
    const created = await withTenant(app.db, tenantId, (tx) => createGrant(tx, tenantId));
    const first = new Date('2026-09-26T10:00:00Z');

    const revoked = await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).revoke(created.id, first),
    );
    const again = await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).revoke(created.id, new Date('2026-09-26T11:00:00Z')),
    );

    expect(revoked).toBe(true);
    expect(again).toBe(false);
    const found = await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).byId(created.id),
    );
    expect(found?.revokedAt).toEqual(first);
  });

  it('cannot find a grant by id under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => createGrant(tx, tenantId),
      verifySeeded: async (tx, grant) => {
        const found = await tokenGrantRepository(tx).byId(grant.id);
        expect(found).not.toBeNull();
      },
      attempt: async (tx, grant) => tokenGrantRepository(tx).byId(grant.id),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });

  it('leaves a grant unrevoked when revoke is called under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => createGrant(tx, tenantId),
      verifySeeded: async (tx, grant) => {
        const found = await tokenGrantRepository(tx).byId(grant.id);
        expect(found?.revokedAt).toBeNull();
      },
      attempt: async (tx, grant) => tokenGrantRepository(tx).revoke(grant.id, new Date()),
      expectBlocked: (result) => {
        expect(result).toBe(false);
      },
      verifyTenantAUnaffected: async (tx, grant) => {
        const found = await tokenGrantRepository(tx).byId(grant.id);
        expect(found?.revokedAt).toBeNull();
      },
    });
  });

  it('revokes every grant a subject holds against one client, live or offline, and keeps the first revocation time', async () => {
    const tenantId = newId();
    const { clientDbId, subjectId } = await withTenant(app.db, tenantId, (tx) =>
      seedTenantClientSubject(tx, tenantId),
    );
    const sessionId = newId();
    await withTenant(app.db, tenantId, (tx) =>
      sessionRepository(tx).create({
        id: sessionId,
        tenantId,
        subjectId,
        expiresAt: new Date(Date.now() + 3_600_000),
        authenticators: [],
        secretHash: SessionEntry.issue(sessionId).secretHash(),
      }),
    );
    const [bound, offline] = await withTenant(app.db, tenantId, async (tx) => {
      const repository = tokenGrantRepository(tx);
      return [
        await repository.create({
          id: newId(),
          tenantId,
          clientId: clientDbId,
          subjectId,
          scope: 'openid',
          audience: AUDIENCE,
          sessionId,
        }),
        await repository.create({
          id: newId(),
          tenantId,
          clientId: clientDbId,
          subjectId,
          scope: 'openid offline_access',
          audience: AUDIENCE,
        }),
      ];
    });
    const first = new Date('2026-09-27T10:00:00Z');

    const revoked = await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).revokeForSubjectClient(subjectId, clientDbId, first),
    );
    expect(revoked).toBe(2);

    await withTenant(app.db, tenantId, async (tx) => {
      const repository = tokenGrantRepository(tx);
      expect((await repository.byId(bound.id))?.revokedAt).toEqual(first);
      expect((await repository.byId(offline.id))?.revokedAt).toEqual(first);
    });

    const again = await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).revokeForSubjectClient(
        subjectId,
        clientDbId,
        new Date('2026-09-27T11:00:00Z'),
      ),
    );
    expect(again).toBe(0);
    const stillFirst = await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).byId(bound.id),
    );
    expect(stillFirst?.revokedAt).toEqual(first);
  });

  it('does not count a grant a session logout already revoked', async () => {
    const tenantId = newId();
    const { clientDbId, subjectId } = await withTenant(app.db, tenantId, (tx) =>
      seedTenantClientSubject(tx, tenantId),
    );
    const sessionId = newId();
    await withTenant(app.db, tenantId, (tx) =>
      sessionRepository(tx).create({
        id: sessionId,
        tenantId,
        subjectId,
        expiresAt: new Date(Date.now() + 3_600_000),
        authenticators: [],
        secretHash: SessionEntry.issue(sessionId).secretHash(),
      }),
    );
    const [bound, offline] = await withTenant(app.db, tenantId, async (tx) => {
      const repository = tokenGrantRepository(tx);
      return [
        await repository.create({
          id: newId(),
          tenantId,
          clientId: clientDbId,
          subjectId,
          scope: 'openid',
          audience: AUDIENCE,
          sessionId,
        }),
        await repository.create({
          id: newId(),
          tenantId,
          clientId: clientDbId,
          subjectId,
          scope: 'openid offline_access',
          audience: AUDIENCE,
        }),
      ];
    });

    await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).revokeForSession(sessionId, new Date('2026-09-27T09:00:00Z')),
    );

    const revoked = await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).revokeForSubjectClient(
        subjectId,
        clientDbId,
        new Date('2026-09-27T10:00:00Z'),
      ),
    );
    expect(revoked).toBe(1);

    await withTenant(app.db, tenantId, async (tx) => {
      const repository = tokenGrantRepository(tx);
      expect((await repository.byId(bound.id))?.revokedAt).toEqual(
        new Date('2026-09-27T09:00:00Z'),
      );
      expect((await repository.byId(offline.id))?.revokedAt).toEqual(
        new Date('2026-09-27T10:00:00Z'),
      );
    });
  });

  it('does not revoke another subject’s grant against the same client', async () => {
    const tenantId = newId();
    const { clientDbId, subjectId } = await withTenant(app.db, tenantId, (tx) =>
      seedTenantClientSubject(tx, tenantId),
    );
    const other = await withTenant(app.db, tenantId, (tx) =>
      subjectRepository(tx).create({ tenantId, type: 'user' }),
    );
    const otherGrant = await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).create({
        id: newId(),
        tenantId,
        clientId: clientDbId,
        subjectId: other.id,
        scope: 'openid',
        audience: AUDIENCE,
      }),
    );

    await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).revokeForSubjectClient(subjectId, clientDbId, new Date()),
    );

    const found = await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).byId(otherGrant.id),
    );
    expect(found?.revokedAt).toBeNull();
  });

  it('cannot revoke a foreign tenant’s grants against a subject/client pair, even given that tenant’s own ids', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        const { clientDbId, subjectId } = await seedTenantClientSubject(tx, tenantId);
        const grant = await tokenGrantRepository(tx).create({
          id: newId(),
          tenantId,
          clientId: clientDbId,
          subjectId,
          scope: 'openid',
          audience: AUDIENCE,
        });
        return { clientDbId, subjectId, grantId: grant.id };
      },
      verifySeeded: async (tx, seeded) => {
        const found = await tokenGrantRepository(tx).byId(seeded.grantId);
        expect(found?.revokedAt).toBeNull();
      },
      attempt: async (tx, seeded) =>
        tokenGrantRepository(tx).revokeForSubjectClient(
          seeded.subjectId,
          seeded.clientDbId,
          new Date(),
        ),
      expectBlocked: (result) => {
        expect(result).toBe(0);
      },
      verifyTenantAUnaffected: async (tx, seeded) => {
        const found = await tokenGrantRepository(tx).byId(seeded.grantId);
        expect(found?.revokedAt).toBeNull();
      },
    });
  });

  it('records the actor and the grant it came from, and inherits the session', async () => {
    const tenantId = newId();
    const sessionId = newId();
    const { clientDbId, subjectId } = await withTenant(app.db, tenantId, (tx) =>
      seedTenantClientSubject(tx, tenantId),
    );
    const actor = await withTenant(app.db, tenantId, (tx) =>
      subjectRepository(tx).create({
        tenantId,
        type: 'user',
      }),
    );
    await withTenant(app.db, tenantId, (tx) =>
      sessionRepository(tx).create({
        id: sessionId,
        tenantId,
        subjectId,
        expiresAt: new Date(Date.now() + 3_600_000),
        authenticators: [],
        secretHash: SessionEntry.issue(sessionId).secretHash(),
      }),
    );

    const subjectGrant = await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).create({
        id: newId(),
        tenantId,
        clientId: clientDbId,
        subjectId,
        scope: 'openid',
        audience: AUDIENCE,
        sessionId,
      }),
    );

    const exchanged = await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).create({
        id: newId(),
        tenantId,
        clientId: clientDbId,
        subjectId,
        scope: 'openid',
        audience: AUDIENCE,
        sessionId,
        actorSubjectId: actor.id,
        exchangedFromGrantId: subjectGrant.id,
      }),
    );

    const row = await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).byId(exchanged.id),
    );
    expect(row).toMatchObject({
      subjectId,
      actorSubjectId: actor.id,
      exchangedFromGrantId: subjectGrant.id,
      sessionId,
    });
  });

  it('cannot find an exchanged grant by id under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        const { clientDbId, subjectId } = await seedTenantClientSubject(tx, tenantId);
        const actor = await subjectRepository(tx).create({ tenantId, type: 'user' });
        const subjectGrant = await tokenGrantRepository(tx).create({
          id: newId(),
          tenantId,
          clientId: clientDbId,
          subjectId,
          scope: 'openid',
          audience: AUDIENCE,
        });
        return tokenGrantRepository(tx).create({
          id: newId(),
          tenantId,
          clientId: clientDbId,
          subjectId,
          scope: 'openid',
          audience: AUDIENCE,
          actorSubjectId: actor.id,
          exchangedFromGrantId: subjectGrant.id,
        });
      },
      verifySeeded: async (tx, grant) => {
        const found = await tokenGrantRepository(tx).byId(grant.id);
        expect(found?.actorSubjectId).not.toBeNull();
      },
      attempt: async (tx, grant) => tokenGrantRepository(tx).byId(grant.id),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });

  it('refuses to rotate a refresh token whose grant has been revoked', async () => {
    const tenantId = newId();
    const { grant, token } = await withTenant(app.db, tenantId, (tx) =>
      issueRefreshToken(tx, tenantId),
    );

    await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).revoke(grant.id, new Date()),
    );

    const outcome = await withTenant(app.db, tenantId, (tx) =>
      rotateRefreshToken(
        tx,
        hashRefreshToken(token),
        new Date(),
        600,
        LIFESPANS,
        ['openid'],
        NO_LOG,
      ),
    );
    expect(outcome.kind).toBe('revoked');
  });

  // token_grants_actor_subject_fk (0059_token_exchange.sql). An unrestricted
  // ON DELETE SET NULL would null tenant_id alongside actor_subject_id and
  // the delete would fail its NOT NULL constraint instead of detaching the
  // actor — the column-list form nulls only actor_subject_id.
  it('detaches actor_subject_id when the actor subject is deleted, leaving tenant_id intact', async () => {
    const tenantId = newId();

    const grant = await withTenant(app.db, tenantId, async (tx) => {
      const created = await createGrant(tx, tenantId);
      const actor = await subjectRepository(tx).create({ tenantId, type: 'user' });
      await tx
        .update(tokenGrants)
        .set({ actorSubjectId: actor.id })
        .where(eq(tokenGrants.id, created.id));
      await tx.delete(subjects).where(eq(subjects.id, actor.id));
      return created;
    });

    const found = await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).byId(grant.id),
    );
    expect(found?.tenantId).toBe(tenantId);
    expect(found?.actorSubjectId).toBeNull();
  });

  // token_grants_exchanged_from_grant_fk (0059_token_exchange.sql). Same
  // column-list reasoning as the actor FK above, applied to the lineage
  // pointer instead.
  it('detaches exchanged_from_grant_id when the parent grant is deleted, leaving tenant_id intact', async () => {
    const tenantId = newId();

    const child = await withTenant(app.db, tenantId, async (tx) => {
      const { clientDbId, subjectId } = await seedTenantClientSubject(tx, tenantId);
      const grantFor = () =>
        tokenGrantRepository(tx).create({
          id: newId(),
          tenantId,
          clientId: clientDbId,
          subjectId,
          scope: 'openid',
          audience: AUDIENCE,
        });
      const parent = await grantFor();
      const created = await grantFor();
      await tx
        .update(tokenGrants)
        .set({ exchangedFromGrantId: parent.id })
        .where(eq(tokenGrants.id, created.id));
      await tx.delete(tokenGrants).where(eq(tokenGrants.id, parent.id));
      return created;
    });

    const found = await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).byId(child.id),
    );
    expect(found?.tenantId).toBe(tenantId);
    expect(found?.exchangedFromGrantId).toBeNull();
  });
});
