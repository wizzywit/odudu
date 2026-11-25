import { withTenant } from '@odudu/db';
import { agentInstanceRepository } from '@odudu/domain-agents';
import { newId } from '@odudu/kernel';
import { tokenGrantRepository } from '@odudu/protocol-oidc';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { grantWriteBudget } from '#/mcp-deps';
import { type McpStack, startMcpStack } from '#/testing/mcp-stack';
import type { World } from '#/testing/mcp-world';

// The share of an agent instance, spent by the calls its own token makes
// through the MCP endpoint, beside the sign-in's allowance it was carved from.

let stack: McpStack;

beforeAll(async () => {
  stack = await startMcpStack();
}, 120_000);

afterAll(async () => {
  await stack.close();
});

const WRITE = 'mcp:read mcp:write';
const HOUR = 3_600_000;

function budgetOf(w: World, grantId: string) {
  return grantWriteBudget(stack.appDb, { tenant: { id: w.tenantId, name: w.name }, grantId });
}

async function admitted(w: World, grantId: string, tries: number): Promise<number> {
  let yes = 0;
  for (let i = 0; i < tries; i += 1) if (await budgetOf(w, grantId).reserve('mutating')) yes += 1;
  return yes;
}

// A run of the agent client rooted at the sign-in's grant, with the grant its
// token stands on: exchanged from `from` and acting as the run.
async function run(
  w: World,
  slice: { mutating: number; creates: number },
  parent: { instance: string; grant: string } | null = null,
  over: { expiresAt?: Date } = {},
): Promise<{ instance: string; grant: string }> {
  const instance = newId();
  const grant = newId();
  await withTenant(stack.appDb.db, w.tenantId, async (tx) => {
    await agentInstanceRepository(tx).mint({
      id: instance,
      tenantId: w.tenantId,
      ownerSubjectId: w.subjectId,
      agentClientId: w.agentDbId,
      parentInstanceId: parent?.instance ?? null,
      rootGrantId: w.grantId,
      depth: parent === null ? 1 : 2,
      scope: 'mcp:write',
      expiresAt: over.expiresAt ?? new Date(Date.now() + HOUR),
      idleExpiresAt: null,
      slice,
    });
    await tokenGrantRepository(tx).create({
      id: grant,
      tenantId: w.tenantId,
      clientId: w.agentDbId,
      subjectId: w.subjectId,
      scope: 'mcp:write',
      audience: [],
      exchangedFromGrantId: parent?.grant ?? w.grantId,
      actorSubjectId: instance,
    });
  });
  return { instance, grant };
}

async function spentBy(w: World, instance: string): Promise<number> {
  const rows = (await stack.owner.db.execute(
    sql`select spent_mutating as n from agent_instances where id = ${instance}`,
  )) as unknown as { n: number }[];
  return Number(rows[0]?.n);
}

describe('the share of an agent instance at the MCP door', () => {
  it('ends a run at its own share while the sign-in still has allowance', async () => {
    const w = await stack.world([], WRITE);
    const first = await run(w, { mutating: 3, creates: 3 });
    expect(await admitted(w, first.grant, 5)).toBe(3);
    expect(await spentBy(w, first.instance)).toBe(3);
    expect(await budgetOf(w, w.grantId).reserve('mutating')).toBe(true);
  });

  it('counts a run’s calls against the sign-in it came from', async () => {
    const w = await stack.world([], WRITE);
    const first = await run(w, { mutating: 30, creates: 10 });
    expect(await admitted(w, first.grant, 25)).toBe(20);
  });

  it('bounds a nested run by what its parent had left', async () => {
    const w = await stack.world([], WRITE);
    const parent = await run(w, { mutating: 5, creates: 5 });
    expect(await admitted(w, parent.grant, 3)).toBe(3);
    const left = await withTenant(stack.appDb.db, w.tenantId, async (tx) => {
      const row = await agentInstanceRepository(tx).byId(parent.instance);
      if (row === null) throw new Error('no parent');
      return { mutating: row.sliceMutating - row.spentMutating, creates: row.sliceCreates };
    });
    const nested = await run(w, left, parent);
    expect(await admitted(w, nested.grant, 5)).toBe(2);
  });

  it('refuses a run that has lapsed, and one that was revoked', async () => {
    const w = await stack.world([], WRITE);
    const lapsed = await run(w, { mutating: 3, creates: 3 }, null, {
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await admitted(w, lapsed.grant, 1)).toBe(0);
    const revoked = await run(w, { mutating: 3, creates: 3 });
    await withTenant(stack.appDb.db, w.tenantId, (tx) =>
      agentInstanceRepository(tx).revoke(revoked.instance, new Date()),
    );
    expect(await admitted(w, revoked.grant, 1)).toBe(0);
  });

  it('gives a call back to the run’s share', async () => {
    const w = await stack.world([], WRITE);
    const first = await run(w, { mutating: 1, creates: 1 });
    expect(await budgetOf(w, first.grant).reserve('mutating')).toBe(true);
    expect(await budgetOf(w, first.grant).reserve('mutating')).toBe(false);
    await budgetOf(w, first.grant).release('mutating');
    expect(await budgetOf(w, first.grant).reserve('mutating')).toBe(true);
  });
});
