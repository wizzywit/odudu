import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { subjectRepository } from '@odudu/domain-identity';
import { clients } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentDelegationRepository, type NewAgentDelegation } from '#/repository/delegations';
import { IN_AN_HOUR, refusalOf, NOW, seedOwner, type Seeded } from '#/testing/seed';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
  appHandle = createDatabase(await createAppRole(containerHandle.adminUrl), { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

async function secondClient(tx: TenantScopedDatabase, tenantId: string): Promise<string> {
  const id = newId();
  await tx.insert(clients).values({
    id,
    tenantId,
    clientId: `actor-${id}`,
    name: 'An actor',
    type: 'confidential',
    secretHash: 'hashed:secret',
  });
  return id;
}

function input(
  seeded: Seeded,
  actorClientId: string,
  overrides: Partial<NewAgentDelegation> = {},
): NewAgentDelegation {
  return {
    id: newId(),
    tenantId: seeded.tenantId,
    subjectId: seeded.ownerId,
    clientId: seeded.clientId,
    actorClientId,
    scopeCeiling: 'openid',
    expiresAt: IN_AN_HOUR,
    ...overrides,
  };
}

async function inTenant<T>(
  fn: (
    repo: ReturnType<typeof agentDelegationRepository>,
    seeded: Seeded,
    actor: string,
    tx: TenantScopedDatabase,
  ) => Promise<T>,
): Promise<T> {
  const tenantId = newId();
  return withTenant(app.db, tenantId, async (tx) => {
    const seeded = await seedOwner(tx, tenantId);
    return fn(agentDelegationRepository(tx), seeded, await secondClient(tx, tenantId), tx);
  });
}

describe('agentDelegationRepository', () => {
  it('creates a delegation that activeFor and list find', async () => {
    await inTenant(async (repo, seeded, actor) => {
      const record = await repo.create(input(seeded, actor));
      expect(record).toMatchObject({
        actorClientId: actor,
        scopeCeiling: 'openid',
        revokedAt: null,
      });
      expect(await repo.activeFor(seeded.ownerId, seeded.clientId, NOW)).toEqual([record]);
      expect(await repo.list(seeded.ownerId)).toEqual([record]);
    });
  });

  it('activeFor leaves out revoked, expired and other-client delegations', async () => {
    await inTenant(async (repo, seeded, actor) => {
      const kept = await repo.create(input(seeded, actor));
      const revoked = await repo.create(input(seeded, actor));
      await repo.create(input(seeded, actor, { expiresAt: new Date(NOW.getTime() - 1) }));
      await repo.create(input(seeded, actor, { clientId: actor }));
      expect(await repo.revoke(seeded.ownerId, revoked.id, NOW)).toMatchObject({ id: revoked.id });
      expect(await repo.revoke(seeded.ownerId, revoked.id, NOW)).toBeNull();
      const active = await repo.activeFor(seeded.ownerId, seeded.clientId, NOW);
      expect(active.map((row) => row.id)).toEqual([kept.id]);
      expect(await repo.list(seeded.ownerId)).toHaveLength(4);
    });
  });
});

describe('agentDelegationRepository for one actor', () => {
  it('activeForActor finds the oldest delegation of an actor past the newest 200 of others', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      const seeded = await seedOwner(tx, tenantId);
      const actor = await secondClient(tx, tenantId);
      const repo = agentDelegationRepository(tx);
      const oldest = await repo.create(input(seeded, actor, { scopeCeiling: 'a b' }));
      await tx.execute(
        sql`update agent_delegations set created_at = ${NOW.toISOString()}::timestamptz - interval '1 day'
             where id = ${oldest.id}`,
      );
      await tx.execute(
        sql`insert into agent_delegations
              (tenant_id, id, subject_id, client_id, actor_client_id, scope_ceiling, expires_at)
            select ${tenantId}, gen_random_uuid(), ${seeded.ownerId}, ${seeded.clientId},
                   ${seeded.clientId}, 'openid', ${IN_AN_HOUR.toISOString()}::timestamptz
              from generate_series(1, 201)`,
      );
      const own = await repo.activeForActor(seeded.ownerId, seeded.clientId, actor, NOW);
      expect(own.map((row) => row.id)).toEqual([oldest.id]);
      expect(await repo.activeFor(seeded.ownerId, seeded.clientId, NOW)).toHaveLength(200);
    });
  });

  it('activeForActor leaves out revoked, expired and other-actor delegations', async () => {
    await inTenant(async (repo, seeded, actor) => {
      const kept = await repo.create(input(seeded, actor));
      const revoked = await repo.create(input(seeded, actor));
      await repo.revoke(seeded.ownerId, revoked.id, NOW);
      await repo.create(input(seeded, actor, { expiresAt: new Date(NOW.getTime() - 1) }));
      await repo.create(input(seeded, seeded.clientId));
      const own = await repo.activeForActor(seeded.ownerId, seeded.clientId, actor, NOW);
      expect(own.map((row) => row.id)).toEqual([kept.id]);
    });
  });

  it('hasActive is true for any live delegation and false once none is', async () => {
    await inTenant(async (repo, seeded, actor) => {
      expect(await repo.hasActive(seeded.ownerId, seeded.clientId, NOW)).toBe(false);
      const record = await repo.create(input(seeded, actor));
      expect(await repo.hasActive(seeded.ownerId, seeded.clientId, NOW)).toBe(true);
      await repo.revoke(seeded.ownerId, record.id, NOW);
      expect(await repo.hasActive(seeded.ownerId, seeded.clientId, NOW)).toBe(false);
    });
  });
});

describe('agentDelegationRepository across tenants', () => {
  const seedDelegation = async (
    tx: TenantScopedDatabase,
    tenantId: string,
  ): Promise<{ id: string; subjectId: string; clientId: string }> => {
    const seeded = await seedOwner(tx, tenantId);
    const record = await agentDelegationRepository(tx).create(
      input(seeded, await secondClient(tx, tenantId)),
    );
    return { id: record.id, subjectId: seeded.ownerId, clientId: seeded.clientId };
  };

  const stillActive = async (
    tx: TenantScopedDatabase,
    s: { subjectId: string; clientId: string },
  ): Promise<void> => {
    expect(
      await agentDelegationRepository(tx).activeFor(s.subjectId, s.clientId, NOW),
    ).toHaveLength(1);
  };

  it('activeFor and list find nothing', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedDelegation,
      verifySeeded: stillActive,
      attempt: async (tx, s) => {
        const repo = agentDelegationRepository(tx);
        return [
          await repo.activeFor(s.subjectId, s.clientId, NOW),
          await repo.list(s.subjectId),
          await repo.activeOf(s.subjectId, NOW),
        ];
      },
      expectBlocked: (result) => {
        expect(result).toEqual([[], [], []]);
      },
    });
  });

  it('activeForActor and hasActive find nothing', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedDelegation,
      verifySeeded: stillActive,
      attempt: async (tx, s) => {
        const repo = agentDelegationRepository(tx);
        return [
          await repo.activeForActor(s.subjectId, s.clientId, s.clientId, NOW),
          await repo.hasActive(s.subjectId, s.clientId, NOW),
        ];
      },
      expectBlocked: (result) => {
        expect(result).toEqual([[], false]);
      },
    });
  });

  it('revoke revokes nothing', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedDelegation,
      verifySeeded: stillActive,
      attempt: async (tx, s) => agentDelegationRepository(tx).revoke(s.subjectId, s.id, NOW),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
      verifyTenantAUnaffected: stillActive,
    });
  });

  it('create and createUnderCap refuse a subject of another tenant', async () => {
    const tenantId = newId();
    const foreign = await withTenant(app.db, tenantId, async (tx) => seedOwner(tx, tenantId));
    expect(
      await refusalOf(
        withTenant(app.db, newId(), async (tx) =>
          agentDelegationRepository(tx).create(input(foreign, foreign.clientId)),
        ),
      ),
    ).toMatch(/row-level security/);
    expect(
      await refusalOf(
        withTenant(app.db, newId(), async (tx) =>
          agentDelegationRepository(tx).createUnderCap(input(foreign, foreign.clientId), 20, NOW),
        ),
      ),
    ).toMatch(/row-level security/);
  });
});

describe('agentDelegationRepository for one subject', () => {
  it('revoke leaves another subject of the tenant alone', async () => {
    await inTenant(async (repo, seeded, actor, tx) => {
      const record = await repo.create(input(seeded, actor));
      const stranger = await subjectRepository(tx).create({
        tenantId: seeded.tenantId,
        type: 'user',
      });
      expect(await repo.revoke(stranger.id, record.id, NOW)).toBeNull();
      expect(await repo.hasActive(seeded.ownerId, seeded.clientId, NOW)).toBe(true);
    });
  });

  it('activeOf lists the subject’s live delegations across clients, newest first', async () => {
    await inTenant(async (repo, seeded, actor) => {
      const first = await repo.create(input(seeded, actor));
      const second = await repo.create(input(seeded, actor, { clientId: actor }));
      const gone = await repo.create(input(seeded, actor));
      await repo.revoke(seeded.ownerId, gone.id, NOW);
      await repo.create(input(seeded, actor, { expiresAt: new Date(NOW.getTime() - 1) }));
      const listed = await repo.activeOf(seeded.ownerId, NOW);
      expect(listed.map((row) => row.id).sort()).toEqual([first.id, second.id].sort());
    });
  });
});

describe('createUnderCap', () => {
  const CAP = 20;

  it('creates up to the cap and answers null for the next', async () => {
    await inTenant(async (repo, seeded, actor) => {
      for (let n = 0; n < CAP; n += 1) {
        expect(await repo.createUnderCap(input(seeded, actor), CAP, NOW)).not.toBeNull();
      }
      expect(await repo.createUnderCap(input(seeded, actor), CAP, NOW)).toBeNull();
      expect(await repo.activeOf(seeded.ownerId, NOW)).toHaveLength(CAP);
    });
  });

  it('does not count a revoked or an expired delegation', async () => {
    await inTenant(async (repo, seeded, actor) => {
      const revoked = await repo.create(input(seeded, actor));
      await repo.revoke(seeded.ownerId, revoked.id, NOW);
      await repo.create(input(seeded, actor, { expiresAt: new Date(NOW.getTime() - 1) }));
      for (let n = 0; n < CAP; n += 1) {
        expect(await repo.createUnderCap(input(seeded, actor), CAP, NOW)).not.toBeNull();
      }
      expect(await repo.createUnderCap(input(seeded, actor), CAP, NOW)).toBeNull();
    });
  });

  it('counts per subject: another subject of the tenant has a cap of its own', async () => {
    await inTenant(async (repo, seeded, actor, tx) => {
      for (let n = 0; n < CAP; n += 1) await repo.createUnderCap(input(seeded, actor), CAP, NOW);
      const other = await subjectRepository(tx).create({ tenantId: seeded.tenantId, type: 'user' });
      const made = await repo.createUnderCap(
        input(seeded, actor, { subjectId: other.id }),
        CAP,
        NOW,
      );
      expect(made).not.toBeNull();
    });
  });

  it('admits exactly the cap when thirty creates race', async () => {
    const tenantId = newId();
    const { seeded, actor } = await withTenant(app.db, tenantId, async (tx) => ({
      seeded: await seedOwner(tx, tenantId),
      actor: await secondClient(tx, tenantId),
    }));
    const outcomes = await Promise.all(
      Array.from({ length: 30 }, () =>
        withTenant(app.db, tenantId, (tx) =>
          agentDelegationRepository(tx).createUnderCap(input(seeded, actor), CAP, NOW),
        ),
      ),
    );
    expect(outcomes.filter((outcome) => outcome !== null)).toHaveLength(CAP);
    const live = await withTenant(app.db, tenantId, (tx) =>
      agentDelegationRepository(tx).activeOf(seeded.ownerId, NOW),
    );
    expect(live).toHaveLength(CAP);
  });
});
