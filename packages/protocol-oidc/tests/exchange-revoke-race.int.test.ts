import { withTenant } from '@odudu/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tokenGrantRepository } from '#/repository/grants';
import {
  addClient,
  decode,
  exchange,
  login,
  startAgentStack,
  withHeldLock,
  type AgentStack,
} from '#/testing/agent-fixture';

const AGENT = 'agent-client';

let stack: AgentStack;

beforeAll(async () => {
  stack = await startAgentStack();
  await addClient(stack, { clientId: AGENT, agentType: true });
}, 120_000);

afterAll(async () => {
  await stack.stop();
});

async function count(query: ReturnType<typeof sql>): Promise<number> {
  const rows = await stack.owner.db.execute(query);
  return Number((rows as unknown as { n: number }[])[0]?.n);
}

const grantCount = () => count(sql`select count(*)::int as n from token_grants`);

// A live grant under a revoked one, or a live instance under a revoked parent
// instance or a revoked root grant.
async function orphans(): Promise<number> {
  return (
    (await count(
      sql`select count(*)::int as n from token_grants c join token_grants p on p.id = c.exchanged_from_grant_id
           where c.revoked_at is null and p.revoked_at is not null`,
    )) +
    (await count(
      sql`select count(*)::int as n from agent_instances i join agent_instances p on p.id = i.parent_instance_id
           where i.revoked_at is null and p.revoked_at is not null`,
    )) +
    (await count(
      sql`select count(*)::int as n from agent_instances i join token_grants g on g.id = i.root_grant_id
           where i.revoked_at is null and g.revoked_at is not null`,
    ))
  );
}

describe('an exchange from a revoked grant', () => {
  it('is refused invalid_request, as for any already revoked token, and creates no grant', async () => {
    const owner = await login(stack, AGENT);
    await withTenant(stack.app.db, stack.tenantId, (tx) =>
      tokenGrantRepository(tx).revoke(owner.grantId, new Date()),
    );
    const before = await grantCount();
    const res = await exchange(stack, AGENT, owner.accessToken);
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_request');
    expect(await grantCount()).toBe(before);
  });

  it('is refused invalid_grant, and rolls back, when the grant is revoked after the exchange read it', async () => {
    const owner = await login(stack, AGENT);
    const grants = await grantCount();
    const instances = await count(sql`select count(*)::int as n from agent_instances`);
    const res = await withHeldLock(
      stack.app.db,
      stack.tenantId,
      {
        lock: async (tx) => {
          await tx.execute(sql`select id from token_grants where id = ${owner.grantId} for update`);
        },
        afterRelease: async (tx) => {
          await tokenGrantRepository(tx).revoke(owner.grantId, new Date());
        },
      },
      async (held) => {
        const exchanging = held.started(exchange(stack, AGENT, owner.accessToken));
        await held.waitForWaiters(stack.owner);
        held.release();
        const [outcome] = await Promise.all([exchanging, held.done]);
        return outcome;
      },
    );
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_grant');
    expect(await grantCount()).toBe(grants);
    expect(await count(sql`select count(*)::int as n from agent_instances`)).toBe(instances);
  });
});

describe('an exchange from an instance racing a revoke', () => {
  // The exchange is held mid-transaction by a lock on its parent instance,
  // which a test transaction owns; a revoke starts meanwhile. Locking the
  // instance before the grant, as the exchange once did, deadlocks here.
  it.each([
    ['the grant it derives from', 0],
    ['an ancestor of that grant', 1],
  ])(
    'ends cleanly with no live child under a revoked parent: %s',
    async (_, up) => {
      for (let round = 0; round < 6; round += 1) {
        const owner = await login(stack, AGENT);
        const first = await exchange(stack, AGENT, owner.accessToken);
        const token = first.json<{ access_token: string }>().access_token;
        const claims = decode(token);
        const instance = (claims.act as { sub: string }).sub;
        const target = up === 0 ? String(claims.grant_id) : owner.grantId;

        const [res, revokeError] = await withHeldLock(
          stack.app.db,
          stack.tenantId,
          {
            lock: async (tx) => {
              await tx.execute(
                sql`select id from agent_instances where id = ${instance} for update`,
              );
            },
          },
          async (held) => {
            const exchanging = held.started(exchange(stack, AGENT, token));
            await held.waitForWaiters(stack.owner);
            const revoking = held.started(
              withTenant(stack.app.db, stack.tenantId, (tx) =>
                tokenGrantRepository(tx).revoke(target, new Date()),
              ).then(
                () => null,
                (error: unknown) => error,
              ),
            );
            await held.waitForWaiters(stack.owner, 2);
            held.release();
            return Promise.all([exchanging, revoking, held.done]);
          },
        );

        // A deadlock (40P01) aborts one side: the revoke must not be it.
        expect(revokeError).toBeNull();
        expect([200, 400]).toContain(res.statusCode);
        expect(await orphans()).toBe(0);
      }
    },
    120_000,
  );
});
