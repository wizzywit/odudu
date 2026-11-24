import { sessionRepository } from '@odudu/authn-flows';
import { signingKeyRepository, signJwt } from '@odudu/crypto';
import { tenants, withTenant } from '@odudu/db';
import { agentInstanceRepository } from '@odudu/domain-agents';
import { subjectRepository } from '@odudu/domain-identity';
import { clientRepository, clients } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { sql } from 'drizzle-orm';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tokenGrantRepository } from '#/repository/grants';
import { refreshTokenRepository } from '#/repository/refresh';
import { hashRefreshToken } from '#/service/refresh';
import { applyAgentLayer } from '#/usecase/agent-layer';
import {
  addClient,
  basic,
  decode,
  KEK,
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

async function count(query: ReturnType<typeof sql>): Promise<number> {
  const rows = await stack.owner.db.execute(query);
  return Number((rows as unknown as { n: string }[])[0]?.n);
}

const instanceCount = () => count(sql`select count(*) as n from agent_instances`);
const instanceSubjectCount = () =>
  count(sql`select count(*) as n from subjects where type = 'agent_instance'`);

async function firstInstance(owner: { accessToken: string }) {
  const res = await exchange(stack, AGENT, owner.accessToken);
  const token = res.json<{ access_token: string }>().access_token;
  return { token, id: (decode(token).act as { sub: string }).sub };
}

// The same token, signed by the tenant's own key, naming another actor.
async function withActHead(token: string, head: string): Promise<string> {
  const key = await withTenant(stack.app.db, stack.tenantId, (tx) =>
    signingKeyRepository(tx).active(),
  );
  return signJwt({ ...decode(token), act: { sub: head } }, { key, kek: KEK, typ: 'at+jwt' });
}

async function foreignInstance(): Promise<string> {
  const tenantId = newId();
  return withTenant(stack.app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `foreign-${tenantId}` });
    const clientDbId = newId();
    await tx.insert(clients).values({
      id: clientDbId,
      tenantId,
      clientId: `foreign-${clientDbId}`,
      name: 'foreign',
      type: 'confidential',
      secretHash: 'hashed:secret',
    });
    const ownerSubject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    const grantId = newId();
    await tx.execute(
      sql`insert into token_grants (id, tenant_id, client_id, subject_id, scope)
          values (${grantId}, ${tenantId}, ${clientDbId}, ${ownerSubject.id}, 'openid')`,
    );
    const instance = await agentInstanceRepository(tx).mint({
      id: newId(),
      tenantId,
      ownerSubjectId: ownerSubject.id,
      agentClientId: clientDbId,
      parentInstanceId: null,
      rootGrantId: grantId,
      depth: 1,
      scope: 'openid',
      expiresAt: new Date(Date.now() + 3_600_000),
      idleExpiresAt: null,
    });
    return instance.id;
  });
}

describe('a nested exchange whose act head is not a live instance of this client', () => {
  async function refusedWithNoNewInstance(token: string): Promise<void> {
    const before = await instanceCount();
    const res = await exchange(stack, AGENT, token);
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_request');
    expect(await instanceCount()).toBe(before);
  }

  it('is refused when the instance row is gone', async () => {
    const owner = await login(stack, AGENT);
    const { token, id } = await firstInstance(owner);
    await stack.owner.db.execute(sql`delete from agent_instances where id = ${id}`);
    await refusedWithNoNewInstance(token);
  });

  it('is refused when the instance was revoked', async () => {
    const owner = await login(stack, AGENT);
    const { token, id } = await firstInstance(owner);
    await stack.owner.db.execute(
      sql`update agent_instances set revoked_at = now() where id = ${id}`,
    );
    await refusedWithNoNewInstance(token);
  });

  it('is refused when the instance belongs to another tenant', async () => {
    const owner = await login(stack, AGENT);
    const { token } = await firstInstance(owner);
    await refusedWithNoNewInstance(await withActHead(token, await foreignInstance()));
  });

  it('is refused when the head is neither an instance id nor this client', async () => {
    const owner = await login(stack, AGENT);
    const { token } = await firstInstance(owner);
    await refusedWithNoNewInstance(await withActHead(token, PLAIN));
  });

  it('is refused when the instance is another subject’s in the same tenant', async () => {
    const owner = await login(stack, AGENT);
    const { token } = await firstInstance(owner);
    const stranger = await withTenant(stack.app.db, stack.tenantId, async (tx) => {
      const other = await subjectRepository(tx).create({ tenantId: stack.tenantId, type: 'user' });
      const instance = await agentInstanceRepository(tx).mint({
        id: newId(),
        tenantId: stack.tenantId,
        ownerSubjectId: other.id,
        agentClientId: agentDbId,
        parentInstanceId: null,
        rootGrantId: owner.grantId,
        depth: 1,
        scope: 'openid',
        expiresAt: new Date(Date.now() + 3_600_000),
        idleExpiresAt: null,
      });
      return instance.id;
    });
    await refusedWithNoNewInstance(await withActHead(token, stranger));
  });
});

describe('an agent-type client whose client_id looks like an instance id', () => {
  it('starts a lineage when the act head is the client itself', async () => {
    const clientId = newId();
    await addClient(stack, { clientId, agentType: true });
    const owner = await login(stack, clientId);
    const token = await withActHead(owner.accessToken, clientId);
    const res = await exchange(stack, clientId, token);
    expect(res.statusCode).toBe(200);
    const act = decode(res.json<{ access_token: string }>().access_token).act as { sub: string };
    expect(await instanceRow(act.sub)).toMatchObject({ parent_instance_id: null, depth: 2 });
  });
});

describe('the depth of an exchange whose token names the client as its actor', () => {
  async function exchangeMarked(): Promise<LightMyRequestResponse> {
    const owner = await login(stack, AGENT);
    return exchange(stack, AGENT, await withActHead(owner.accessToken, AGENT));
  }

  it('is refused at the tenant limit before anything is minted', async () => {
    await setting('agent_max_delegation_depth', 1);
    try {
      const before = await instanceCount();
      const res = await exchangeMarked();
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: string }>().error).toBe('invalid_target');
      expect(await instanceCount()).toBe(before);
    } finally {
      await setting('agent_max_delegation_depth', 3);
    }
  });

  it('is admitted one level further and recorded as deep as its act chain', async () => {
    await setting('agent_max_delegation_depth', 2);
    try {
      const res = await exchangeMarked();
      expect(res.statusCode).toBe(200);
      const act = decode(res.json<{ access_token: string }>().access_token).act as {
        sub: string;
        act: { sub: string };
      };
      expect(act.act.sub).toBe(AGENT);
      expect(await instanceRow(act.sub)).toMatchObject({ depth: 2 });
    } finally {
      await setting('agent_max_delegation_depth', 3);
    }
  });
});

describe('the lifetime of a minted instance', () => {
  async function expiryOf(id: string): Promise<Date> {
    const row = await instanceRow(id);
    return new Date(String(row?.expires_at));
  }

  it('ends with the subject token when that is the earliest bound', async () => {
    const owner = await login(stack, AGENT);
    const { id } = await firstInstance(owner);
    const exp = Number(decode(owner.accessToken).exp) * 1000;
    expect((await expiryOf(id)).getTime()).toBe(exp);
  });

  it('ends with the owner session when that is earlier', async () => {
    const owner = await login(stack, AGENT);
    const end = new Date(stack.clock.now().getTime() + 100_000);
    await stack.owner.db.execute(
      sql`update sessions set expires_at = ${end.toISOString()}::timestamptz
           where id = (select session_id from token_grants where id = ${owner.grantId})`,
    );
    const { id } = await firstInstance(owner);
    expect((await expiryOf(id)).getTime()).toBe(end.getTime());
  });

  it('caps the exchanged token and its grant at the instance expiry', async () => {
    await setting('agent_instance_ttl_seconds', 60);
    try {
      const owner = await login(stack, AGENT);
      const res = await exchange(stack, AGENT, owner.accessToken);
      expect(res.statusCode).toBe(200);
      const claims = decode(res.json<{ access_token: string }>().access_token);
      const id = (claims.act as { sub: string }).sub;
      const instanceEnd = (await expiryOf(id)).getTime();
      expect(Number(claims.exp) * 1000).toBeLessThanOrEqual(instanceEnd);
      const grant = await withTenant(stack.app.db, stack.tenantId, (tx) =>
        tokenGrantRepository(tx).byId(String(claims.grant_id)),
      );
      expect(grant?.expCeiling?.getTime()).toBeLessThanOrEqual(instanceEnd);
    } finally {
      await setting('agent_instance_ttl_seconds', 900);
    }
  });

  it('caps an exchanged refresh token at the instance expiry', async () => {
    await setting('agent_instance_ttl_seconds', 60);
    try {
      const owner = await login(stack, AGENT);
      const res = await exchange(stack, AGENT, owner.accessToken, {
        extra: { requested_token_type: 'urn:ietf:params:oauth:token-type:refresh_token' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ expires_in: number }>().expires_in).toBeLessThanOrEqual(60);
    } finally {
      await setting('agent_instance_ttl_seconds', 900);
    }
  });

  it('never outlives its parent instance', async () => {
    const owner = await login(stack, AGENT);
    const first = await firstInstance(owner);
    const res = await exchange(stack, AGENT, first.token);
    const child = (decode(res.json<{ access_token: string }>().access_token).act as { sub: string })
      .sub;
    expect((await expiryOf(child)).getTime()).toBeLessThanOrEqual(
      (await expiryOf(first.id)).getTime(),
    );
  });
});

describe('minting under concurrency and refusal', () => {
  it('lets exactly one of two concurrent nested exchanges take the last child slot', async () => {
    await setting('agent_max_children', 2);
    try {
      const owner = await login(stack, AGENT);
      const first = await firstInstance(owner);
      expect((await exchange(stack, AGENT, first.token)).statusCode).toBe(200);
      const [a, b] = await Promise.all([
        exchange(stack, AGENT, first.token),
        exchange(stack, AGENT, first.token),
      ]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 400]);
    } finally {
      await setting('agent_max_children', 20);
    }
  });

  it('leaves no instance and no instance subject when the exchange is refused after the mint', async () => {
    const owner = await login(stack, AGENT);
    const instances = await instanceCount();
    const subjects = await instanceSubjectCount();
    const res = await exchange(stack, AGENT, owner.accessToken, {
      extra: { audience: 'https://not-registered.example' },
    });
    expect(res.statusCode).toBe(400);
    expect(await instanceCount()).toBe(instances);
    expect(await instanceSubjectCount()).toBe(subjects);
  });

  it('refuses to mint when the owner session is gone before the mint', async () => {
    const owner = await login(stack, AGENT);
    const outcome = await withTenant(stack.app.db, stack.tenantId, async (tx) => {
      const client = await clientRepository(tx).byClientId(AGENT);
      if (client === null) throw new Error('no agent client');
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
            subjectId: owner.subjectId,
            scope: ['openid'],
            sessionId: newId(),
            grantId: owner.grantId,
            clientDbId: client.id,
            requestedUserinfoClaims: null,
            act: undefined,
            mayAct: undefined,
            expiresAt: new Date(stack.clock.now().getTime() + 300_000),
          },
          actorSubject: AGENT,
          requestedScope: ['openid'],
          now: stack.clock.now(),
        },
      );
    });
    expect(outcome).toMatchObject({ kind: 'refused', invariant: 'parent_not_live' });
  });

  it('refuses an exchange whose owner session has expired, leaving no instance', async () => {
    const owner = await login(stack, AGENT);
    await stack.owner.db.execute(
      sql`update sessions set expires_at = now() - interval '1 minute'
           where id = (select session_id from token_grants where id = ${owner.grantId})`,
    );
    const before = await instanceCount();
    const res = await exchange(stack, AGENT, owner.accessToken);
    expect(res.statusCode).toBe(400);
    expect(await instanceCount()).toBe(before);
  });

  it('refuses an exchange whose owner session was ended, leaving no instance', async () => {
    const owner = await login(stack, AGENT);
    await withTenant(stack.app.db, stack.tenantId, async (tx) => {
      const grant = await tokenGrantRepository(tx).byId(owner.grantId);
      if (grant?.sessionId == null) throw new Error('grant has no session');
      expect(await sessionRepository(tx).end(grant.sessionId, stack.clock.now())).toBe(true);
    });
    const before = await instanceCount();
    const res = await exchange(stack, AGENT, owner.accessToken);
    expect(res.statusCode).toBe(400);
    expect(await instanceCount()).toBe(before);
  });
});

async function grantActedBy(head: string, actorSubjectId: string | null) {
  const owner = await login(stack, AGENT);
  const raw = `refresh-${newId()}`;
  await withTenant(stack.app.db, stack.tenantId, async (tx) => {
    const grantId = newId();
    await tokenGrantRepository(tx).create({
      id: grantId,
      tenantId: stack.tenantId,
      clientId: agentDbId,
      subjectId: owner.subjectId,
      scope: 'openid',
      audience: ['https://api.example'],
      actChain: { sub: head },
      ...(actorSubjectId === null ? {} : { actorSubjectId }),
    });
    await refreshTokenRepository(tx).create({
      tokenHash: hashRefreshToken(raw),
      tenantId: stack.tenantId,
      grantId,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
  });
  return { owner, raw };
}

async function instanceFor(owner: { grantId: string; subjectId: string }): Promise<string> {
  return withTenant(stack.app.db, stack.tenantId, async (tx) => {
    const instance = await agentInstanceRepository(tx).mint({
      id: newId(),
      tenantId: stack.tenantId,
      ownerSubjectId: owner.subjectId,
      agentClientId: agentDbId,
      parentInstanceId: null,
      rootGrantId: owner.grantId,
      depth: 1,
      scope: 'openid',
      expiresAt: new Date(Date.now() + 3_600_000),
      idleExpiresAt: null,
    });
    return instance.id;
  });
}

describe('a refresh whose grant names an instance as its actor', () => {
  function refresh(raw: string) {
    return stack.http.inject({
      method: 'POST',
      url: `/tenants/${stack.tenantName}/protocol/openid-connect/token`,
      payload: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: raw }).toString(),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: basic(AGENT),
      },
    });
  }

  async function namingInstance() {
    const owner = await login(stack, AGENT);
    const id = await instanceFor(owner);
    const { raw } = await grantActedBy(id, id);
    return { id, raw };
  }

  it('keeps the act of a live instance', async () => {
    const { id, raw } = await namingInstance();
    const res = await refresh(raw);
    expect(res.statusCode).toBe(200);
    expect(decode(res.json<{ access_token: string }>().access_token).act).toEqual({ sub: id });
  });

  it('is refused invalid_grant once the instance was revoked', async () => {
    const { id, raw } = await namingInstance();
    await stack.owner.db.execute(
      sql`update agent_instances set revoked_at = now() where id = ${id}`,
    );
    const res = await refresh(raw);
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_grant');
  });

  it('is refused invalid_grant once the instance lapsed', async () => {
    const { id, raw } = await namingInstance();
    await stack.owner.db.execute(
      sql`update agent_instances set expires_at = now() - interval '1 minute' where id = ${id}`,
    );
    const res = await refresh(raw);
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_grant');
  });

  it('is refused invalid_grant once the instance idled out', async () => {
    const { id, raw } = await namingInstance();
    await stack.owner.db.execute(
      sql`update agent_instances set idle_expires_at = now() - interval '1 minute' where id = ${id}`,
    );
    expect((await refresh(raw)).statusCode).toBe(400);
  });

  it('is refused invalid_grant once the instance row and subject were deleted', async () => {
    const { id, raw } = await namingInstance();
    await stack.owner.db.execute(sql`delete from agent_instances where id = ${id}`);
    await stack.owner.db.execute(sql`delete from subjects where id = ${id}`);
    const res = await refresh(raw);
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_grant');
  });

  it('leaves a grant whose act names a client id unchanged', async () => {
    const { raw } = await grantActedBy('some-client', null);
    const res = await refresh(raw);
    expect(res.statusCode).toBe(200);
    expect(decode(res.json<{ access_token: string }>().access_token).act).toEqual({
      sub: 'some-client',
    });
  });

  it('leaves a grant whose act names a user subject unchanged', async () => {
    const owner = await login(stack, AGENT);
    const { raw } = await grantActedBy(owner.subjectId, owner.subjectId);
    expect((await refresh(raw)).statusCode).toBe(200);
  });
});

describe('an exchange of a token whose act head is an agent instance', () => {
  const ended: [string, string][] = [
    ['revoked', 'revoked_at = now()'],
    ['lapsed', "expires_at = now() - interval '1 minute'"],
  ];

  async function end(id: string, change: string): Promise<void> {
    await stack.owner.db.execute(
      sql`update agent_instances set ${sql.raw(change)} where id = ${id}`,
    );
  }

  const refusedAsInvalidRequest = (res: LightMyRequestResponse): void => {
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_request');
  };

  it.each(ended)('refuses an access token whose head instance is %s', async (_name, change) => {
    const owner = await login(stack, AGENT);
    const { token, id } = await firstInstance(owner);
    await end(id, change);
    refusedAsInvalidRequest(await exchange(stack, PLAIN, token));
  });

  it.each(ended)('refuses a refresh token whose head instance is %s', async (_name, change) => {
    const owner = await login(stack, AGENT);
    const id = await instanceFor(owner);
    const { raw } = await grantActedBy(id, id);
    await end(id, change);
    refusedAsInvalidRequest(await exchange(stack, PLAIN, raw, { type: 'refresh' }));
  });

  it('carries a live head instance into the new token', async () => {
    const owner = await login(stack, AGENT);
    const { token, id } = await firstInstance(owner);
    const res = await exchange(stack, PLAIN, token);
    expect(res.statusCode).toBe(200);
    expect(decode(res.json<{ access_token: string }>().access_token).act).toEqual({ sub: id });
  });

  it('leaves a head that is a client id unchanged', async () => {
    const { raw } = await grantActedBy('some-client', null);
    const res = await exchange(stack, PLAIN, raw, { type: 'refresh' });
    expect(res.statusCode).toBe(200);
    expect(decode(res.json<{ access_token: string }>().access_token).act).toEqual({
      sub: 'some-client',
    });
  });

  it('leaves a head that is a client with a UUID-shaped client_id unchanged', async () => {
    const clientId = newId();
    await addClient(stack, { clientId });
    const { raw } = await grantActedBy(clientId, null);
    expect((await exchange(stack, PLAIN, raw, { type: 'refresh' })).statusCode).toBe(200);
  });
});
