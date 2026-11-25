import { withTenant } from '@odudu/db';
import { clientRepository } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tokenGrantRepository } from '#/repository/grants';
import { applyAgentLayer } from '#/usecase/agent-layer';
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

describe('[ODUDU-TOKEN-EXCHANGE-MAYACT-03] the may_act of an owner grant', () => {
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

  it('name every delegated actor once, however many delegations there are', async () => {
    const clientId = 'many-delegations-owner';
    const dbId = await addClient(stack, { clientId, delegatedActors: [PERMITTED] });
    const second = await addClient(stack, { clientId: 'second-delegate' });
    const subject = (await login(stack, OPEN_CLIENT)).subjectId;
    for (const actor of [delegateDbId, second, second]) {
      await withTenant(stack.app.db, stack.tenantId, (tx) =>
        tx.execute(
          sql`insert into agent_delegations
                (tenant_id, id, subject_id, client_id, actor_client_id, scope_ceiling, expires_at)
              values (${stack.tenantId}, ${newId()}, ${subject}, ${dbId},
                      ${actor}, 'openid', now() + interval '1 day')`,
        ),
      );
    }
    const claims = decode((await login(stack, clientId)).accessToken);
    expect(claims.may_act).toEqual(
      [DELEGATE, PERMITTED, 'second-delegate'].sort().map((sub) => ({ sub, iss: claims.iss })),
    );
  });

  it('bound the scope of an instance minted for the delegated actor', async () => {
    await delegate('openid', delegateDbId);
    const owner = await login(stack, OWNER_CLIENT, 'openid profile');
    const broad = await exchange(stack, DELEGATE, owner.accessToken, { scope: 'openid profile' });
    expect(broad.statusCode).toBe(400);
    expect(broad.json<{ error: string }>().error).toBe('invalid_scope');
    const narrow = await exchange(stack, DELEGATE, owner.accessToken, { scope: 'openid' });
    expect(narrow.statusCode).toBe(200);
  });
});

describe('an owner with more delegations than one read returns', () => {
  it('still admits the actor whose delegation is the oldest', async () => {
    const clientId = 'crowded-owner';
    const dbId = await addClient(stack, { clientId });
    const crowd = await addClient(stack, { clientId: 'crowd-actor' });
    const signedIn = await login(stack, clientId, 'openid profile');
    await withTenant(stack.app.db, stack.tenantId, async (tx) => {
      await tx.execute(
        sql`insert into agent_delegations
              (tenant_id, id, subject_id, client_id, actor_client_id, scope_ceiling,
               expires_at, created_at)
            values (${stack.tenantId}, ${newId()}, ${signedIn.subjectId}, ${dbId},
                    ${delegateDbId}, 'openid', now() + interval '1 day', now() - interval '2 days')`,
      );
      await tx.execute(
        sql`insert into agent_delegations
              (tenant_id, id, subject_id, client_id, actor_client_id, scope_ceiling,
               expires_at, created_at)
            select ${stack.tenantId}, gen_random_uuid(), ${signedIn.subjectId}, ${dbId},
                   ${crowd}, 'profile', now() + interval '1 day', now() - make_interval(secs => n)
              from generate_series(1, 201) as n`,
      );
    });
    const outcome = await withTenant(stack.app.db, stack.tenantId, async (tx) => {
      const client = await clientRepository(tx).byClientId(DELEGATE);
      if (client === null) throw new Error('no delegate client');
      return applyAgentLayer(
        tx,
        {
          tenantId: stack.tenantId,
          lifespans: {
            ssoSessionIdleSeconds: 3600,
            ssoSessionMaxSeconds: 3600,
            rememberMeIdleSeconds: 3600,
            rememberMeMaxSeconds: 3600,
          },
        },
        {
          client,
          agentType: true,
          subject: {
            subjectId: signedIn.subjectId,
            scope: ['openid', 'profile'],
            sessionId: null,
            grantId: signedIn.grantId,
            clientDbId: dbId,
            requestedUserinfoClaims: null,
            act: undefined,
            mayAct: undefined,
            expiresAt: new Date(stack.clock.now().getTime() + 300_000),
          },
          actorSubject: DELEGATE,
          requestedScope: ['openid'],
          now: stack.clock.now(),
        },
      );
    });
    expect(outcome).toMatchObject({ kind: 'ok', scope: ['openid'] });
  });
});

describe.each(['access', 'refresh'] as const)(
  'an actor needs a live source at the exchange (%s subject token)',
  (kind) => {
    let counter = 0;

    async function ownerWith(delegatedActors: string[], scope = 'openid profile') {
      counter += 1;
      const clientId = `live-owner-${kind}-${String(counter)}`;
      const dbId = await addClient(stack, { clientId, delegatedActors });
      return { clientId, dbId, scope };
    }

    async function delegation(ownerDbId: string, ceiling: string): Promise<string> {
      const subjectId = (await login(stack, OPEN_CLIENT)).subjectId;
      const id = newId();
      await withTenant(stack.app.db, stack.tenantId, (tx) =>
        tx.execute(
          sql`insert into agent_delegations
                (tenant_id, id, subject_id, client_id, actor_client_id, scope_ceiling, expires_at)
              values (${stack.tenantId}, ${id}, ${subjectId}, ${ownerDbId},
                      ${delegateDbId}, ${ceiling}, now() + interval '1 day')`,
        ),
      );
      return id;
    }

    async function exchangeAsDelegate(owner: { clientId: string; scope: string }) {
      const signedIn = await login(stack, owner.clientId, owner.scope);
      return {
        signedIn,
        send: (requested?: string) =>
          exchange(
            stack,
            DELEGATE,
            kind === 'access' ? signedIn.accessToken : signedIn.refreshToken,
            {
              type: kind,
              ...(requested === undefined ? {} : { scope: requested }),
            },
          ),
      };
    }

    it('refuses once the delegation that named the actor is revoked', async () => {
      const owner = await ownerWith([]);
      const id = await delegation(owner.dbId, 'openid');
      const { signedIn, send } = await exchangeAsDelegate(owner);
      expect(decode(signedIn.accessToken).may_act).toBeDefined();
      await withTenant(stack.app.db, stack.tenantId, (tx) =>
        tx.execute(sql`update agent_delegations set revoked_at = now() where id = ${id}`),
      );
      const res = await send();
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: string }>().error).toBe('invalid_request');
    });

    it('refuses once the delegation that named the actor has expired', async () => {
      const owner = await ownerWith([]);
      const id = await delegation(owner.dbId, 'openid');
      const { send } = await exchangeAsDelegate(owner);
      const lapsed = new Date(stack.clock.now().getTime() - 3_600_000);
      await withTenant(stack.app.db, stack.tenantId, (tx) =>
        tx.execute(
          sql`update agent_delegations
                 set expires_at = ${lapsed.toISOString()}::timestamptz,
                     created_at = ${lapsed.toISOString()}::timestamptz - interval '1 day'
               where id = ${id}`,
        ),
      );
      const res = await send();
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: string }>().error).toBe('invalid_request');
    });

    it('lets an actor the client configuration names mint within the subject scope', async () => {
      const owner = await ownerWith([DELEGATE]);
      const { send } = await exchangeAsDelegate(owner);
      const res = await send('openid profile');
      expect(res.statusCode).toBe(200);
      expect(res.json<{ scope: string }>().scope).toBe('openid profile');
    });

    it('applies the delegation ceiling when the configuration names the actor too', async () => {
      const owner = await ownerWith([DELEGATE]);
      await delegation(owner.dbId, 'openid');
      const { send } = await exchangeAsDelegate(owner);
      const broad = await send('openid profile');
      expect(broad.statusCode).toBe(400);
      expect(broad.json<{ error: string }>().error).toBe('invalid_scope');
      expect((await send('openid')).statusCode).toBe(200);
    });
  },
);

describe('a token derived under a delegation', () => {
  it('is not a live source once the owner revokes the delegation', async () => {
    const clientId = 'derived-owner';
    const ownerClientDbId = await addClient(stack, { clientId });
    const signedIn = await login(stack, clientId);
    const delegationId = newId();
    await withTenant(stack.app.db, stack.tenantId, (tx) =>
      tx.execute(
        sql`insert into agent_delegations
              (tenant_id, id, subject_id, client_id, actor_client_id, scope_ceiling, expires_at)
            values (${stack.tenantId}, ${delegationId}, ${signedIn.subjectId}, ${ownerClientDbId},
                    ${delegateDbId}, 'openid', now() + interval '1 day')`,
      ),
    );
    const fresh = await login(stack, clientId);
    const first = await exchange(stack, DELEGATE, fresh.accessToken, { scope: 'openid' });
    expect(first.statusCode).toBe(200);
    const derived = first.json<{ access_token: string }>().access_token;

    const again = await exchange(stack, DELEGATE, derived, { scope: 'openid' });
    expect(again.statusCode).toBe(200);

    await withTenant(stack.app.db, stack.tenantId, (tx) =>
      tx.execute(sql`update agent_delegations set revoked_at = now() where id = ${delegationId}`),
    );
    const refused = await exchange(stack, DELEGATE, derived, { scope: 'openid' });
    expect(refused.statusCode).toBe(400);
    expect(refused.json<{ error: string }>().error).toBe('invalid_request');
  });
});
