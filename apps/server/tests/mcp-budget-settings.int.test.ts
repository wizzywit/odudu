import { withTenant } from '@odudu/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { grantWriteBudget } from '#/mcp-deps';
import { type McpStack, startMcpStack } from '#/testing/mcp-stack';
import type { World } from '#/testing/mcp-world';

// The write limits an MCP call is held to are the tenant's own settings, with
// the daily window of the grant's owner counted beside the grant.

let stack: McpStack;

beforeAll(async () => {
  stack = await startMcpStack();
}, 120_000);

afterAll(async () => {
  await stack.close();
});

const WRITE = 'mcp:read mcp:write';

function budgetOf(w: World) {
  return grantWriteBudget(stack.appDb, {
    tenant: { id: w.tenantId, name: w.name },
    grantId: w.grantId,
  });
}

async function setting(w: World, column: string, value: number): Promise<void> {
  await withTenant(stack.appDb.db, w.tenantId, (tx) =>
    tx.execute(
      sql`update tenants set ${sql.identifier(column)} = ${value} where id = ${w.tenantId}`,
    ),
  );
}

async function admitted(w: World, kind: 'mutating' | 'create', tries: number): Promise<number> {
  let yes = 0;
  for (let i = 0; i < tries; i += 1) if (await budgetOf(w).reserve(kind)) yes += 1;
  return yes;
}

describe('the write budget read from the tenant', () => {
  it('keeps twenty changes and ten creates with the default settings', async () => {
    const w = await stack.world([], WRITE);
    expect(await admitted(w, 'mutating', 25)).toBe(20);
    const v = await stack.world([], WRITE);
    expect(await admitted(v, 'create', 15)).toBe(10);
  });

  it('admits as many changes as the tenant sets for a grant', async () => {
    const w = await stack.world([], WRITE);
    await setting(w, 'agent_writes_per_grant', 5);
    expect(await admitted(w, 'mutating', 9)).toBe(5);
  });

  it('admits as many creates as the tenant sets for a grant', async () => {
    const w = await stack.world([], WRITE);
    await setting(w, 'agent_creates_per_grant', 2);
    expect(await admitted(w, 'create', 5)).toBe(2);
  });

  it('refuses past the daily window of the owner and agent client', async () => {
    const w = await stack.world([], WRITE);
    await setting(w, 'agent_window_writes', 3);
    expect(await admitted(w, 'mutating', 8)).toBe(3);
  });

  it('gives a call back at every level', async () => {
    const w = await stack.world([], WRITE);
    await setting(w, 'agent_window_writes', 1);
    expect(await budgetOf(w).reserve('mutating')).toBe(true);
    expect(await budgetOf(w).reserve('mutating')).toBe(false);
    await budgetOf(w).release('mutating');
    expect(await budgetOf(w).reserve('mutating')).toBe(true);
  });

  it('gives a call back to the window it was spent in after midnight UTC', async () => {
    const w = await stack.world([], WRITE);
    await setting(w, 'agent_window_writes', 1);
    let at = new Date('2026-11-24T23:59:59.000Z');
    const budget = grantWriteBudget(
      stack.appDb,
      { tenant: { id: w.tenantId, name: w.name }, grantId: w.grantId },
      undefined,
      undefined,
      () => at,
    );
    expect(await budget.reserve('mutating')).toBe(true);
    at = new Date('2026-11-25T00:00:01.000Z');
    await budget.release('mutating');
    const rows = (await stack.owner.db.execute(
      sql`select to_char(window_start, 'YYYY-MM-DD') as day, writes from agent_budget_windows
           where owner_subject_id = ${w.subjectId} order by window_start`,
    )) as unknown as { day: string; writes: number }[];
    expect(rows).toEqual([{ day: '2026-11-24', writes: 0 }]);
  });
});
