import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { subjectRepository } from '@odudu/domain-identity';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentInstanceRepository, type NewAgentInstance } from '#/repository/instances';
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

function input(seeded: Seeded, overrides: Partial<NewAgentInstance> = {}): NewAgentInstance {
  return {
    id: newId(),
    tenantId: seeded.tenantId,
    ownerSubjectId: seeded.ownerId,
    agentClientId: seeded.clientId,
    parentInstanceId: null,
    rootGrantId: seeded.grantId,
    depth: 1,
    scope: 'openid',
    expiresAt: IN_AN_HOUR,
    idleExpiresAt: null,
    ...overrides,
  };
}

async function inTenant<T>(
  fn: (
    repo: ReturnType<typeof agentInstanceRepository>,
    seeded: Seeded,
    tx: Parameters<Parameters<typeof withTenant>[2]>[0],
  ) => Promise<T>,
): Promise<T> {
  const tenantId = newId();
  return withTenant(app.db, tenantId, async (tx) => {
    const seeded = await seedOwner(tx, tenantId);
    return fn(agentInstanceRepository(tx), seeded, tx);
  });
}

describe('agentInstanceRepository', () => {
  it('mints an instance and its agent_instance subject, and reads it back', async () => {
    await inTenant(async (repo, seeded, tx) => {
      const record = await repo.mint(input(seeded, { scope: 'a b' }));
      expect(record).toMatchObject({
        ownerSubjectId: seeded.ownerId,
        parentInstanceId: null,
        depth: 1,
        scope: 'a b',
        revokedAt: null,
      });
      expect(await repo.byId(record.id)).toEqual(record);
      const subject = await tx.execute(sql`select type from subjects where id = ${record.id}`);
      expect((subject as unknown as { type: string }[])[0]?.type).toBe('agent_instance');
    });
  });

  it('refuses a duplicate id', async () => {
    expect(
      await refusalOf(
        inTenant(async (repo, seeded) => {
          const first = await repo.mint(input(seeded));
          await repo.mint(input(seeded, { id: first.id }));
        }),
      ),
    ).toMatch(/duplicate key/);
  });

  it('counts live children and live instances, leaving out revoked and expired ones', async () => {
    await inTenant(async (repo, seeded) => {
      const parent = await repo.mint(input(seeded));
      const live = await repo.mint(input(seeded, { parentInstanceId: parent.id, depth: 2 }));
      const gone = await repo.mint(input(seeded, { parentInstanceId: parent.id, depth: 2 }));
      await repo.mint(
        input(seeded, {
          parentInstanceId: parent.id,
          depth: 2,
          expiresAt: new Date(NOW.getTime() - 3_600_000),
        }),
      );
      await repo.revoke(gone.id, NOW);
      expect(await repo.liveChildren(parent.id, NOW)).toBe(1);
      expect(await repo.liveChildren(live.id, NOW)).toBe(0);
      expect(await repo.liveCount(NOW)).toBe(2);
    });
  });

  it('touch slides the idle expiry, never past the session end', async () => {
    await inTenant(async (repo, seeded) => {
      const idle = await repo.mint(
        input(seeded, { idleExpiresAt: new Date(NOW.getTime() + 60_000) }),
      );
      expect(await repo.touch(idle.id, NOW, 1_800, IN_AN_HOUR)).toBe(true);
      expect((await repo.byId(idle.id))?.idleExpiresAt).toEqual(
        new Date(NOW.getTime() + 1_800_000),
      );
      const sessionEnd = new Date(NOW.getTime() + 300_000);
      expect(await repo.touch(idle.id, NOW, 1_800, sessionEnd)).toBe(true);
      expect((await repo.byId(idle.id))?.idleExpiresAt).toEqual(sessionEnd);
    });
  });

  it('touch never moves the idle expiry backwards when an earlier request lands last', async () => {
    await inTenant(async (repo, seeded) => {
      const idle = await repo.mint(
        input(seeded, { idleExpiresAt: new Date(NOW.getTime() + 60_000) }),
      );
      const later = new Date(NOW.getTime() + 10_000);
      expect(await repo.touch(idle.id, later, 1_800, IN_AN_HOUR)).toBe(true);
      expect(await repo.touch(idle.id, NOW, 1_800, IN_AN_HOUR)).toBe(true);
      expect((await repo.byId(idle.id))?.idleExpiresAt).toEqual(
        new Date(later.getTime() + 1_800_000),
      );
    });
  });

  it('touch refuses a revoked, an idle-expired and a fixed-lifetime instance', async () => {
    await inTenant(async (repo, seeded) => {
      const revoked = await repo.mint(input(seeded, { idleExpiresAt: IN_AN_HOUR }));
      await repo.revoke(revoked.id, NOW);
      const lapsed = await repo.mint(
        input(seeded, { idleExpiresAt: new Date(NOW.getTime() - 1_000) }),
      );
      const fixed = await repo.mint(input(seeded));
      expect(await repo.touch(revoked.id, NOW, 1_800, IN_AN_HOUR)).toBe(false);
      expect(await repo.touch(lapsed.id, NOW, 1_800, IN_AN_HOUR)).toBe(false);
      expect(await repo.touch(fixed.id, NOW, 1_800, IN_AN_HOUR)).toBe(false);
    });
  });

  it('revoke ends the instance and its descendants, once', async () => {
    await inTenant(async (repo, seeded) => {
      const root = await repo.mint(input(seeded));
      const child = await repo.mint(input(seeded, { parentInstanceId: root.id, depth: 2 }));
      const grandchild = await repo.mint(input(seeded, { parentInstanceId: child.id, depth: 3 }));
      const sibling = await repo.mint(input(seeded));
      expect(await repo.revoke(root.id, NOW)).toBe(3);
      expect((await repo.byId(grandchild.id))?.revokedAt).toEqual(NOW);
      expect((await repo.byId(sibling.id))?.revokedAt).toBeNull();
      expect(await repo.revoke(root.id, NOW)).toBe(0);
    });
  });

  it('expireDue revokes what lapsed, then deletes tombstones with their subjects', async () => {
    await inTenant(async (repo, seeded, tx) => {
      const lapsed = await repo.mint(input(seeded, { expiresAt: new Date(NOW.getTime() - 1) }));
      const idleLapsed = await repo.mint(
        input(seeded, { idleExpiresAt: new Date(NOW.getTime() - 1) }),
      );
      const live = await repo.mint(input(seeded));
      const old = await repo.mint(input(seeded));
      await repo.revoke(old.id, new Date(NOW.getTime() - 8 * 86_400_000));

      const tombstoneBefore = new Date(NOW.getTime() - 7 * 86_400_000);
      expect(await repo.expireDue(NOW, tombstoneBefore)).toEqual({ expired: 2, deleted: 1 });
      expect((await repo.byId(lapsed.id))?.revokedAt).toEqual(NOW);
      expect((await repo.byId(idleLapsed.id))?.revokedAt).toEqual(NOW);
      expect((await repo.byId(live.id))?.revokedAt).toBeNull();
      expect(await repo.byId(old.id)).toBeNull();
      const subjects = await tx.execute(sql`select id from subjects where id = ${old.id}`);
      expect((subjects as unknown as unknown[]).length).toBe(0);
      expect(await repo.expireDue(NOW, tombstoneBefore)).toEqual({ expired: 0, deleted: 0 });
    });
  });
});

describe('agentInstanceRepository expireDue below a lapsed instance', () => {
  it('revokes the live children of an instance that lapsed by idle expiry', async () => {
    await inTenant(async (repo, seeded) => {
      const parent = await repo.mint(
        input(seeded, { idleExpiresAt: new Date(NOW.getTime() - 1_000) }),
      );
      const child = await repo.mint(input(seeded, { parentInstanceId: parent.id, depth: 2 }));
      const grandchild = await repo.mint(input(seeded, { parentInstanceId: child.id, depth: 3 }));
      const sibling = await repo.mint(input(seeded));

      const tombstoneBefore = new Date(NOW.getTime() - 7 * 86_400_000);
      expect(await repo.expireDue(NOW, tombstoneBefore)).toEqual({ expired: 3, deleted: 0 });
      expect((await repo.byId(child.id))?.revokedAt).toEqual(NOW);
      expect((await repo.byId(grandchild.id))?.revokedAt).toEqual(NOW);
      expect((await repo.byId(sibling.id))?.revokedAt).toBeNull();
      expect(await repo.liveCount(NOW)).toBe(1);
    });
  });

  it('revokes the live children of an instance that lapsed by expiry', async () => {
    await inTenant(async (repo, seeded) => {
      const parent = await repo.mint(input(seeded, { expiresAt: new Date(NOW.getTime() - 1) }));
      const child = await repo.mint(input(seeded, { parentInstanceId: parent.id, depth: 2 }));
      await repo.expireDue(NOW, new Date(NOW.getTime() - 7 * 86_400_000));
      expect((await repo.byId(child.id))?.revokedAt).toEqual(NOW);
    });
  });
});

describe('agentInstanceRepository tombstones', () => {
  const DAY = 86_400_000;
  const tombstoneBefore = new Date(NOW.getTime() - 7 * DAY);
  const longAgo = new Date(NOW.getTime() - 8 * DAY);

  async function counts(tx: Parameters<Parameters<typeof withTenant>[2]>[0]) {
    const rows = (await tx.execute(sql`
      select
        (select count(*)::int from subjects where type = 'agent_instance') as subjects,
        (select count(*)::int from agent_instances) as instances,
        (select count(*)::int from agent_instances i
          join subjects s on s.id = i.id and s.type = 'agent_instance') as paired`)) as unknown as {
      subjects: number;
      instances: number;
      paired: number;
    }[];
    return rows[0];
  }

  it('keeps a parent until its later-revoked child is removable, then removes both', async () => {
    await inTenant(async (repo, seeded, tx) => {
      const parent = await repo.mint(input(seeded));
      const child = await repo.mint(input(seeded, { parentInstanceId: parent.id, depth: 2 }));
      await repo.mint(input(seeded, { parentInstanceId: child.id, depth: 3 }));
      await repo.revoke(parent.id, longAgo);
      await tx.execute(
        sql`update agent_instances set revoked_at = ${NOW.toISOString()}::timestamptz
             where id <> ${parent.id}`,
      );

      expect(await repo.expireDue(NOW, tombstoneBefore)).toEqual({ expired: 0, deleted: 0 });
      expect(await repo.byId(parent.id)).not.toBeNull();
      expect(await counts(tx)).toEqual({ subjects: 3, instances: 3, paired: 3 });

      const later = new Date(NOW.getTime() + 8 * DAY);
      expect(await repo.expireDue(later, new Date(later.getTime() - 7 * DAY))).toEqual({
        expired: 0,
        deleted: 3,
      });
      expect(await counts(tx)).toEqual({ subjects: 0, instances: 0, paired: 0 });
    });
  });

  it('removes a chain leaf first in one pass and counts every row removed', async () => {
    await inTenant(async (repo, seeded, tx) => {
      const root = await repo.mint(input(seeded));
      const mid = await repo.mint(input(seeded, { parentInstanceId: root.id, depth: 2 }));
      await repo.mint(input(seeded, { parentInstanceId: mid.id, depth: 3 }));
      const survivor = await repo.mint(input(seeded));
      await repo.revoke(root.id, longAgo);

      expect(await repo.expireDue(NOW, tombstoneBefore)).toEqual({ expired: 0, deleted: 3 });
      expect(await counts(tx)).toEqual({ subjects: 1, instances: 1, paired: 1 });
      expect(await repo.byId(survivor.id)).not.toBeNull();
    });
  });
});

describe('agentInstanceRepository page', () => {
  it('lists in id order, a page at a time, after the id it is given', async () => {
    await inTenant(async (repo, seeded) => {
      const made = [];
      for (let i = 0; i < 5; i += 1) made.push(await repo.mint(input(seeded)));
      const ids = made.map((record) => record.id).sort();
      const first = await repo.page({ limit: 3, now: NOW });
      expect(first.map((row) => row.id)).toEqual(ids.slice(0, 3));
      const second = await repo.page({ afterId: ids[2] ?? '', limit: 3, now: NOW });
      expect(second.map((row) => row.id)).toEqual(ids.slice(3));
    });
  });

  it('filters by owner', async () => {
    await inTenant(async (repo, seeded, tx) => {
      const other = await subjectRepository(tx).create({ tenantId: seeded.tenantId, type: 'user' });
      const mine = await repo.mint(input(seeded));
      const theirs = await repo.mint(input(seeded, { ownerSubjectId: other.id }));
      expect(
        (await repo.page({ ownerSubjectId: other.id, limit: 10, now: NOW })).map((r) => r.id),
      ).toEqual([theirs.id]);
      expect(
        (await repo.page({ ownerSubjectId: seeded.ownerId, limit: 10, now: NOW })).map((r) => r.id),
      ).toEqual([mine.id]);
    });
  });

  it('tells live, expired and revoked apart', async () => {
    await inTenant(async (repo, seeded) => {
      const live = await repo.mint(input(seeded));
      const idle = await repo.mint(input(seeded, { idleExpiresAt: new Date(NOW.getTime() - 1) }));
      const lapsed = await repo.mint(input(seeded, { expiresAt: new Date(NOW.getTime() - 1) }));
      const revoked = await repo.mint(input(seeded));
      await repo.revoke(revoked.id, NOW);
      const ids = async (state: 'live' | 'expired' | 'revoked') =>
        (await repo.page({ state, limit: 10, now: NOW })).map((row) => row.id).sort();
      expect(await ids('live')).toEqual([live.id]);
      expect(await ids('expired')).toEqual([idle.id, lapsed.id].sort());
      expect(await ids('revoked')).toEqual([revoked.id]);
      expect((await repo.page({ limit: 10, now: NOW })).length).toBe(4);
    });
  });

  it('combines owner and state', async () => {
    await inTenant(async (repo, seeded, tx) => {
      const other = await subjectRepository(tx).create({ tenantId: seeded.tenantId, type: 'user' });
      await repo.mint(input(seeded));
      const revoked = await repo.mint(input(seeded, { ownerSubjectId: other.id }));
      await repo.mint(input(seeded, { ownerSubjectId: other.id }));
      await repo.revoke(revoked.id, NOW);
      const rows = await repo.page({
        ownerSubjectId: other.id,
        state: 'revoked',
        limit: 10,
        now: NOW,
      });
      expect(rows.map((row) => row.id)).toEqual([revoked.id]);
    });
  });
});

describe('agentInstanceRepository subtree', () => {
  it('names the instance and everything minted beneath it, revoked or not', async () => {
    await inTenant(async (repo, seeded) => {
      const root = await repo.mint(input(seeded));
      const child = await repo.mint(input(seeded, { parentInstanceId: root.id, depth: 2 }));
      const grandchild = await repo.mint(input(seeded, { parentInstanceId: child.id, depth: 3 }));
      const sibling = await repo.mint(input(seeded));
      await repo.revoke(grandchild.id, NOW);
      expect((await repo.subtree(root.id)).sort()).toEqual(
        [root.id, child.id, grandchild.id].sort(),
      );
      expect(await repo.subtree(grandchild.id)).toEqual([grandchild.id]);
      expect(await repo.subtree(sibling.id)).toEqual([sibling.id]);
      expect(await repo.subtree(newId())).toEqual([]);
    });
  });
});

describe('agentInstanceRepository across tenants', () => {
  const seedInstance = async (
    tx: Parameters<Parameters<typeof withTenant>[2]>[0],
    tenantId: string,
  ): Promise<{ id: string; parentId: string; grantId: string }> => {
    const seeded = await seedOwner(tx, tenantId);
    const repo = agentInstanceRepository(tx);
    const parent = await repo.mint(input(seeded, { idleExpiresAt: IN_AN_HOUR }));
    const child = await repo.mint(
      input(seeded, { parentInstanceId: parent.id, depth: 2, idleExpiresAt: IN_AN_HOUR }),
    );
    return { id: child.id, parentId: parent.id, grantId: seeded.grantId };
  };

  const unchanged = async (
    tx: Parameters<Parameters<typeof withTenant>[2]>[0],
    seeded: { id: string },
  ): Promise<void> => {
    const row = await agentInstanceRepository(tx).byId(seeded.id);
    expect(row?.revokedAt).toBeNull();
  };

  it('byId finds nothing', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedInstance,
      verifySeeded: async (tx, s) => {
        expect(await agentInstanceRepository(tx).byId(s.id)).not.toBeNull();
      },
      attempt: async (tx, s) => agentInstanceRepository(tx).byId(s.id),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });

  it('liveChildren and liveCount see none', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedInstance,
      verifySeeded: async (tx, s) => {
        expect(await agentInstanceRepository(tx).liveChildren(s.parentId, NOW)).toBe(1);
      },
      attempt: async (tx, s) => {
        const repo = agentInstanceRepository(tx);
        return [await repo.liveChildren(s.parentId, NOW), await repo.liveCount(NOW)];
      },
      expectBlocked: (result) => {
        expect(result).toEqual([0, 0]);
      },
    });
  });

  it('lockForUpdate, lockGrant and liveRoots see none', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedInstance,
      verifySeeded: async (tx, s) => {
        const repo = agentInstanceRepository(tx);
        expect((await repo.lockForUpdate(s.parentId))?.id).toBe(s.parentId);
        expect(await repo.lockGrant(s.grantId)).toBe(true);
        expect(await repo.liveRoots(s.grantId, NOW)).toBe(1);
      },
      attempt: async (tx, s) => {
        const repo = agentInstanceRepository(tx);
        return [
          await repo.lockForUpdate(s.parentId),
          await repo.lockGrant(s.grantId),
          await repo.liveRoots(s.grantId, NOW),
        ];
      },
      expectBlocked: (result) => {
        expect(result).toEqual([null, false, 0]);
      },
    });
  });

  it('page lists none, whatever the owner or state asked for', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        const seeded = await seedInstance(tx, tenantId);
        const owner = (await agentInstanceRepository(tx).byId(seeded.id))?.ownerSubjectId;
        return { ...seeded, owner: owner ?? '' };
      },
      verifySeeded: async (tx) => {
        expect(await agentInstanceRepository(tx).page({ limit: 10, now: NOW })).toHaveLength(2);
      },
      attempt: async (tx, s) => {
        const repo = agentInstanceRepository(tx);
        return [
          await repo.page({ limit: 10, now: NOW }),
          await repo.page({ ownerSubjectId: s.owner, limit: 10, now: NOW }),
          await repo.page({ ownerSubjectId: s.owner, state: 'live', limit: 10, now: NOW }),
        ];
      },
      expectBlocked: (result) => {
        expect(result).toEqual([[], [], []]);
      },
    });
  });

  it('subtree names nothing', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedInstance,
      verifySeeded: async (tx, s) => {
        expect(await agentInstanceRepository(tx).subtree(s.parentId)).toHaveLength(2);
      },
      attempt: async (tx, s) => agentInstanceRepository(tx).subtree(s.parentId),
      expectBlocked: (result) => {
        expect(result).toEqual([]);
      },
    });
  });

  it('touch changes nothing', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedInstance,
      verifySeeded: unchanged,
      attempt: async (tx, s) => agentInstanceRepository(tx).touch(s.id, NOW, 60, IN_AN_HOUR),
      expectBlocked: (result) => {
        expect(result).toBe(false);
      },
      verifyTenantAUnaffected: unchanged,
    });
  });

  it('revoke revokes nothing', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedInstance,
      verifySeeded: unchanged,
      attempt: async (tx, s) => agentInstanceRepository(tx).revoke(s.parentId, NOW),
      expectBlocked: (result) => {
        expect(result).toBe(0);
      },
      verifyTenantAUnaffected: unchanged,
    });
  });

  it('expireDue touches nothing', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedInstance,
      verifySeeded: unchanged,
      attempt: async (tx) =>
        agentInstanceRepository(tx).expireDue(new Date(NOW.getTime() + 10 * 86_400_000), NOW),
      expectBlocked: (result) => {
        expect(result).toEqual({ expired: 0, deleted: 0 });
      },
      verifyTenantAUnaffected: unchanged,
    });
  });

  it('mint refuses an owner of another tenant', async () => {
    const tenantId = newId();
    const foreign = await withTenant(app.db, tenantId, async (tx) => seedOwner(tx, tenantId));
    expect(
      await refusalOf(
        withTenant(app.db, newId(), async (tx) => agentInstanceRepository(tx).mint(input(foreign))),
      ),
    ).toMatch(/row-level security/);
  });
});
