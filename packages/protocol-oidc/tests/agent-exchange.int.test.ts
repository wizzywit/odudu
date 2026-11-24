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
  type AgentStack,
} from '#/testing/agent-fixture';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const AGENT = 'agent-client';
const PLAIN = 'plain-client';

let stack: AgentStack;
let agentDbId: string;

beforeAll(async () => {
  stack = await startAgentStack();
  agentDbId = await addClient(stack, { clientId: AGENT, agentType: true });
  await addClient(stack, { clientId: PLAIN, impersonation: true });
}, 120_000);

afterAll(async () => {
  await stack.stop();
});

async function setting(column: string, value: number): Promise<void> {
  await withTenant(stack.app.db, stack.tenantId, (tx) =>
    tx.execute(
      sql`update tenants set ${sql.identifier(column)} = ${value} where id = ${stack.tenantId}`,
    ),
  );
}

async function instanceRow(id: string) {
  return withTenant(stack.app.db, stack.tenantId, async (tx) => {
    const rows = await tx.execute(
      sql`select owner_subject_id, agent_client_id, parent_instance_id, root_grant_id, depth, scope, expires_at
            from agent_instances where id = ${id}`,
    );
    return (rows as unknown as Record<string, unknown>[])[0];
  });
}

describe('an agent-type client exchanging', () => {
  it('names a new instance in act.sub and records it on the grant', async () => {
    const owner = await login(stack, AGENT);
    const res = await exchange(stack, AGENT, owner.accessToken);
    expect(res.statusCode).toBe(200);
    const claims = decode(res.json<{ access_token: string }>().access_token);
    const act = claims.act as { sub: string };
    expect(claims.sub).toBe(owner.subjectId);
    expect(act.sub).toMatch(UUID);

    const row = await instanceRow(act.sub);
    expect(row).toMatchObject({
      owner_subject_id: owner.subjectId,
      agent_client_id: agentDbId,
      parent_instance_id: null,
      root_grant_id: owner.grantId,
      depth: 1,
    });

    const grant = await withTenant(stack.app.db, stack.tenantId, (tx) =>
      tokenGrantRepository(tx).byId(String(claims.grant_id)),
    );
    expect(grant?.actorSubjectId).toBe(act.sub);
    expect(grant?.actChain).toEqual({ sub: act.sub });
  });

  it('never impersonates: no actor token still yields an act chain', async () => {
    const owner = await login(stack, AGENT);
    const res = await exchange(stack, AGENT, owner.accessToken);
    expect(decode(res.json<{ access_token: string }>().access_token).act).toBeDefined();
  });

  it('mints a child under the instance of a nested exchange', async () => {
    const owner = await login(stack, AGENT);
    const first = await exchange(stack, AGENT, owner.accessToken);
    const firstToken = first.json<{ access_token: string }>().access_token;
    const parent = (decode(firstToken).act as { sub: string }).sub;

    const second = await exchange(stack, AGENT, firstToken);
    expect(second.statusCode).toBe(200);
    const act = decode(second.json<{ access_token: string }>().access_token).act as {
      sub: string;
      act: { sub: string };
    };
    expect(act.act.sub).toBe(parent);
    expect(act.sub).toMatch(UUID);
    expect(act.sub).not.toBe(parent);
    expect(await instanceRow(act.sub)).toMatchObject({ parent_instance_id: parent, depth: 2 });
  });

  it('refuses a nested exchange past the tenant depth limit', async () => {
    await setting('agent_max_delegation_depth', 1);
    try {
      const owner = await login(stack, AGENT);
      const first = await exchange(stack, AGENT, owner.accessToken);
      const token = first.json<{ access_token: string }>().access_token;
      const second = await exchange(stack, AGENT, token);
      expect(second.statusCode).toBe(400);
      expect(second.json<{ error: string }>().error).toBe('invalid_target');
    } finally {
      await setting('agent_max_delegation_depth', 3);
    }
  });

  it('refuses an actor token: the actor is the client itself', async () => {
    const owner = await login(stack, AGENT);
    const res = await exchange(stack, AGENT, owner.accessToken, {
      extra: {
        actor_token: owner.accessToken,
        actor_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('writes agent.instance_minted with its allowlisted detail', async () => {
    const owner = await login(stack, AGENT);
    const res = await exchange(stack, AGENT, owner.accessToken);
    const instance = (
      decode(res.json<{ access_token: string }>().access_token).act as { sub: string }
    ).sub;
    const rows = await withTenant(stack.app.db, stack.tenantId, (tx) =>
      tx.execute(
        sql`select event_type, outcome, resource_id, detail from audit_events
             where action = 'agent.instance_minted' and resource_id = ${instance}`,
      ),
    );
    const [row] = rows as unknown as { event_type: string; outcome: string; detail: unknown }[];
    expect(row).toMatchObject({ event_type: 'agent_identity', outcome: 'allowed' });
    expect(row?.detail).toEqual({
      agent_client: AGENT,
      owner: owner.subjectId,
      instance,
      depth: 1,
    });
  });

  it('stores the event even when the tenant lists no agent event type', async () => {
    await withTenant(stack.app.db, stack.tenantId, (tx) =>
      tx.execute(
        sql`update tenants set audit_event_types = ARRAY['admin_mutation','admin_access']::text[] where id = ${stack.tenantId}`,
      ),
    );
    try {
      const owner = await login(stack, AGENT);
      const res = await exchange(stack, AGENT, owner.accessToken);
      const instance = (
        decode(res.json<{ access_token: string }>().access_token).act as { sub: string }
      ).sub;
      const rows = await withTenant(stack.app.db, stack.tenantId, (tx) =>
        tx.execute(
          sql`select 1 from audit_events where resource_id = ${instance} and action = 'agent.instance_minted'`,
        ),
      );
      expect((rows as unknown as unknown[]).length).toBe(1);
    } finally {
      await withTenant(stack.app.db, stack.tenantId, (tx) =>
        tx.execute(
          sql`update tenants set audit_event_types = DEFAULT where id = ${stack.tenantId}`,
        ),
      );
    }
  });

  it('leaves a client that is not an agent type exactly as before', async () => {
    const owner = await login(stack, PLAIN);
    const res = await exchange(stack, PLAIN, owner.accessToken);
    expect(res.statusCode).toBe(200);
    expect(decode(res.json<{ access_token: string }>().access_token).act).toBeUndefined();
  });

  it('lets exactly one of two concurrent exchanges take the last child slot', async () => {
    await setting('agent_max_children', 2);
    try {
      const owner = await login(stack, AGENT);
      expect((await exchange(stack, AGENT, owner.accessToken)).statusCode).toBe(200);
      const [a, b] = await Promise.all([
        exchange(stack, AGENT, owner.accessToken),
        exchange(stack, AGENT, owner.accessToken),
      ]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 400]);
      const refused = a.statusCode === 400 ? a : b;
      expect(refused.json<{ error: string }>().error).toBe('invalid_target');
    } finally {
      await setting('agent_max_children', 20);
    }
  });
});
