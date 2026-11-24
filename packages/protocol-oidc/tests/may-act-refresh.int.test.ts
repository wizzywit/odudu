import { withTenant } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tokenGrantRepository } from '#/repository/grants';
import {
  addClient,
  basic,
  decode,
  exchange,
  login,
  startAgentStack,
  type AgentStack,
} from '#/testing/agent-fixture';

const OWNER_CLIENT = 'owner-client';
const PERMITTED = 'permitted-actor';
const OTHER = 'other-actor';
const OPEN_CLIENT = 'open-client';
const DELEGATE = 'delegate-agent';

let stack: AgentStack;
let ownerDbId: string;
let delegateDbId: string;

beforeAll(async () => {
  stack = await startAgentStack();
  ownerDbId = await addClient(stack, {
    clientId: OWNER_CLIENT,
    delegatedActors: [PERMITTED],
  });
  await addClient(stack, { clientId: PERMITTED, impersonation: true });
  await addClient(stack, { clientId: OTHER, impersonation: true });
  await addClient(stack, { clientId: OPEN_CLIENT, impersonation: true });
  delegateDbId = await addClient(stack, { clientId: DELEGATE, agentType: true });
}, 120_000);

afterAll(async () => {
  await stack.stop();
});

async function grantMayAct(grantId: string): Promise<unknown> {
  const grant = await withTenant(stack.app.db, stack.tenantId, (tx) =>
    tokenGrantRepository(tx).byId(grantId),
  );
  return grant?.mayAct;
}

describe('the may_act of an owner grant', () => {
  it('is minted into the access token and persisted on the grant', async () => {
    const owner = await login(stack, OWNER_CLIENT);
    const claims = decode(owner.accessToken);
    expect(claims.may_act).toEqual({ sub: PERMITTED, iss: claims.iss });
    expect(await grantMayAct(owner.grantId)).toEqual({ sub: PERMITTED, iss: claims.iss });
  });

  it('is absent, and every exchange permitted, when nobody is named', async () => {
    const owner = await login(stack, OPEN_CLIENT);
    expect(decode(owner.accessToken).may_act).toBeUndefined();
    expect(await grantMayAct(owner.grantId)).toBeNull();
    expect((await exchange(stack, OTHER, owner.accessToken)).statusCode).toBe(200);
  });

  it('is reapplied to the access token of a refresh', async () => {
    const owner = await login(stack, OWNER_CLIENT);
    const res = await stack.http.inject({
      method: 'POST',
      url: `/tenants/${stack.tenantName}/protocol/openid-connect/token`,
      payload: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: owner.refreshToken,
      }).toString(),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: basic(OWNER_CLIENT),
      },
    });
    expect(res.statusCode).toBe(200);
    const claims = decode(res.json<{ access_token: string }>().access_token);
    expect(claims.may_act).toEqual({ sub: PERMITTED, iss: claims.iss });
  });

  it('refuses an access token presented by an actor it does not name', async () => {
    const owner = await login(stack, OWNER_CLIENT);
    expect((await exchange(stack, OTHER, owner.accessToken)).statusCode).toBe(400);
    expect((await exchange(stack, PERMITTED, owner.accessToken)).statusCode).toBe(200);
  });

  it('refuses a refresh token presented by an actor it does not name', async () => {
    const owner = await login(stack, OWNER_CLIENT);
    const refused = await exchange(stack, OTHER, owner.refreshToken, { type: 'refresh' });
    expect(refused.statusCode).toBe(400);
    const allowed = await exchange(stack, PERMITTED, owner.refreshToken, { type: 'refresh' });
    expect(allowed.statusCode).toBe(200);
  });
});

describe('the owner delegations', () => {
  async function delegate(ceiling: string, actorDbId: string): Promise<void> {
    const subject = await login(stack, OWNER_CLIENT);
    await withTenant(stack.app.db, stack.tenantId, (tx) =>
      tx.execute(
        sql`insert into agent_delegations
              (tenant_id, id, subject_id, client_id, actor_client_id, scope_ceiling, expires_at)
            values (${stack.tenantId}, ${newId()}, ${subject.subjectId}, ${ownerDbId},
                    ${actorDbId}, ${ceiling}, now() + interval '1 day')`,
      ),
    );
  }

  it('join the client actors in one claim', async () => {
    await delegate('openid', delegateDbId);
    const claims = decode((await login(stack, OWNER_CLIENT)).accessToken);
    expect(claims.may_act).toEqual([
      { sub: DELEGATE, iss: claims.iss },
      { sub: PERMITTED, iss: claims.iss },
    ]);
  });

  it('bound the scope of an instance minted for the delegated actor', async () => {
    const owner = await login(stack, OWNER_CLIENT, 'openid profile');
    const broad = await exchange(stack, DELEGATE, owner.accessToken, { scope: 'openid profile' });
    expect(broad.statusCode).toBe(400);
    expect(broad.json<{ error: string }>().error).toBe('invalid_scope');
    const narrow = await exchange(stack, DELEGATE, owner.accessToken, { scope: 'openid' });
    expect(narrow.statusCode).toBe(200);
  });
});
