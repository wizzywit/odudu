import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { clients } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
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
  ) => Promise<T>,
): Promise<T> {
  const tenantId = newId();
  return withTenant(app.db, tenantId, async (tx) => {
    const seeded = await seedOwner(tx, tenantId);
    return fn(agentDelegationRepository(tx), seeded, await secondClient(tx, tenantId));
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
      expect(await repo.revoke(revoked.id, NOW)).toBe(true);
      expect(await repo.revoke(revoked.id, NOW)).toBe(false);
      const active = await repo.activeFor(seeded.ownerId, seeded.clientId, NOW);
      expect(active.map((row) => row.id)).toEqual([kept.id]);
      expect(await repo.list(seeded.ownerId)).toHaveLength(4);
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
        return [await repo.activeFor(s.subjectId, s.clientId, NOW), await repo.list(s.subjectId)];
      },
      expectBlocked: (result) => {
        expect(result).toEqual([[], []]);
      },
    });
  });

  it('revoke revokes nothing', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedDelegation,
      verifySeeded: stillActive,
      attempt: async (tx, s) => agentDelegationRepository(tx).revoke(s.id, NOW),
      expectBlocked: (result) => {
        expect(result).toBe(false);
      },
      verifyTenantAUnaffected: stillActive,
    });
  });

  it('create refuses a subject of another tenant', async () => {
    const tenantId = newId();
    const foreign = await withTenant(app.db, tenantId, async (tx) => seedOwner(tx, tenantId));
    expect(
      await refusalOf(
        withTenant(app.db, newId(), async (tx) =>
          agentDelegationRepository(tx).create(input(foreign, foreign.clientId)),
        ),
      ),
    ).toMatch(/row-level security/);
  });
});
