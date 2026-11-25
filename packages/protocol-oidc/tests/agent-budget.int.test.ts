import { provisionTenant } from '@odudu/authn-flows';
import { tenants, withTenant, type TenantScopedDatabase } from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { agentInstanceRepository } from '@odudu/domain-agents';
import { subjectRepository } from '@odudu/domain-identity';
import { clients } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentBudgetRepository, type SpendInput } from '#/repository/agent-budget';
import { tokenGrantRepository } from '#/repository/grants';
import {
  addClient,
  decode,
  exchange,
  login,
  startAgentStack,
  waitForLockWaiters,
  withHeldLock,
  type AgentStack,
} from '#/testing/agent-fixture';

const AGENT = 'budget-agent';
const DAY = 86_400_000;
const NOON = new Date('2026-11-24T12:00:00.000Z');

let stack: AgentStack;
let agentDbId: string;

beforeAll(async () => {
  stack = await startAgentStack();
  agentDbId = await addClient(stack, { clientId: AGENT, agentType: true });
}, 120_000);

afterAll(async () => {
  await stack.stop();
});

interface World {
  grantId: string;
  ownerId: string;
  clientId: string;
}

// A grant of its own, with its own owner and agent client, so no two tests
// share a daily window.
async function world(rootId: string = newId()): Promise<World> {
  return withTenant(stack.app.db, stack.tenantId, async (tx) => {
    const clientId = newId();
    await tx.insert(clients).values({
      id: clientId,
      tenantId: stack.tenantId,
      clientId: `budget-${clientId}`,
      name: 'A budget agent',
      type: 'confidential',
      secretHash: 'hashed:secret',
    });
    const owner = await subjectRepository(tx).create({ tenantId: stack.tenantId, type: 'user' });
    const grant = await tokenGrantRepository(tx).create({
      id: rootId,
      tenantId: stack.tenantId,
      clientId,
      subjectId: owner.id,
      scope: 'mcp:write',
      audience: ['https://id.example/mcp'],
    });
    return { grantId: grant.id, ownerId: owner.id, clientId };
  });
}

async function instanceOf(
  w: World,
  slice: { mutating: number; creates: number } = { mutating: 1000, creates: 1000 },
  parentInstanceId: string | null = null,
): Promise<string> {
  return withTenant(stack.app.db, stack.tenantId, async (tx) => {
    const id = newId();
    await agentInstanceRepository(tx).mint({
      id,
      tenantId: stack.tenantId,
      ownerSubjectId: w.ownerId,
      agentClientId: w.clientId,
      parentInstanceId,
      rootGrantId: w.grantId,
      depth: parentInstanceId === null ? 1 : 2,
      scope: 'mcp:write',
      expiresAt: new Date(NOON.getTime() + DAY * 30),
      idleExpiresAt: null,
      slice,
    });
    return id;
  });
}

const WIDE = { grant: { mutating: 1000, creates: 1000 }, instanceSlice: null, windowWrites: 1000 };

function spend(w: World, instanceId: string | null, over: Partial<SpendInput> = {}) {
  return withTenant(stack.app.db, stack.tenantId, (tx) =>
    agentBudgetRepository(tx).spend({
      grantId: w.grantId,
      instanceId,
      ownerSubjectId: w.ownerId,
      agentClientId: w.clientId,
      kind: 'mutating',
      now: NOON,
      limits: WIDE,
      ...over,
    }),
  );
}

interface Counters {
  grantWrites: number;
  grantCreates: number;
  instanceWrites: number | null;
  instanceCreates: number | null;
  window: number;
}

async function counters(w: World, instanceId: string | null, at = NOON): Promise<Counters> {
  const start = new Date(Math.floor(at.getTime() / DAY) * DAY);
  return withTenant(stack.app.db, stack.tenantId, async (tx) => {
    const rows = (await tx.execute(
      sql`select
            (select agent_writes from token_grants where id = ${w.grantId}) as grant_writes,
            (select agent_creates from token_grants where id = ${w.grantId}) as grant_creates,
            (select spent_mutating from agent_instances where id = ${instanceId}) as instance_writes,
            (select spent_creates from agent_instances where id = ${instanceId}) as instance_creates,
            coalesce((select writes from agent_budget_windows
                       where owner_subject_id = ${w.ownerId} and agent_client_id = ${w.clientId}
                         and window_start = ${start.toISOString()}), 0) as window_writes`,
    )) as unknown as Record<string, number | null>[];
    const row = rows[0];
    return {
      grantWrites: Number(row?.grant_writes),
      grantCreates: Number(row?.grant_creates),
      instanceWrites: row?.instance_writes === null ? null : Number(row?.instance_writes),
      instanceCreates: row?.instance_creates === null ? null : Number(row?.instance_creates),
      window: Number(row?.window_writes),
    };
  });
}

function admitted(results: readonly { kind: string }[]): number {
  return results.filter((r) => r.kind === 'ok').length;
}

function refusedLevels(results: readonly { kind: string; level?: string }[]): string[] {
  return [...new Set(results.flatMap((r) => (r.kind === 'refused' ? [String(r.level)] : [])))];
}

describe('100 calls at once', () => {
  it('admit exactly the grant limit and refuse the rest at the grant', async () => {
    const w = await world();
    const instance = await instanceOf(w);
    const limits = {
      grant: { mutating: 20, creates: 10 },
      instanceSlice: null,
      windowWrites: 1000,
    };
    const results = await Promise.all(
      Array.from({ length: 100 }, () => spend(w, instance, { limits })),
    );
    expect(admitted(results)).toBe(20);
    expect(results.filter((r) => r.kind === 'refused')).toEqual(
      Array.from({ length: 80 }, () => ({ kind: 'refused', level: 'grant' })),
    );
    expect(await counters(w, instance)).toEqual({
      grantWrites: 20,
      grantCreates: 0,
      instanceWrites: 20,
      instanceCreates: 0,
      window: 20,
    });
  });

  it('refuse at the instance when its slice is the smallest', async () => {
    const w = await world();
    const instance = await instanceOf(w, { mutating: 20, creates: 10 });
    const limits = { grant: { mutating: 50, creates: 50 }, instanceSlice: null, windowWrites: 50 };
    const results = await Promise.all(
      Array.from({ length: 100 }, () => spend(w, instance, { limits })),
    );
    expect(admitted(results)).toBe(20);
    expect(refusedLevels(results)).toEqual(['instance']);
  });

  it('refuse at the window when the window is the smallest', async () => {
    const w = await world();
    const instance = await instanceOf(w);
    const limits = { grant: { mutating: 50, creates: 50 }, instanceSlice: null, windowWrites: 20 };
    const results = await Promise.all(
      Array.from({ length: 100 }, () => spend(w, instance, { limits })),
    );
    expect(admitted(results)).toBe(20);
    expect(refusedLevels(results)).toEqual(['window']);
    expect((await counters(w, instance)).grantWrites).toBe(20);
  });

  it('share one window across the instances and sign-ins of an owner and agent client', async () => {
    const w = await world();
    const a = await instanceOf(w);
    const b = await instanceOf(w);
    const limits = {
      grant: { mutating: 100, creates: 100 },
      instanceSlice: null,
      windowWrites: 30,
    };
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) => spend(w, i % 2 === 0 ? a : b, { limits })),
    );
    expect(admitted(results)).toBe(30);
    expect((await counters(w, a)).window).toBe(30);
  });
});

describe('a refusal at one level', () => {
  it('at the window leaves the grant and the instance unspent by that call', async () => {
    const w = await world();
    const instance = await instanceOf(w);
    const limits = { grant: { mutating: 10, creates: 10 }, instanceSlice: null, windowWrites: 3 };
    for (let i = 0; i < 3; i += 1)
      expect(await spend(w, instance, { limits })).toEqual({ kind: 'ok' });
    expect(await spend(w, instance, { limits })).toEqual({ kind: 'refused', level: 'window' });
    expect(await counters(w, instance)).toMatchObject({
      grantWrites: 3,
      instanceWrites: 3,
      window: 3,
    });
  });

  it('at the instance leaves the grant and the window unspent by that call', async () => {
    const w = await world();
    const instance = await instanceOf(w, { mutating: 2, creates: 2 });
    for (let i = 0; i < 2; i += 1) expect(await spend(w, instance)).toEqual({ kind: 'ok' });
    expect(await spend(w, instance)).toEqual({ kind: 'refused', level: 'instance' });
    expect(await counters(w, instance)).toMatchObject({
      grantWrites: 2,
      instanceWrites: 2,
      window: 2,
    });
  });

  it('at the grant leaves the instance and the window unspent by that call', async () => {
    const w = await world();
    const instance = await instanceOf(w);
    const limits = { grant: { mutating: 2, creates: 2 }, instanceSlice: null, windowWrites: 1000 };
    for (let i = 0; i < 2; i += 1) await spend(w, instance, { limits });
    expect(await spend(w, instance, { limits })).toEqual({ kind: 'refused', level: 'grant' });
    expect(await counters(w, instance)).toMatchObject({
      grantWrites: 2,
      instanceWrites: 2,
      window: 2,
    });
  });

  it('at a revoked grant spends nothing at any level', async () => {
    const w = await world();
    const instance = await instanceOf(w);
    await withTenant(stack.app.db, stack.tenantId, (tx) =>
      tokenGrantRepository(tx).revoke(w.grantId, NOON),
    );
    expect(await spend(w, instance)).toEqual({ kind: 'refused', level: 'grant' });
    expect(await counters(w, instance)).toMatchObject({ instanceWrites: 0, window: 0 });
  });

  it('at a missing instance is refused at the instance and spends nothing else', async () => {
    const w = await world();
    expect(await spend(w, newId())).toEqual({ kind: 'refused', level: 'instance' });
    expect(await counters(w, null)).toMatchObject({ grantWrites: 0, window: 0 });
  });
});

describe('creates', () => {
  it('count against their own cap and the mutating cap, and once in the window', async () => {
    const w = await world();
    const instance = await instanceOf(w);
    const limits = { grant: { mutating: 5, creates: 3 }, instanceSlice: null, windowWrites: 1000 };
    for (let i = 0; i < 3; i += 1) {
      expect(await spend(w, instance, { limits, kind: 'create' })).toEqual({ kind: 'ok' });
    }
    expect(await spend(w, instance, { limits, kind: 'create' })).toEqual({
      kind: 'refused',
      level: 'grant',
    });
    expect(await counters(w, instance)).toEqual({
      grantWrites: 3,
      grantCreates: 3,
      instanceWrites: 3,
      instanceCreates: 3,
      window: 3,
    });
    for (let i = 0; i < 2; i += 1) {
      expect(await spend(w, instance, { limits })).toEqual({ kind: 'ok' });
    }
    expect(await spend(w, instance, { limits })).toEqual({ kind: 'refused', level: 'grant' });
  });

  it('are capped by the creates of an instance slice', async () => {
    const w = await world();
    const instance = await instanceOf(w, { mutating: 10, creates: 2 });
    for (let i = 0; i < 2; i += 1) {
      expect(await spend(w, instance, { kind: 'create' })).toEqual({ kind: 'ok' });
    }
    expect(await spend(w, instance, { kind: 'create' })).toEqual({
      kind: 'refused',
      level: 'instance',
    });
    expect(await spend(w, instance)).toEqual({ kind: 'ok' });
  });
});

describe('a call with no instance', () => {
  it('counts at the grant and the window only', async () => {
    const w = await world();
    const limits = { grant: { mutating: 2, creates: 1 }, instanceSlice: null, windowWrites: 1000 };
    expect(await spend(w, null, { limits })).toEqual({ kind: 'ok' });
    expect(await spend(w, null, { limits, kind: 'create' })).toEqual({ kind: 'ok' });
    expect(await spend(w, null, { limits })).toEqual({ kind: 'refused', level: 'grant' });
    expect(await counters(w, null)).toMatchObject({
      grantWrites: 2,
      grantCreates: 1,
      instanceWrites: null,
      window: 2,
    });
  });

  it('spends the budget of the root grant an exchanged grant names', async () => {
    const w = await world();
    const child = await withTenant(stack.app.db, stack.tenantId, async (tx) => {
      const parent = await tokenGrantRepository(tx).byId(w.grantId);
      return tokenGrantRepository(tx).create({
        id: newId(),
        tenantId: stack.tenantId,
        clientId: w.clientId,
        subjectId: w.ownerId,
        scope: 'mcp:write',
        audience: parent?.audience ?? [],
        exchangedFromGrantId: w.grantId,
        actorSubjectId: w.ownerId,
      });
    });
    const limits = { grant: { mutating: 2, creates: 2 }, instanceSlice: null, windowWrites: 1000 };
    await spend(w, null, { limits });
    expect(await spend(w, null, { limits, grantId: child.id })).toEqual({ kind: 'ok' });
    expect(await spend(w, null, { limits, grantId: child.id })).toEqual({
      kind: 'refused',
      level: 'grant',
    });
    expect((await counters(w, null)).grantWrites).toBe(2);
  });
});

describe('an exchanged grant revoked between the liveness check and the spend', () => {
  it('is refused at the grant, and nothing is counted', async () => {
    const w = await world();
    const child = await withTenant(stack.app.db, stack.tenantId, async (tx) =>
      tokenGrantRepository(tx).create({
        id: newId(),
        tenantId: stack.tenantId,
        clientId: w.clientId,
        subjectId: w.ownerId,
        scope: 'mcp:write',
        audience: ['https://id.example/mcp'],
        exchangedFromGrantId: w.grantId,
        actorSubjectId: w.ownerId,
      }),
    );
    const outcome = await withHeldLock(
      stack.app.db,
      stack.tenantId,
      {
        lock: async (tx) => {
          await tx.execute(sql`select id from token_grants where id = ${child.id} for update`);
        },
        afterRelease: async (tx) => {
          await tokenGrantRepository(tx).revoke(child.id, NOON);
        },
      },
      async (held) => {
        const spending = held.started(spend(w, null, { grantId: child.id }));
        await waitForLockWaiters(stack.owner);
        held.release();
        const [result] = await Promise.all([spending, held.done]);
        return result;
      },
    );
    expect(outcome).toEqual({ kind: 'refused', level: 'grant' });
    expect(await counters(w, null)).toMatchObject({ grantWrites: 0, window: 0 });
  });
});

describe('a spend racing a revoke that seeds both the root and the carried grant', () => {
  // The revoke takes its seeds in id order, so the spend has to as well: with
  // the carried grant sorting first, taking the root first deadlocks.
  it.each([
    ['the carried grant sorts before the root', true],
    ['the carried grant sorts after the root', false],
  ])('is refused at the grant, without a deadlock, when %s', async (_, carriedFirst) => {
    const [a, b] = [newId(), newId()];
    const [low, high] = a < b ? [a, b] : [b, a];
    const [rootId, childId] = carriedFirst ? [high, low] : [low, high];
    const w = await world(rootId);
    await withTenant(stack.app.db, stack.tenantId, (tx) =>
      tokenGrantRepository(tx).create({
        id: childId,
        tenantId: stack.tenantId,
        clientId: w.clientId,
        subjectId: w.ownerId,
        scope: 'mcp:write',
        audience: ['https://id.example/mcp'],
        exchangedFromGrantId: rootId,
        actorSubjectId: w.ownerId,
      }),
    );
    const outcome = await withHeldLock(
      stack.app.db,
      stack.tenantId,
      {
        lock: async (tx) => {
          await tx.execute(sql`select id from token_grants where id = ${low} for no key update`);
        },
        afterRelease: async (tx) => {
          await tokenGrantRepository(tx).revokeForSubjectClient(w.ownerId, w.clientId, NOON);
        },
      },
      async (held) => {
        const spending = held.started(spend(w, null, { grantId: childId }));
        await waitForLockWaiters(stack.owner);
        held.release();
        const [result] = await Promise.all([spending, held.done]);
        return result;
      },
    );
    expect(outcome).toEqual({ kind: 'refused', level: 'grant' });
    expect(await counters(w, null)).toMatchObject({ grantWrites: 0, window: 0 });
  });
});

describe('the daily window', () => {
  it('rolls over at the UTC day boundary', async () => {
    const w = await world();
    const limits = { grant: { mutating: 100, creates: 100 }, instanceSlice: null, windowWrites: 2 };
    const late = new Date('2026-11-24T23:59:59.000Z');
    const early = new Date('2026-11-25T00:00:00.000Z');
    expect(await spend(w, null, { limits, now: late })).toEqual({ kind: 'ok' });
    expect(await spend(w, null, { limits, now: late })).toEqual({ kind: 'ok' });
    expect(await spend(w, null, { limits, now: late })).toEqual({
      kind: 'refused',
      level: 'window',
    });
    expect(await spend(w, null, { limits, now: early })).toEqual({ kind: 'ok' });
    expect((await counters(w, null, late)).window).toBe(2);
    expect((await counters(w, null, early)).window).toBe(1);
  });
});

describe('giving a call back', () => {
  it('lowers all three levels, and never below nothing', async () => {
    const w = await world();
    const instance = await instanceOf(w);
    await spend(w, instance, { kind: 'create' });
    await spend(w, instance);
    const release = (kind: 'mutating' | 'create') =>
      withTenant(stack.app.db, stack.tenantId, (tx) =>
        agentBudgetRepository(tx).release({
          grantId: w.grantId,
          instanceId: instance,
          ownerSubjectId: w.ownerId,
          agentClientId: w.clientId,
          kind,
          now: NOON,
        }),
      );
    await release('create');
    expect(await counters(w, instance)).toEqual({
      grantWrites: 1,
      grantCreates: 0,
      instanceWrites: 1,
      instanceCreates: 0,
      window: 1,
    });
    await release('mutating');
    await release('mutating');
    expect(await counters(w, instance)).toMatchObject({
      grantWrites: 0,
      instanceWrites: 0,
      window: 0,
    });
  });
});

describe('lock order', () => {
  it('never deadlocks under spends from two instances and a revoke of their grant', async () => {
    const failures: unknown[] = [];
    for (let round = 0; round < 6; round += 1) {
      const w = await world();
      const a = await instanceOf(w);
      const b = await instanceOf(w);
      const targets = [a, b, null];
      const calls: Promise<unknown>[] = [];
      for (let i = 0; i < 40; i += 1) {
        const target = targets[Math.floor(Math.random() * targets.length)] ?? null;
        calls.push(
          spend(w, target, { kind: Math.random() < 0.3 ? 'create' : 'mutating' }).catch(
            (error: unknown) => failures.push(error),
          ),
        );
        if (i === 10 + round) {
          calls.push(
            withTenant(stack.app.db, stack.tenantId, async (tx) => {
              const grants = tokenGrantRepository(tx);
              await grants.lockLive(w.grantId);
              await grants.revokeCascade([w.grantId], NOON);
              await grants.revoke(w.grantId, NOON);
            }).catch((error: unknown) => failures.push(error)),
          );
        }
      }
      await Promise.all(calls);
    }
    const deadlocks = failures.filter((error) =>
      /deadlock|40P01/iu.test(String(error) + String(error instanceof Error ? error.cause : '')),
    );
    expect(deadlocks).toEqual([]);
    expect(failures).toEqual([]);
  });
});

describe('the slice of an instance', () => {
  async function setting(column: string, value: number): Promise<void> {
    await withTenant(stack.app.db, stack.tenantId, (tx) =>
      tx.execute(
        sql`update tenants set ${sql.identifier(column)} = ${value} where id = ${stack.tenantId}`,
      ),
    );
  }

  async function sliceOf(id: string) {
    return withTenant(stack.app.db, stack.tenantId, async (tx) => {
      const rows = (await tx.execute(
        sql`select slice_mutating, slice_creates, spent_mutating, spent_creates
              from agent_instances where id = ${id}`,
      )) as unknown as Record<string, number>[];
      return rows[0];
    });
  }

  it('is the grant-level limits of the tenant for a root instance', async () => {
    await setting('agent_writes_per_grant', 7);
    await setting('agent_creates_per_grant', 3);
    try {
      const owner = await login(stack, AGENT);
      const res = await exchange(stack, AGENT, owner.accessToken);
      const id = (decode(res.json<{ access_token: string }>().access_token).act as { sub: string })
        .sub;
      expect(await sliceOf(id)).toMatchObject({ slice_mutating: 7, slice_creates: 3 });
    } finally {
      await setting('agent_writes_per_grant', 20);
      await setting('agent_creates_per_grant', 10);
    }
  });

  it('for a nested instance is what its parent had left, and the parent keeps its own', async () => {
    const owner = await login(stack, AGENT);
    const first = await exchange(stack, AGENT, owner.accessToken);
    const firstToken = first.json<{ access_token: string }>().access_token;
    const parent = (decode(firstToken).act as { sub: string }).sub;
    const w: World = { grantId: owner.grantId, ownerId: owner.subjectId, clientId: agentDbId };
    const at = new Date();
    for (let i = 0; i < 5; i += 1) {
      await spend(w, parent, { now: at, kind: i < 2 ? 'create' : 'mutating' });
    }

    const second = await exchange(stack, AGENT, firstToken);
    const child = (
      decode(second.json<{ access_token: string }>().access_token).act as { sub: string }
    ).sub;
    expect(await sliceOf(child)).toMatchObject({
      slice_mutating: 15,
      slice_creates: 8,
      spent_mutating: 0,
      spent_creates: 0,
    });
    expect(await sliceOf(parent)).toMatchObject({
      slice_mutating: 20,
      spent_mutating: 5,
      spent_creates: 2,
    });

    let spentByChild = 0;
    for (let i = 0; i < 16; i += 1) {
      const answer = await spend(w, child, { now: at });
      if (answer.kind === 'ok') spentByChild += 1;
    }
    expect(spentByChild).toBe(15);
  });

  it('never exceeds the remainder of its parent, down a chain', async () => {
    const owner = await login(stack, AGENT);
    const first = await exchange(stack, AGENT, owner.accessToken);
    const firstToken = first.json<{ access_token: string }>().access_token;
    const root = (decode(firstToken).act as { sub: string }).sub;
    const w: World = { grantId: owner.grantId, ownerId: owner.subjectId, clientId: agentDbId };
    const at = new Date();
    for (let i = 0; i < 5; i += 1) await spend(w, root, { now: at });

    const second = await exchange(stack, AGENT, firstToken);
    const secondToken = second.json<{ access_token: string }>().access_token;
    const child = (decode(secondToken).act as { sub: string }).sub;
    for (let i = 0; i < 4; i += 1) await spend(w, child, { now: at });

    const third = await exchange(stack, AGENT, secondToken);
    const grandchild = (
      decode(third.json<{ access_token: string }>().access_token).act as { sub: string }
    ).sub;
    const rootRow = await sliceOf(root);
    const childRow = await sliceOf(child);
    const grandchildRow = await sliceOf(grandchild);
    expect(Number(childRow?.slice_mutating)).toBeLessThanOrEqual(
      Number(rootRow?.slice_mutating) - Number(rootRow?.spent_mutating),
    );
    expect(grandchildRow).toMatchObject({ slice_mutating: 11, slice_creates: 10 });
  });
});

describe('a foreign tenant', () => {
  async function seed(tx: TenantScopedDatabase, tenantId: string) {
    await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
    await provisionTenant(tx, tenantId);
    const clientId = newId();
    await tx.insert(clients).values({
      id: clientId,
      tenantId,
      clientId: `c-${clientId}`,
      name: 'An agent',
      type: 'confidential',
      secretHash: 'hashed:secret',
    });
    const owner = await subjectRepository(tx).create({ tenantId, type: 'user' });
    const grant = await tokenGrantRepository(tx).create({
      id: newId(),
      tenantId,
      clientId,
      subjectId: owner.id,
      scope: 'mcp:write',
      audience: ['https://id.example/mcp'],
    });
    return { grantId: grant.id, ownerId: owner.id, clientId };
  }

  const input = (s: { grantId: string; ownerId: string; clientId: string }): SpendInput => ({
    grantId: s.grantId,
    instanceId: null,
    ownerSubjectId: s.ownerId,
    agentClientId: s.clientId,
    kind: 'mutating',
    now: NOON,
    limits: WIDE,
  });

  it('cannot spend another tenant’s grant', async () => {
    await expectCrossTenantMethodProbe(stack.app.db, {
      seed: seed,
      verifySeeded: async (tx, s) => {
        const rows = (await tx.execute(
          sql`select agent_writes from token_grants where id = ${s.grantId}`,
        )) as unknown as { agent_writes: number }[];
        expect(rows[0]?.agent_writes).toBe(0);
      },
      attempt: (tx, s) => agentBudgetRepository(tx).spend(input(s)),
      expectBlocked: (result) => {
        expect(result).toEqual({ kind: 'refused', level: 'grant' });
      },
      verifyTenantAUnaffected: async (tx, s) => {
        const rows = (await tx.execute(
          sql`select agent_writes from token_grants where id = ${s.grantId}`,
        )) as unknown as { agent_writes: number }[];
        expect(rows[0]?.agent_writes).toBe(0);
        const windows = (await tx.execute(
          sql`select count(*)::int as n from agent_budget_windows`,
        )) as unknown as { n: number }[];
        expect(windows[0]?.n).toBe(0);
      },
    });
  });

  it('cannot give back a call on another tenant’s grant', async () => {
    await expectCrossTenantMethodProbe(stack.app.db, {
      seed: async (tx, tenantId) => {
        const s = await seed(tx, tenantId);
        await agentBudgetRepository(tx).spend(input(s));
        return s;
      },
      verifySeeded: async (tx, s) => {
        const rows = (await tx.execute(
          sql`select agent_writes from token_grants where id = ${s.grantId}`,
        )) as unknown as { agent_writes: number }[];
        expect(rows[0]?.agent_writes).toBe(1);
      },
      attempt: (tx, s) =>
        agentBudgetRepository(tx).release({
          grantId: s.grantId,
          instanceId: null,
          ownerSubjectId: s.ownerId,
          agentClientId: s.clientId,
          kind: 'mutating',
          now: NOON,
        }),
      expectBlocked: () => undefined,
      verifyTenantAUnaffected: async (tx, s) => {
        const rows = (await tx.execute(
          sql`select agent_writes from token_grants where id = ${s.grantId}`,
        )) as unknown as { agent_writes: number }[];
        expect(rows[0]?.agent_writes).toBe(1);
      },
    });
  });
});
