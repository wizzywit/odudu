import { createDatabase, MIGRATIONS_DIR, runMigrations, tenants, withTenant } from '@odudu/db';
import type { DatabaseHandle, TenantScopedDatabase } from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { provisionTenant, SessionEntry, sessionRepository } from '@odudu/authn-flows';
import {
  agentInstanceRepository,
  lockLineageRoots,
  STRUCTURAL_MAX_DEPTH,
} from '@odudu/domain-agents';
import { subjectRepository } from '@odudu/domain-identity';
import { clientRepository, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tokenGrantRepository } from '#/repository/grants';
import { withHeldLock } from '#/testing/agent-fixture';

function nth<T>(list: readonly T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new Error(`no item at ${String(index)}`);
  return item;
}

const NOW = new Date(Math.floor(Date.now() / 1000) * 1000);
const LATER = new Date(NOW.getTime() + 60_000);

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let countedHandle: DatabaseHandle | undefined;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let counted: DatabaseHandle;
let statements: string[] = [];

interface World {
  tenantId: string;
  clientDbId: string;
  subjectId: string;
  sessionId: string;
}

async function newWorld(): Promise<World> {
  const tenantId = newId();
  return withTenant(app.db, tenantId, (tx) => worldIn(tx, tenantId));
}

async function worldIn(tx: TenantScopedDatabase, tenantId: string): Promise<World> {
  {
    await tx.insert(tenants).values({ id: tenantId, name: `cascade-${newId()}` });
    await provisionTenant(tx, tenantId);
    const client = await clientRepository(tx).create({
      tenantId,
      clientId: `c-${newId()}`,
      name: 'c',
      type: 'public',
      secretHash: null,
    });
    await provisionClientDefaults(tx, client.id);
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    const sessionId = newId();
    await sessionRepository(tx).create({
      id: sessionId,
      tenantId,
      subjectId: subject.id,
      expiresAt: new Date(NOW.getTime() + 24 * 3600 * 1000),
      authenticators: ['pwd'],
      secretHash: SessionEntry.issue(sessionId).secretHash(),
    });
    return { tenantId, clientDbId: client.id, subjectId: subject.id, sessionId };
  }
}

async function grant(
  tx: TenantScopedDatabase,
  w: World,
  over: { from?: string | undefined; sessionless?: boolean; actor?: string | undefined } = {},
): Promise<string> {
  const id = newId();
  await tokenGrantRepository(tx).create({
    id,
    tenantId: w.tenantId,
    clientId: w.clientDbId,
    subjectId: w.subjectId,
    scope: 'mcp:read',
    audience: ['https://odudu.test/mcp'],
    sessionId: over.from === undefined && over.sessionless !== true ? w.sessionId : null,
    exchangedFromGrantId: over.from ?? null,
    actorSubjectId: over.actor ?? null,
  });
  return id;
}

async function chain(tx: TenantScopedDatabase, w: World, length: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < length; i += 1) {
    ids.push(await grant(tx, w, { from: ids[i - 1] }));
  }
  return ids;
}

async function twoOf(tx: TenantScopedDatabase, w: World): Promise<[string, string]> {
  const [a, b] = await chain(tx, w, 2);
  if (a === undefined || b === undefined) throw new Error('chain is short');
  return [a, b];
}

async function instanceAt(
  tx: TenantScopedDatabase,
  w: World,
  rootGrantId: string,
  parentInstanceId: string | null = null,
): Promise<string> {
  const id = newId();
  await agentInstanceRepository(tx).mint({
    id,
    tenantId: w.tenantId,
    ownerSubjectId: w.subjectId,
    agentClientId: w.clientDbId,
    parentInstanceId,
    rootGrantId,
    depth: parentInstanceId === null ? 1 : 2,
    scope: 'mcp:read',
    expiresAt: new Date(NOW.getTime() + 900_000),
    idleExpiresAt: null,
  });
  return id;
}

async function grantRevoked(ids: readonly string[]): Promise<boolean[]> {
  const rows = await owner.db.execute(
    sql`select id, revoked_at is not null as revoked from token_grants`,
  );
  const byId = new Map(
    (rows as unknown as { id: string; revoked: boolean }[]).map((r) => [r.id, r.revoked]),
  );
  return ids.map((id) => byId.get(id) === true);
}

async function instanceRevoked(ids: readonly string[]): Promise<boolean[]> {
  const rows = await owner.db.execute(
    sql`select id, revoked_at is not null as revoked from agent_instances`,
  );
  const byId = new Map(
    (rows as unknown as { id: string; revoked: boolean }[]).map((r) => [r.id, r.revoked]),
  );
  return ids.map((id) => byId.get(id) === true);
}

async function auditRows(w: World) {
  const rows = await owner.db.execute(
    sql`select action, event_type, resource_id, detail from audit_events
         where tenant_id = ${w.tenantId} and action = 'agent.instance_revoked'
         order by resource_id`,
  );
  return rows as unknown as {
    action: string;
    event_type: string;
    resource_id: string;
    detail: Record<string, unknown>;
  }[];
}

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(containerHandle.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  app = appHandle;
  countedHandle = createDatabase(appUrl, {
    max: 1,
    onQueryForTests: (query) => {
      statements.push(query);
    },
  });
  counted = countedHandle;
}, 120_000);

afterAll(async () => {
  await countedHandle?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('revokeCascade over a chain of exchanged grants', () => {
  it('revokes the root, all five below it and every instance rooted at any of them', async () => {
    const w = await newWorld();
    const { ids, rooted } = await withTenant(app.db, w.tenantId, async (tx) => {
      const ids = await chain(tx, w, 6);
      const rooted = [await instanceAt(tx, w, nth(ids, 0)), await instanceAt(tx, w, nth(ids, 3))];
      return { ids, rooted };
    });
    const result = await withTenant(app.db, w.tenantId, (tx) =>
      tokenGrantRepository(tx).revokeCascade([nth(ids, 0)], LATER),
    );
    expect(result).toMatchObject({ grants: 6, instances: 2, capped: false });
    expect(await grantRevoked(ids)).toEqual(Array(6).fill(true));
    expect(await instanceRevoked(rooted)).toEqual([true, true]);
  });

  it('revokes the instances beneath a rooted instance as well', async () => {
    const w = await newWorld();
    const { id, instances } = await withTenant(app.db, w.tenantId, async (tx) => {
      const id = await grant(tx, w);
      const top = await instanceAt(tx, w, id);
      return { id, instances: [top, await instanceAt(tx, w, id, top)] };
    });
    const result = await withTenant(app.db, w.tenantId, (tx) =>
      tokenGrantRepository(tx).revokeCascade([id], LATER),
    );
    expect(result).toMatchObject({ grants: 1, instances: 2 });
    expect(await instanceRevoked(instances)).toEqual([true, true]);
  });

  it('leaves the ancestors of a middle grant live', async () => {
    const w = await newWorld();
    const ids = await withTenant(app.db, w.tenantId, (tx) => chain(tx, w, 6));
    const result = await withTenant(app.db, w.tenantId, (tx) =>
      tokenGrantRepository(tx).revokeCascade([nth(ids, 3)], LATER),
    );
    expect(result).toMatchObject({ grants: 3, capped: false });
    expect(await grantRevoked(ids)).toEqual([false, false, false, true, true, true]);
  });

  it('does not count a descendant that was already revoked', async () => {
    const w = await newWorld();
    const ids = await withTenant(app.db, w.tenantId, (tx) => chain(tx, w, 4));
    await withTenant(app.db, w.tenantId, (tx) =>
      tokenGrantRepository(tx).revokeCascade([nth(ids, 2)], NOW),
    );
    const result = await withTenant(app.db, w.tenantId, (tx) =>
      tokenGrantRepository(tx).revokeCascade([nth(ids, 0)], LATER),
    );
    expect(result).toMatchObject({ grants: 2, instances: 0 });
    const stamps = await owner.db.execute(
      sql`select id, revoked_at from token_grants where id = ${nth(ids, 3)}`,
    );
    expect(new Date(nth(stamps as unknown as { revoked_at: Date }[], 0).revoked_at).getTime()).toBe(
      NOW.getTime(),
    );
  });

  it('revokes nothing for an id that is not a grant', async () => {
    const w = await newWorld();
    const result = await withTenant(app.db, w.tenantId, (tx) =>
      tokenGrantRepository(tx).revokeCascade([newId()], LATER),
    );
    expect(result).toMatchObject({ grants: 0, instances: 0, capped: false });
  });

  it.each([STRUCTURAL_MAX_DEPTH + 3, 40])(
    'revokes a chain of %i grants and the instances rooted along it',
    async (length) => {
      const w = await newWorld();
      const { ids, rooted } = await withTenant(app.db, w.tenantId, async (tx) => {
        const ids = await chain(tx, w, length);
        const rooted = [
          await instanceAt(tx, w, nth(ids, 0)),
          await instanceAt(tx, w, nth(ids, STRUCTURAL_MAX_DEPTH + 1)),
          await instanceAt(tx, w, nth(ids, length - 1)),
        ];
        return { ids, rooted };
      });
      const result = await withTenant(app.db, w.tenantId, (tx) =>
        tokenGrantRepository(tx).revokeCascade([nth(ids, 0)], LATER),
      );
      expect(result).toMatchObject({ grants: length, instances: 3, capped: false });
      expect(await grantRevoked(ids)).toEqual(Array(length).fill(true));
      expect(await instanceRevoked(rooted)).toEqual([true, true, true]);
    },
  );

  it('revokes a chain of 40 through revoke(), however deep it runs', async () => {
    const w = await newWorld();
    const ids = await withTenant(app.db, w.tenantId, (tx) => chain(tx, w, 40));
    await withTenant(app.db, w.tenantId, (tx) =>
      tokenGrantRepository(tx).revoke(nth(ids, 0), LATER),
    );
    expect(await grantRevoked(ids)).toEqual(Array(40).fill(true));
  });
});

describe('revokeCascade over a fan-out', () => {
  it('revokes a shallow fan-out of 1,000 grants in one pass, one statement', async () => {
    const w = await newWorld();
    const root = await withTenant(app.db, w.tenantId, (tx) => grant(tx, w));
    await owner.db.execute(sql`
      insert into token_grants (id, tenant_id, client_id, subject_id, scope, audience, exchanged_from_grant_id)
      select gen_random_uuid(), ${w.tenantId}::uuid, ${w.clientDbId}::uuid, ${w.subjectId}::uuid,
             'mcp:read', array['https://odudu.test/mcp'], ${root}::uuid
        from generate_series(1, 1000)`);
    statements = [];
    const result = await withTenant(counted.db, w.tenantId, async (tx) => {
      statements = [];
      return tokenGrantRepository(tx).revokeCascade([root], LATER);
    });
    expect(result).toMatchObject({ grants: 1001, capped: false });
    expect(statements.filter((query) => query !== 'commit')).toHaveLength(1);
  });

  it('revokes what fits under the cap, reports capped and leaves the rest live', async () => {
    const w = await newWorld();
    const root = await withTenant(app.db, w.tenantId, (tx) => grant(tx, w));
    await owner.db.execute(sql`
      insert into token_grants (id, tenant_id, client_id, subject_id, scope, audience, exchanged_from_grant_id)
      select gen_random_uuid(), ${w.tenantId}::uuid, ${w.clientDbId}::uuid, ${w.subjectId}::uuid,
             'mcp:read', array['https://odudu.test/mcp'], ${root}::uuid
        from generate_series(1, 50)`);
    const first = await withTenant(app.db, w.tenantId, (tx) =>
      tokenGrantRepository(tx).revokeCascade([root], LATER, 20),
    );
    expect(first).toMatchObject({ grants: 20, capped: true });
    const live = await owner.db.execute(
      sql`select count(*)::int as n from token_grants where tenant_id = ${w.tenantId} and revoked_at is null`,
    );
    expect((live as unknown as { n: number }[])[0]?.n).toBe(31);
  });

  it('finishes the rest when called again, each pass making progress', async () => {
    const w = await newWorld();
    const root = await withTenant(app.db, w.tenantId, (tx) => grant(tx, w));
    await owner.db.execute(sql`
      insert into token_grants (id, tenant_id, client_id, subject_id, scope, audience, exchanged_from_grant_id)
      select gen_random_uuid(), ${w.tenantId}::uuid, ${w.clientDbId}::uuid, ${w.subjectId}::uuid,
             'mcp:read', array['https://odudu.test/mcp'], ${root}::uuid
        from generate_series(1, 50)`);
    let total = 0;
    for (let pass = 0; pass < 10; pass += 1) {
      const r = await withTenant(app.db, w.tenantId, (tx) =>
        tokenGrantRepository(tx).revokeCascade([root], LATER, 20),
      );
      total += r.grants;
      if (!r.capped) break;
    }
    expect(total).toBe(51);
  });
});

describe('every revoke method cascades and keeps its return value', () => {
  async function exchanged(w: World, over: { actor?: string | undefined } = {}) {
    return withTenant(app.db, w.tenantId, async (tx) => {
      const root = await grant(tx, w, { actor: over.actor });
      const ids = [root, await grant(tx, w, { from: root }), await grant(tx, w, { from: root })];
      const child = nth(ids, 1);
      const grandchild = await grant(tx, w, { from: child });
      ids.push(grandchild);
      const instance = await instanceAt(tx, w, grandchild);
      return { root, ids, instance };
    });
  }

  it('revoke(id) returns true once, then false, and ends what was exchanged from it', async () => {
    const w = await newWorld();
    const { root, ids, instance } = await exchanged(w);
    const first = await withTenant(app.db, w.tenantId, (tx) =>
      tokenGrantRepository(tx).revoke(root, LATER),
    );
    const second = await withTenant(app.db, w.tenantId, (tx) =>
      tokenGrantRepository(tx).revoke(root, LATER),
    );
    expect([first, second]).toEqual([true, false]);
    expect(await grantRevoked(ids)).toEqual(Array(4).fill(true));
    expect(await instanceRevoked([instance])).toEqual([true]);
  });

  it('revokeForSession returns the grants bound to the session', async () => {
    const w = await newWorld();
    const { ids, instance } = await exchanged(w);
    const n = await withTenant(app.db, w.tenantId, (tx) =>
      tokenGrantRepository(tx).revokeForSession(w.sessionId, LATER),
    );
    expect(n).toBe(1);
    expect(await grantRevoked(ids)).toEqual(Array(4).fill(true));
    expect(await instanceRevoked([instance])).toEqual([true]);
  });

  it('revokeForSessions returns the grants bound to the sessions', async () => {
    const w = await newWorld();
    const { ids, instance } = await exchanged(w);
    const n = await withTenant(app.db, w.tenantId, (tx) =>
      tokenGrantRepository(tx).revokeForSessions([w.sessionId], LATER),
    );
    expect(n).toBe(1);
    expect(await grantRevoked(ids)).toEqual(Array(4).fill(true));
    expect(await instanceRevoked([instance])).toEqual([true]);
  });

  it('revokeForSubjectClient returns the live grants of the pair, descendants not counted', async () => {
    const w = await newWorld();
    const { ids, instance } = await exchanged(w);
    const n = await withTenant(app.db, w.tenantId, (tx) =>
      tokenGrantRepository(tx).revokeForSubjectClient(w.subjectId, w.clientDbId, LATER),
    );
    expect(n).toBe(4);
    expect(await grantRevoked(ids)).toEqual(Array(4).fill(true));
    expect(await instanceRevoked([instance])).toEqual([true]);
  });

  it('revokeForSubject ends the exchanged grants of a client the subject holds', async () => {
    const w = await newWorld();
    const { ids, instance } = await exchanged(w);
    const n = await withTenant(app.db, w.tenantId, (tx) =>
      tokenGrantRepository(tx).revokeForSubject(w.subjectId, LATER),
    );
    expect(n).toBe(4);
    expect(await grantRevoked(ids)).toEqual(Array(4).fill(true));
    expect(await instanceRevoked([instance])).toEqual([true]);
  });

  it('revokeForActor returns the grants the actor acted in and ends what came from them', async () => {
    const w = await newWorld();
    const actor = await withTenant(app.db, w.tenantId, (tx) =>
      subjectRepository(tx).create({ tenantId: w.tenantId, type: 'service' }),
    );
    const { ids, instance } = await exchanged(w, { actor: actor.id });
    const n = await withTenant(app.db, w.tenantId, (tx) =>
      tokenGrantRepository(tx).revokeForActor(actor.id),
    );
    expect(n).toBe(1);
    expect(await grantRevoked(ids)).toEqual(Array(4).fill(true));
    expect(await instanceRevoked([instance])).toEqual([true]);
  });

  it('a revoke method finishes a cascade past the default cap', async () => {
    const w = await newWorld();
    const root = await withTenant(app.db, w.tenantId, (tx) => grant(tx, w));
    await owner.db.execute(sql`
      insert into token_grants (id, tenant_id, client_id, subject_id, scope, audience, exchanged_from_grant_id)
      select gen_random_uuid(), ${w.tenantId}::uuid, ${w.clientDbId}::uuid, ${w.subjectId}::uuid,
             'mcp:read', array['https://odudu.test/mcp'], ${root}::uuid
        from generate_series(1, 10500)`);
    await withTenant(app.db, w.tenantId, (tx) => tokenGrantRepository(tx).revoke(root, LATER));
    const live = await owner.db.execute(
      sql`select count(*)::int as n from token_grants where tenant_id = ${w.tenantId} and revoked_at is null`,
    );
    expect((live as unknown as { n: number }[])[0]?.n).toBe(0);
  }, 60_000);
});

describe('revokeForActors', () => {
  async function actors(w: World, count: number) {
    return withTenant(app.db, w.tenantId, async (tx) => {
      const made: string[] = [];
      for (let i = 0; i < count; i += 1) {
        made.push(
          (await subjectRepository(tx).create({ tenantId: w.tenantId, type: 'service' })).id,
        );
      }
      return made;
    });
  }

  it('revokes what each actor acted in, what was exchanged from it and the instances rooted there', async () => {
    const w = await newWorld();
    const made = await actors(w, 2);
    const a = nth(made, 0);
    const b = nth(made, 1);
    const held = await withTenant(app.db, w.tenantId, async (tx) => {
      const first = await grant(tx, w, { actor: a });
      const below = await grant(tx, w, { from: first });
      const second = await grant(tx, w, { actor: b });
      const untouched = await grant(tx, w);
      return { first, below, second, untouched, instance: await instanceAt(tx, w, below) };
    });
    const result = await withTenant(app.db, w.tenantId, (tx) =>
      tokenGrantRepository(tx).revokeForActors([a, b], LATER),
    );
    expect(result).toEqual({ grants: 3, instances: 1 });
    expect(await grantRevoked([held.first, held.below, held.second, held.untouched])).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(await instanceRevoked([held.instance])).toEqual([true]);
    const again = await withTenant(app.db, w.tenantId, (tx) =>
      tokenGrantRepository(tx).revokeForActors([a], LATER),
    );
    expect(again).toEqual({ grants: 0, instances: 0 });
  });

  it('answers nothing for no actor', async () => {
    const w = await newWorld();
    expect(
      await withTenant(app.db, w.tenantId, (tx) =>
        tokenGrantRepository(tx).revokeForActors([], LATER),
      ),
    ).toEqual({ grants: 0, instances: 0 });
  });

  it('revokes nothing of another tenant', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        const w = await worldIn(tx, tenantId);
        const actor = await subjectRepository(tx).create({ tenantId, type: 'service' });
        return { id: await grant(tx, w, { actor: actor.id }), actor: actor.id };
      },
      verifySeeded: async (tx, seeded) => {
        expect(await tokenGrantRepository(tx).byId(seeded.id)).not.toBeNull();
      },
      attempt: (tx, seeded) => tokenGrantRepository(tx).revokeForActors([seeded.actor], LATER),
      expectBlocked: (result) => {
        expect(result).toEqual({ grants: 0, instances: 0 });
      },
      verifyTenantAUnaffected: async (_tx, seeded) => {
        expect(await grantRevoked([seeded.id])).toEqual([false]);
      },
    });
  });
});

describe('the audit row for a revoked instance', () => {
  it('writes one agent.instance_revoked per instance root with allowlisted detail', async () => {
    const w = await newWorld();
    const { root, top, other } = await withTenant(app.db, w.tenantId, async (tx) => {
      const [a, b] = await twoOf(tx, w);
      const top = await instanceAt(tx, w, b);
      await instanceAt(tx, w, b, top);
      const other = await instanceAt(tx, w, a);
      return { root: a, top, other };
    });
    await withTenant(app.db, w.tenantId, (tx) => tokenGrantRepository(tx).revoke(root, LATER));
    const rows = await auditRows(w);
    expect(rows.map((r) => r.resource_id).sort()).toEqual([other, top].sort());
    for (const row of rows) {
      expect(row).toMatchObject({ action: 'agent.instance_revoked', event_type: 'agent_identity' });
      expect(Object.keys(row.detail).sort()).toEqual(
        ['agent_client', 'count', 'depth', 'instance', 'owner', 'via'].sort(),
      );
      expect(row.detail.via).toBe('cascade');
      expect(row.detail.owner).toBe(w.subjectId);
    }
    expect(rows.find((r) => r.resource_id === top)?.detail.count).toBe(2);
    expect(rows.find((r) => r.resource_id === other)?.detail.count).toBe(1);
  });

  it('writes no instance row for a cascade that revokes no instance', async () => {
    const w = await newWorld();
    const root = await withTenant(app.db, w.tenantId, async (tx) => {
      return nth(await chain(tx, w, 3), 0);
    });
    await withTenant(app.db, w.tenantId, (tx) => tokenGrantRepository(tx).revoke(root, LATER));
    expect(await auditRows(w)).toEqual([]);
  });

  it('writes none again when the second revoke changes nothing', async () => {
    const w = await newWorld();
    const root = await withTenant(app.db, w.tenantId, async (tx) => {
      const id = await grant(tx, w);
      await instanceAt(tx, w, id);
      return id;
    });
    await withTenant(app.db, w.tenantId, (tx) => tokenGrantRepository(tx).revoke(root, LATER));
    await withTenant(app.db, w.tenantId, (tx) => tokenGrantRepository(tx).revoke(root, LATER));
    expect(await auditRows(w)).toHaveLength(1);
  });
});

describe('revokeCascade is tenant scoped', () => {
  it('revokes nothing of another tenant and leaves its rows alone', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        const w = await worldIn(tx, tenantId);
        const [root, child] = await twoOf(tx, w);
        const instance = await instanceAt(tx, w, child);
        return { ids: [root, child], instance };
      },
      verifySeeded: async (tx, seeded) => {
        expect(await tokenGrantRepository(tx).byId(nth(seeded.ids, 0))).not.toBeNull();
      },
      attempt: (tx, seeded) => tokenGrantRepository(tx).revokeCascade([nth(seeded.ids, 0)], LATER),
      expectBlocked: (result) => {
        expect(result).toMatchObject({ grants: 0, instances: 0, capped: false });
      },
      verifyTenantAUnaffected: async (_tx, seeded) => {
        expect(await grantRevoked(seeded.ids)).toEqual([false, false]);
        expect(await instanceRevoked([seeded.instance])).toEqual([false]);
      },
    });
  });
});

describe('revokeCascade over random delegation trees', () => {
  it('revokes exactly the descendants of the node it is given', async () => {
    const w = await newWorld();
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 3 }), fc.nat()), {
          minLength: 14,
          maxLength: 30,
        }),
        fc.nat(),
        async (picks, pick) => {
          const parentIdx: number[] = [-1];
          const depth = [0];
          for (const [deepen, p] of picks) {
            const parent = deepen > 0 ? parentIdx.length - 1 : p % parentIdx.length;
            parentIdx.push(parent);
            depth.push(nth(depth, parent) + 1);
          }
          const made = await withTenant(app.db, w.tenantId, async (tx) => {
            const ids: string[] = [];
            for (const parent of parentIdx) {
              ids.push(
                await grant(tx, w, {
                  from: parent < 0 ? undefined : ids[parent],
                  sessionless: true,
                }),
              );
            }
            return ids;
          });
          const target = pick % made.length;
          const expected = made.map((_, i) => {
            for (let at = i; at >= 0; at = nth(parentIdx, at)) if (at === target) return true;
            return false;
          });
          const result = await withTenant(app.db, w.tenantId, (tx) =>
            tokenGrantRepository(tx).revokeCascade([nth(made, target)], LATER),
          );
          expect(await grantRevoked(made)).toEqual(expected);
          expect(result.grants).toBe(expected.filter(Boolean).length);
        },
      ),
      { numRuns: 25 },
    );
  }, 120_000);
});

describe('a child made while its parent is being revoked', () => {
  async function orphans(w: World): Promise<number> {
    const rows = await owner.db.execute(
      sql`select count(*)::int as n from token_grants c join token_grants p on p.id = c.exchanged_from_grant_id
           where c.tenant_id = ${w.tenantId} and c.revoked_at is null and p.revoked_at is not null`,
    );
    return (rows as unknown as { n: number }[])[0]?.n ?? -1;
  }

  // What the exchange does for the grant it derives from: lock the parent
  // live, make the child, and commit only when told.
  async function exchangeHolding(w: World, parent: string, release: Promise<void>) {
    let made!: () => void;
    const madeChild = new Promise<void>((resolve) => {
      made = resolve;
    });
    const done = withTenant(app.db, w.tenantId, async (tx) => {
      try {
        if (!(await tokenGrantRepository(tx).lockLive(parent))) return false;
        await grant(tx, w, { from: parent, sessionless: true });
        made();
        await release;
        return true;
      } finally {
        made();
      }
    });
    await madeChild;
    return { done };
  }

  it.each([
    ['the parent', 0],
    ['an ancestor of the parent', 1],
  ])(
    'leaves no live child under a revoked grant when revoking %s',
    async (_, up) => {
      for (let round = 0; round < 6; round += 1) {
        const w = await newWorld();
        const ids = await withTenant(app.db, w.tenantId, (tx) => chain(tx, w, 3));
        const parent = nth(ids, 2);
        const target = nth(ids, 2 - up);
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        const exchange = (await exchangeHolding(w, parent, held)).done;
        const revoking = withTenant(app.db, w.tenantId, (tx) =>
          tokenGrantRepository(tx).revoke(target, LATER),
        );
        await new Promise((resolve) => setTimeout(resolve, 150));
        release();
        await Promise.all([exchange, revoking]);
        expect(await orphans(w)).toBe(0);
      }
    },
    60_000,
  );

  it('refuses the exchange once the parent was revoked first', async () => {
    const w = await newWorld();
    const parent = nth(await withTenant(app.db, w.tenantId, (tx) => chain(tx, w, 1)), 0);
    await withTenant(app.db, w.tenantId, (tx) => tokenGrantRepository(tx).revoke(parent, LATER));
    const outcome = await (await exchangeHolding(w, parent, Promise.resolve())).done;
    expect(outcome).toBe(false);
    expect(await orphans(w)).toBe(0);
  });
});

describe('a cascade takes the grants before any instance', () => {
  // A transaction of the test holds a grant under the one revoked, so the
  // cascade has to wait for it. An exchange takes a grant and then an
  // instance; a cascade that has already taken the instance would deadlock
  // against it.
  it('leaves the instances unlocked while it waits for a grant', async () => {
    const w = await newWorld();
    const { top, below, instance } = await withTenant(app.db, w.tenantId, async (tx) => {
      const [top, below] = await twoOf(tx, w);
      return { top, below, instance: await instanceAt(tx, w, below) };
    });
    const probe = await withHeldLock(
      app.db,
      w.tenantId,
      {
        lock: async (tx) => {
          await tx.execute(sql`select id from token_grants where id = ${below} for update`);
        },
      },
      async (held) => {
        const cascading = held.started(
          withTenant(app.db, w.tenantId, (tx) =>
            tokenGrantRepository(tx).revokeCascade([top], LATER),
          ),
        );
        await held.waitForWaiters(owner);
        const result = await owner.db
          .transaction((tx) =>
            tx.execute(
              sql`select id from agent_instances where id = ${instance} for update nowait`,
            ),
          )
          .then(
            () => null,
            (error: unknown) => error,
          );
        held.release();
        await Promise.all([cascading, held.done]);
        return result;
      },
    );
    expect(probe).toBeNull();
    expect(await instanceRevoked([instance])).toEqual([true]);
  });
});

describe('a revoke over many grants takes them in id order', () => {
  // Grants made in descending id order, so that the order rows sit in the
  // table is the opposite of id order.
  async function overlapping(w: World, count: number): Promise<string[]> {
    const ids = Array.from({ length: count }, () => newId())
      .sort()
      .reverse();
    await withTenant(app.db, w.tenantId, async (tx) => {
      for (const id of ids) {
        await tokenGrantRepository(tx).create({
          id,
          tenantId: w.tenantId,
          clientId: w.clientDbId,
          subjectId: w.subjectId,
          scope: 'mcp:read',
          audience: ['https://odudu.test/mcp'],
          sessionId: null,
        });
      }
    });
    return ids.sort();
  }

  it('does not touch a later grant while it waits for an earlier one', async () => {
    const w = await newWorld();
    const [lowest, , highest] = await overlapping(w, 3);
    const probe = await withHeldLock(
      app.db,
      w.tenantId,
      {
        lock: async (tx) => {
          await tx.execute(
            sql`select id from token_grants where id = ${nth([lowest], 0)} for update`,
          );
        },
      },
      async (held) => {
        const revoking = held.started(
          withTenant(app.db, w.tenantId, (tx) =>
            tokenGrantRepository(tx).revokeForSubject(w.subjectId, LATER),
          ),
        );
        await held.waitForWaiters(owner);
        const result = await owner.db
          .transaction((tx) =>
            tx.execute(
              sql`select id from token_grants where id = ${nth([highest], 0)} for update nowait`,
            ),
          )
          .then(
            () => null,
            (error: unknown) => error,
          );
        held.release();
        await Promise.all([revoking, held.done]);
        return result;
      },
    );
    expect(probe).toBeNull();
  });

  it('lets two revokes over the same grants both finish, without a deadlock', async () => {
    for (let round = 0; round < 8; round += 1) {
      const w = await newWorld();
      await overlapping(w, 12);
      const failures: unknown[] = [];
      const attempt = (run: (g: ReturnType<typeof tokenGrantRepository>) => Promise<unknown>) =>
        withTenant(app.db, w.tenantId, (tx) => run(tokenGrantRepository(tx))).catch(
          (error: unknown) => failures.push(error),
        );
      await Promise.all([
        attempt((g) => g.revokeForSubject(w.subjectId, LATER)),
        attempt((g) => g.revokeForSubjectClient(w.subjectId, w.clientDbId, LATER)),
        attempt((g) => g.revokeForSubject(w.subjectId, LATER)),
      ]);
      expect(failures).toEqual([]);
    }
  });
});

describe('revokes that seed a grant and its descendant', () => {
  async function pair(w: World, descendantFirst: boolean): Promise<[string, string]> {
    const [a, b] = [newId(), newId()];
    const [low, high] = a < b ? [a, b] : [b, a];
    const [root, child] = descendantFirst ? [high, low] : [low, high];
    await withTenant(app.db, w.tenantId, async (tx) => {
      const grants = tokenGrantRepository(tx);
      const base = {
        tenantId: w.tenantId,
        clientId: w.clientDbId,
        subjectId: w.subjectId,
        scope: 'mcp:read',
        audience: ['https://odudu.test/mcp'],
      };
      await grants.create({ ...base, id: root });
      await grants.create({ ...base, id: child, exchangedFromGrantId: root });
    });
    return [root, child];
  }

  // A revoke of the root alone takes the root and then the child; one seeded
  // with both takes only the root itself and leaves the child to the cascade.
  // Taking the child first, because its id sorts first, deadlocked them.
  it.each([
    ['the single-seed revoke arrives first', true],
    ['the multi-seed revoke arrives first', false],
  ])('finish without a deadlock when the child sorts first and %s', async (_, singleFirst) => {
    const w = await newWorld();
    const [root, child] = await pair(w, true);
    const single = () =>
      withTenant(app.db, w.tenantId, (tx) => tokenGrantRepository(tx).revoke(root, LATER));
    const multi = () =>
      withTenant(app.db, w.tenantId, (tx) =>
        tokenGrantRepository(tx).revokeForSubjectClient(w.subjectId, w.clientDbId, LATER),
      );
    const outcomes = await withHeldLock(
      app.db,
      w.tenantId,
      {
        lock: async (tx) => {
          await tx.execute(sql`select id from token_grants where id = ${root} for no key update`);
        },
      },
      async (held) => {
        const settle = (run: () => Promise<unknown>) =>
          held.started(
            run().then(
              () => null,
              (error: unknown) => error,
            ),
          );
        const first = settle(singleFirst ? single : multi);
        await held.waitForWaiters(owner);
        const second = settle(singleFirst ? multi : single);
        await held.waitForWaiters(owner, 2);
        held.release();
        return Promise.all([first, second, held.done]);
      },
    );
    expect(outcomes.slice(0, 2)).toEqual([null, null]);
    expect(await grantRevoked([root, child])).toEqual([true, true]);
  });

  it('revokes a chain deeper than the structural depth while other revokers run', async () => {
    for (let round = 0; round < 4; round += 1) {
      const w = await newWorld();
      const ids = await withTenant(app.db, w.tenantId, (tx) => chain(tx, w, 12));
      const failures: unknown[] = [];
      const revoke = (id: string) =>
        withTenant(app.db, w.tenantId, (tx) => tokenGrantRepository(tx).revoke(id, LATER)).catch(
          (error: unknown) => failures.push(error),
        );
      await Promise.all([revoke(nth(ids, 0)), revoke(nth(ids, 4)), revoke(nth(ids, 9))]);
      expect(failures).toEqual([]);
      expect(await grantRevoked(ids)).toEqual(Array(12).fill(true));
    }
  }, 120_000);
});

describe('two multi-seed revokes whose seeds overlap on one chain', () => {
  // R above M above N. One revoke seeds R and N (they share a session), the
  // other M and N (they share an actor). Updating every seed took N before
  // the other had taken M, and each then waited for the other.
  it.each([
    ['the session revoke arrives first', true],
    ['the actor revoke arrives first', false],
  ])('finish without a deadlock when %s', async (_, sessionFirst) => {
    const w = await newWorld();
    const actor = await withTenant(app.db, w.tenantId, (tx) =>
      subjectRepository(tx).create({ tenantId: w.tenantId, type: 'user' }),
    );
    const [r, m, n] = [newId(), newId(), newId()];
    await withTenant(app.db, w.tenantId, async (tx) => {
      const grants = tokenGrantRepository(tx);
      const base = {
        tenantId: w.tenantId,
        clientId: w.clientDbId,
        subjectId: w.subjectId,
        scope: 'mcp:read',
        audience: ['https://odudu.test/mcp'],
      };
      await grants.create({ ...base, id: r, sessionId: w.sessionId });
      await grants.create({ ...base, id: m, exchangedFromGrantId: r, actorSubjectId: actor.id });
      await grants.create({
        ...base,
        id: n,
        exchangedFromGrantId: m,
        sessionId: w.sessionId,
        actorSubjectId: actor.id,
      });
    });
    const bySession = () =>
      withTenant(app.db, w.tenantId, (tx) =>
        tokenGrantRepository(tx).revokeForSession(w.sessionId, LATER),
      );
    const byActor = () =>
      withTenant(app.db, w.tenantId, (tx) => tokenGrantRepository(tx).revokeForActor(actor.id));
    const outcomes = await withHeldLock(
      app.db,
      w.tenantId,
      {
        lock: async (tx) => {
          await tx.execute(sql`select id from token_grants where id = ${m} for no key update`);
        },
      },
      async (held) => {
        const settle = (run: () => Promise<unknown>) =>
          held.started(
            run().then(
              () => null,
              (error: unknown) => error,
            ),
          );
        const first = settle(sessionFirst ? bySession : byActor);
        await held.waitForWaiters(owner);
        const second = settle(sessionFirst ? byActor : bySession);
        await held.waitForWaiters(owner, 2);
        held.release();
        return Promise.all([first, second, held.done]);
      },
    );
    expect(outcomes.slice(0, 2)).toEqual([null, null]);
    expect(await grantRevoked([r, m, n])).toEqual([true, true, true]);
  });
});

describe('revokers of one lineage meet at its root', () => {
  // R exchanged to X (acted for by `actor`) and to Z, which was exchanged to Y
  // (acted for too), with Y's id below X's. A revoke seeded with X and Y and a
  // revoke of R reach X and Y in opposite orders, so they cannot be ordered by
  // anything but the lineage they share.
  it.each([
    ['the revoke of the root arrives first', true],
    ['the revoke of the actor’s grants arrives first', false],
  ])('finish without a deadlock when %s', async (_, rootFirst) => {
    const w = await newWorld();
    const actor = await withTenant(app.db, w.tenantId, (tx) =>
      subjectRepository(tx).create({ tenantId: w.tenantId, type: 'user' }),
    );
    const [a, b] = [newId(), newId()];
    const [y, x] = a < b ? [a, b] : [b, a];
    const [r, z] = [newId(), newId()];
    await withTenant(app.db, w.tenantId, async (tx) => {
      const grants = tokenGrantRepository(tx);
      const base = {
        tenantId: w.tenantId,
        clientId: w.clientDbId,
        subjectId: w.subjectId,
        scope: 'mcp:read',
        audience: ['https://odudu.test/mcp'],
      };
      await grants.create({ ...base, id: r });
      await grants.create({ ...base, id: x, exchangedFromGrantId: r, actorSubjectId: actor.id });
      await grants.create({ ...base, id: z, exchangedFromGrantId: r });
      await grants.create({ ...base, id: y, exchangedFromGrantId: z, actorSubjectId: actor.id });
    });
    const byRoot = () =>
      withTenant(app.db, w.tenantId, (tx) => tokenGrantRepository(tx).revoke(r, LATER));
    const byActor = () =>
      withTenant(app.db, w.tenantId, (tx) => tokenGrantRepository(tx).revokeForActor(actor.id));
    const outcomes = await withHeldLock(
      app.db,
      w.tenantId,
      {
        lock: async (tx) => {
          await tx.execute(sql`select id from token_grants where id = ${x} for no key update`);
        },
      },
      async (held) => {
        const settle = (run: () => Promise<unknown>) =>
          held.started(
            run().then(
              () => null,
              (error: unknown) => error,
            ),
          );
        const first = settle(rootFirst ? byRoot : byActor);
        await held.waitForWaiters(owner);
        const second = settle(rootFirst ? byActor : byRoot);
        await held.waitForWaiters(owner, 2);
        held.release();
        return Promise.all([first, second, held.done]);
      },
    );
    expect(outcomes.slice(0, 2)).toEqual([null, null]);
    expect(await grantRevoked([r, x, z, y])).toEqual([true, true, true, true]);
  });

  it('does not stamp again a grant a concurrent revoke ended while it waited', async () => {
    const w = await newWorld();
    const [root, child] = await withTenant(app.db, w.tenantId, (tx) => twoOf(tx, w));
    const first = new Date(LATER.getTime() - 30_000);
    await withHeldLock(
      app.db,
      w.tenantId,
      {
        lock: async (tx) => {
          await tokenGrantRepository(tx).revoke(child, first);
        },
      },
      async (held) => {
        const waiting = held.started(
          withTenant(app.db, w.tenantId, (tx) =>
            tokenGrantRepository(tx).revokeForSubjectClient(w.subjectId, w.clientDbId, LATER),
          ),
        );
        await held.waitForWaiters(owner);
        held.release();
        await Promise.all([waiting, held.done]);
      },
    );
    const rows = (await owner.db.execute(
      sql`select id, revoked_at from token_grants where id in (${root}, ${child})`,
    )) as unknown as { id: string; revoked_at: string | Date }[];
    const stamp = (id: string) =>
      new Date(rows.find((row) => row.id === id)?.revoked_at ?? 0).getTime();
    expect(stamp(child)).toBe(first.getTime());
    expect(stamp(root)).toBe(LATER.getTime());
  });

  // A second-level exchange holds the grant it came from and its parent
  // instance, then inserts a child instance (a key share on the root grant); a
  // run's mint holds the root grant, then wants the same parent instance.
  it('lets an exchange insert its instance while a mint holds the root grant', async () => {
    const w = await newWorld();
    const { root, exchanged, parent } = await withTenant(app.db, w.tenantId, async (tx) => {
      const root = await grant(tx, w);
      const exchanged = await grant(tx, w, { from: root });
      return { root, exchanged, parent: await instanceAt(tx, w, root) };
    });
    const exchanging = () =>
      withTenant(app.db, w.tenantId, async (tx) => {
        await tokenGrantRepository(tx).lockLive(exchanged);
        await agentInstanceRepository(tx).lockForUpdate(parent);
        await instanceAt(tx, w, root, parent);
      });
    const minting = () =>
      withTenant(app.db, w.tenantId, async (tx) => {
        await agentInstanceRepository(tx).lockGrant(root);
        await agentInstanceRepository(tx).lockForUpdate(parent);
      });
    const outcomes = await withHeldLock(
      app.db,
      w.tenantId,
      {
        lock: async (tx) => {
          await tx.execute(sql`select id from agent_instances where id = ${parent} for update`);
        },
      },
      async (held) => {
        const settle = (run: () => Promise<unknown>) =>
          held.started(
            run().then(
              () => null,
              (error: unknown) => error,
            ),
          );
        const first = settle(exchanging);
        await held.waitForWaiters(owner);
        const second = settle(minting);
        await held.waitForWaiters(owner, 2);
        held.release();
        return Promise.all([first, second, held.done]);
      },
    );
    expect(outcomes.slice(0, 2)).toEqual([null, null]);
  });
});

describe('a lineage whose root grant has been deleted', () => {
  // The reaper deletes old grants and the foreign key on the parent clears the
  // pointer of what is left, so a lineage can outlive its first grant. Its
  // topmost remaining grant is then the root the revokers meet at.
  it.each([
    ['the revoke of the top arrives first', true],
    ['the revoke of the actor’s grants arrives first', false],
  ])('is still serialised when %s', async (_, topFirst) => {
    const w = await newWorld();
    const actor = await withTenant(app.db, w.tenantId, (tx) =>
      subjectRepository(tx).create({ tenantId: w.tenantId, type: 'user' }),
    );
    const [a, b] = [newId(), newId()];
    const [z, y] = a < b ? [a, b] : [b, a];
    const [r, x] = [newId(), newId()];
    await withTenant(app.db, w.tenantId, async (tx) => {
      const grants = tokenGrantRepository(tx);
      const base = {
        tenantId: w.tenantId,
        clientId: w.clientDbId,
        subjectId: w.subjectId,
        scope: 'mcp:read',
        audience: ['https://odudu.test/mcp'],
      };
      await grants.create({ ...base, id: r });
      await grants.create({ ...base, id: x, exchangedFromGrantId: r, actorSubjectId: actor.id });
      await grants.create({ ...base, id: z, exchangedFromGrantId: x });
      await grants.create({ ...base, id: y, exchangedFromGrantId: z, actorSubjectId: actor.id });
    });
    await owner.db.execute(sql`delete from token_grants where id = ${r}`);
    const byTop = () =>
      withTenant(app.db, w.tenantId, (tx) => tokenGrantRepository(tx).revoke(x, LATER));
    const byActor = () =>
      withTenant(app.db, w.tenantId, (tx) => tokenGrantRepository(tx).revokeForActor(actor.id));
    const outcomes = await withHeldLock(
      app.db,
      w.tenantId,
      {
        lock: async (tx) => {
          await tx.execute(sql`select id from token_grants where id = ${z} for no key update`);
        },
      },
      async (held) => {
        const settle = (run: () => Promise<unknown>) =>
          held.started(
            run().then(
              () => null,
              (error: unknown) => error,
            ),
          );
        const first = settle(topFirst ? byTop : byActor);
        await held.waitForWaiters(owner);
        const second = settle(topFirst ? byActor : byTop);
        await held.waitForWaiters(owner, 2);
        held.release();
        return Promise.all([first, second, held.done]);
      },
    );
    expect(outcomes.slice(0, 2)).toEqual([null, null]);
    expect(await grantRevoked([x, z, y])).toEqual([true, true, true]);
  });

  // Asked of the owner's connection while a locking transaction is still open,
  // with the strength a competing revoker takes: the row must be held against it,
  // and for the reason of a lock, not any error.
  const heldByAnother = (id: string) =>
    owner.db
      .transaction((tx) =>
        tx.execute(sql`select id from token_grants where id = ${id} for no key update nowait`),
      )
      .then(
        () => null,
        (error: unknown) => error,
      );

  it('takes the next root when the one it walked to is deleted before it is locked', async () => {
    const w = await newWorld();
    const [top, mid, leaf] = await withTenant(app.db, w.tenantId, (tx) => chain(tx, w, 3));
    const outcome = await withHeldLock(
      app.db,
      w.tenantId,
      {
        lock: async (tx) => {
          await tx.execute(sql`delete from token_grants where id = ${nth([top], 0)}`);
        },
      },
      async (held) => {
        const locking = held.started(
          withTenant(app.db, w.tenantId, async (tx) => {
            const roots = await lockLineageRoots(tx, sql`select ${nth([leaf], 0)}::uuid as id`);
            return { roots, probe: await heldByAnother(mid ?? '') };
          }),
        );
        await held.waitForWaiters(owner);
        held.release();
        const [result] = await Promise.all([locking, held.done]);
        return result;
      },
    );
    expect(outcome.roots).toEqual([mid]);
    expect(outcome.probe).toMatchObject({ cause: { code: '55P03' } });
  });

  it('also takes the root a seed has once a middle grant is deleted while it waited', async () => {
    const w = await newWorld();
    const [a, b, c] = await withTenant(app.db, w.tenantId, (tx) => chain(tx, w, 3));
    const outcome = await withHeldLock(
      app.db,
      w.tenantId,
      {
        lock: async (tx) => {
          await tx.execute(
            sql`select id from token_grants where id = ${nth([a], 0)} for no key update`,
          );
          await tx.execute(sql`delete from token_grants where id = ${nth([b], 0)}`);
        },
      },
      async (held) => {
        const locking = held.started(
          withTenant(app.db, w.tenantId, async (tx) => {
            const roots = await lockLineageRoots(tx, sql`select ${nth([c], 0)}::uuid as id`);
            return { roots, probe: await heldByAnother(c ?? '') };
          }),
        );
        await held.waitForWaiters(owner);
        held.release();
        const [result] = await Promise.all([locking, held.done]);
        return result;
      },
    );
    expect(outcome.roots).toEqual([c]);
    expect(outcome.probe).toMatchObject({ cause: { code: '55P03' } });
  });

  // `revokeBelow` takes the roots of the ids it starts from before its first
  // pass. Another transaction holds the seed, so the first pass blocks, and the
  // root is probed then: a root taken after the pass would not be held yet.
  it('holds the root of a grant it cascades from while its first pass waits', async () => {
    const w = await newWorld();
    const [root, child] = await withTenant(app.db, w.tenantId, (tx) => twoOf(tx, w));
    const probe = await withHeldLock(
      app.db,
      w.tenantId,
      {
        lock: async (tx) => {
          await tx.execute(sql`select id from token_grants where id = ${child} for no key update`);
        },
      },
      async (held) => {
        const below = held.started(
          withTenant(app.db, w.tenantId, (tx) =>
            tokenGrantRepository(tx).revokeBelow([child], LATER),
          ),
        );
        await held.waitForWaiters(owner);
        const result = await heldByAnother(root);
        held.release();
        await Promise.all([below, held.done]);
        return result;
      },
    );
    expect(probe).toMatchObject({ cause: { code: '55P03' } });
    expect(await grantRevoked([root, child])).toEqual([false, true]);
  });

  // A grant committed while a revoke waits for its seeds' roots has a lineage
  // the first walk never saw; the walk after the lock finds it. One case for
  // each way a revoke picks its seeds.
  it.each([
    [
      'a session',
      (r: ReturnType<typeof tokenGrantRepository>, w: World) =>
        r.revokeForSession(w.sessionId, LATER),
    ],
    [
      'sessions',
      (r: ReturnType<typeof tokenGrantRepository>, w: World) =>
        r.revokeForSessions([w.sessionId], LATER),
    ],
    [
      'a subject and client',
      (r: ReturnType<typeof tokenGrantRepository>, w: World) =>
        r.revokeForSubjectClient(w.subjectId, w.clientDbId, LATER),
    ],
    [
      'a subject',
      (r: ReturnType<typeof tokenGrantRepository>, w: World) =>
        r.revokeForSubject(w.subjectId, LATER),
    ],
  ])('ends and roots a grant born while it waited, by %s', async (_, revoke) => {
    const w = await newWorld();
    const stranger = await withTenant(app.db, w.tenantId, (tx) =>
      subjectRepository(tx).create({ tenantId: w.tenantId, type: 'user' }),
    );
    const base = {
      tenantId: w.tenantId,
      clientId: w.clientDbId,
      scope: 'mcp:read',
      audience: ['https://odudu.test/mcp'],
    };
    const [seed, other, born] = [newId(), newId(), newId()];
    await withTenant(app.db, w.tenantId, async (tx) => {
      const grants = tokenGrantRepository(tx);
      await grants.create({ ...base, id: seed, subjectId: w.subjectId, sessionId: w.sessionId });
      await grants.create({ ...base, id: other, subjectId: stranger.id });
    });
    const outcome = await withHeldLock(
      app.db,
      w.tenantId,
      {
        lock: async (tx) => {
          await tx.execute(sql`select id from token_grants where id = ${seed} for no key update`);
        },
      },
      async (held) => {
        const revoking = held.started(
          withTenant(app.db, w.tenantId, async (tx) => {
            await revoke(tokenGrantRepository(tx), w);
            return heldByAnother(other);
          }),
        );
        await held.waitForWaiters(owner);
        await withTenant(app.db, w.tenantId, (tx) =>
          tokenGrantRepository(tx).create({
            ...base,
            id: born,
            subjectId: w.subjectId,
            sessionId: w.sessionId,
            exchangedFromGrantId: other,
          }),
        );
        held.release();
        const [probe] = await Promise.all([revoking, held.done]);
        return probe;
      },
    );
    expect(outcome).toMatchObject({ cause: { code: '55P03' } });
    expect(await grantRevoked([seed, born])).toEqual([true, true]);
    expect(await grantRevoked([other])).toEqual([false]);
  });
});
