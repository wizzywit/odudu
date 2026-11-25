import { SessionEntry, sessionRepository } from '@odudu/authn-flows';
import { signingKeyRepository, signJwt } from '@odudu/crypto';
import { createDatabase, MIGRATIONS_DIR, runMigrations, withTenant } from '@odudu/db';
import type { DatabaseHandle, TenantScopedDatabase } from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
import { hashPassword, subjectRepository, userRepository } from '@odudu/domain-identity';
import { clientRepository, provisionClientDefaults } from '@odudu/domain-tenant';
import { loadConfig, meAudienceOfIssuer, newId } from '@odudu/kernel';
import { clientOidcConfigRepository, mayActFor } from '@odudu/protocol-oidc';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { seed } from '#/cli/seed';
import { createLogger } from '#/logger';

// Delegations through the real app: real signing keys, a real database.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let app: FastifyInstance;

const KEK = Buffer.alloc(32, 7);
const BASE = 'https://id.example.com';
const HOST = 'id.example.com';

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  appDb = createDatabase(appUrl, { max: 12 });
  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
  const logger = createLogger(loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' }));
  app = buildApp({
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger,
    tls: true,
    publicBaseUrl: BASE,
    throttle: { limit: 100_000, windowSeconds: 60 },
  });
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app.close();
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  await appDb.close();
  await owner.close();
  await container.stop();
});

interface World {
  readonly tenantId: string;
  readonly name: string;
  readonly issuer: string;
  readonly subjectId: string;
  readonly otherSubjectId: string;
  readonly portalDbId: string;
  readonly assistantDbId: string;
  readonly sessionId: string;
  readonly otherSessionId: string;
}

async function openSession(tx: TenantScopedDatabase, tenantId: string, subjectId: string) {
  const entry = SessionEntry.issue(newId());
  await sessionRepository(tx).create({
    id: entry.id,
    tenantId,
    subjectId,
    expiresAt: new Date(Date.now() + 24 * 3600_000),
    authenticators: ['pwd'],
    secretHash: entry.secretHash(),
  });
  return entry.id;
}

async function addClient(
  tx: TenantScopedDatabase,
  tenantId: string,
  clientId: string,
  options: { agentType: boolean; enabled?: boolean },
): Promise<string> {
  const client = await clientRepository(tx).create({
    tenantId,
    clientId,
    name: clientId,
    type: 'confidential',
    secretHash: await hashPassword('unused-secret'),
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  });
  await provisionClientDefaults(tx, client.id);
  await clientOidcConfigRepository(tx).create({
    clientId: client.id,
    tenantId,
    redirectUris: [`https://${clientId}.example/callback`],
    grantTypes: ['authorization_code'],
    tokenEndpointAuthMethod: 'client_secret_basic',
    audiences: [],
    accessTokenTtlSeconds: 300,
    refreshTokenTtlSeconds: 1_209_600,
    agentType: options.agentType,
  });
  return client.id;
}

async function world(): Promise<World> {
  const name = `mdl-${newId()}`;
  const seeded = await seed({
    tenant: name,
    clientId: 'portal',
    redirectUris: ['https://app.example/callback'],
    username: 'ada',
    password: 'correct horse battery staple 1!',
    email: 'ada@example.com',
  });
  const subjectId = seeded.userSubjectId;
  if (subjectId === undefined) throw new Error('no user');
  const { tenantId } = seeded;
  return withTenant(appDb.db, tenantId, async (tx) => {
    const other = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await userRepository(tx).create({
      subjectId: other.id,
      tenantId,
      username: 'grace',
      email: 'grace@example.com',
    });
    const portal = await clientRepository(tx).byClientId('portal');
    if (portal === null) throw new Error('no client');
    const assistantDbId = await addClient(tx, tenantId, 'assistant', { agentType: true });
    await addClient(tx, tenantId, 'plain', { agentType: false });
    await addClient(tx, tenantId, 'off', { agentType: true, enabled: false });
    return {
      tenantId,
      name,
      issuer: `${BASE}/tenants/${name}`,
      subjectId,
      otherSubjectId: other.id,
      portalDbId: portal.id,
      assistantDbId,
      sessionId: await openSession(tx, tenantId, subjectId),
      otherSessionId: await openSession(tx, tenantId, other.id),
    };
  });
}

async function sign(
  w: World,
  claims: Record<string, unknown> = {},
  as: 'owner' | 'other' = 'owner',
): Promise<string> {
  const key = await withTenant(appDb.db, w.tenantId, (tx) => signingKeyRepository(tx).active());
  const iat = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      iss: w.issuer,
      sub: as === 'owner' ? w.subjectId : w.otherSubjectId,
      aud: [meAudienceOfIssuer(w.issuer)],
      client_id: 'portal',
      sid: as === 'owner' ? w.sessionId : w.otherSessionId,
      scope: 'openid me:read me:write',
      iat,
      exp: iat + 600,
      ...claims,
    },
    { key, kek: KEK, typ: 'at+jwt' },
  );
}

async function call(
  w: World,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  token: string,
  body?: object,
) {
  return app.inject({
    method,
    url: `/tenants/${w.name}/me/${path}`,
    headers: { host: HOST, authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { payload: body }),
  });
}

const BODY = {
  client_id: 'portal',
  actor_client_id: 'assistant',
  scope_ceiling: 'openid profile',
  expires_in: 3600,
};

const create = (w: World, token: string, over: object = {}) =>
  call(w, 'POST', 'delegations', token, { ...BODY, ...over });

type Answer = Awaited<ReturnType<typeof create>>;
const idOf = (res: Answer): string => res.json<{ id: string }>().id;
const idsOf = (res: Answer): string[] =>
  res.json<{ items: { id: string }[] }>().items.map((i) => i.id);

const read = <Result>(w: World, run: (tx: TenantScopedDatabase) => Promise<Result>) =>
  withTenant(appDb.db, w.tenantId, run);

function mayAct(w: World, subjectId = w.subjectId) {
  return read(w, (tx) =>
    mayActFor(tx, {
      subjectId,
      clientDbId: w.portalDbId,
      delegatedActors: [],
      issuer: w.issuer,
      now: new Date(),
    }),
  );
}

describe('POST /me/delegations', () => {
  it('records the delegation, names the clients by client_id and files the lineage row', async () => {
    const w = await world();
    const res = await create(w, await sign(w));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      client_id: 'portal',
      actor_client_id: 'assistant',
      scope_ceiling: 'openid profile',
    });
    const id = idOf(res);
    const rows = await read(w, (tx) =>
      auditRepository(tx).list({ action: 'agent.delegation_created', limit: 10 }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventType: 'agent_identity',
      outcome: 'allowed',
      actorSubjectId: w.subjectId,
      actorClientId: w.portalDbId,
      resourceType: 'agent_delegation',
      resourceId: id,
      detail: { agent_client: 'assistant', owner: w.subjectId, delegation: id },
    });
  });

  it('makes mayActFor name the actor, and revoking makes it name nobody again', async () => {
    const w = await world();
    expect(await mayAct(w)).toBeUndefined();
    const id = idOf(await create(w, await sign(w)));
    expect(await mayAct(w)).toEqual({ sub: 'assistant', iss: w.issuer });
    expect(await mayAct(w, w.otherSubjectId)).toBeUndefined();
    expect((await call(w, 'DELETE', `delegations/${id}`, await sign(w))).statusCode).toBe(204);
    expect(await mayAct(w)).toBeUndefined();
  });

  it.each([
    ['a client that is not an agent client', { actor_client_id: 'plain' }],
    ['a disabled agent client', { actor_client_id: 'off' }],
    ['an agent client that does not exist', { actor_client_id: 'nobody' }],
    ['a sign-in client that does not exist', { client_id: 'nobody' }],
  ])('refuses %s with 400 and creates nothing', async (_, over) => {
    const w = await world();
    const res = await create(w, await sign(w), over);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_request' });
    const listed = await call(w, 'GET', 'delegations', await sign(w));
    expect(listed.json()).toEqual({ items: [] });
  });

  it('refuses a token issued to an agent, and creates nothing', async () => {
    const w = await world();
    const agent = await sign(w, { act: { sub: 'agent-1', client_id: 'assistant' } });
    expect((await create(w, agent)).statusCode).toBe(403);
    expect((await call(w, 'GET', 'delegations', await sign(w))).json()).toEqual({ items: [] });
  });

  it('holds a subject to 20 live delegations, and a revoked one frees a place', async () => {
    const w = await world();
    const token = await sign(w);
    const ids: string[] = [];
    for (let n = 0; n < 20; n += 1) {
      const res = await create(w, token);
      expect(res.statusCode).toBe(201);
      ids.push(idOf(res));
    }
    const over = await create(w, token);
    expect(over.statusCode).toBe(409);
    expect(over.json()).toMatchObject({ error: 'conflict' });
    const other = await create(w, await sign(w, {}, 'other'));
    expect(other.statusCode).toBe(201);

    expect((await call(w, 'DELETE', `delegations/${ids[0] ?? ''}`, token)).statusCode).toBe(204);
    expect((await create(w, token)).statusCode).toBe(201);
    expect((await create(w, token)).statusCode).toBe(409);
    const created = await read(w, (tx) =>
      auditRepository(tx).list({ action: 'agent.delegation_created', limit: 50 }),
    );
    expect(created).toHaveLength(22);
  });

  it('admits exactly 20 when thirty creates race', async () => {
    const w = await world();
    const token = await sign(w);
    const answers = await Promise.all(Array.from({ length: 30 }, () => create(w, token)));
    expect(answers.filter((res) => res.statusCode === 201)).toHaveLength(20);
    expect(answers.filter((res) => res.statusCode === 409)).toHaveLength(10);
    expect(idsOf(await call(w, 'GET', 'delegations', token))).toHaveLength(20);
  });
});

describe('GET and DELETE /me/delegations', () => {
  it('lists only the caller’s own live delegations, newest first', async () => {
    const w = await world();
    const mine = idOf(await create(w, await sign(w)));
    const gone = idOf(await create(w, await sign(w)));
    await call(w, 'DELETE', `delegations/${gone}`, await sign(w));
    const theirs = idOf(await create(w, await sign(w, {}, 'other')));

    const own = idsOf(await call(w, 'GET', 'delegations', await sign(w)));
    expect(own).toEqual([mine]);
    const others = idsOf(await call(w, 'GET', 'delegations', await sign(w, {}, 'other')));
    expect(others).toEqual([theirs]);
  });

  it('answers 404 to a person revoking another’s delegation, and leaves it live', async () => {
    const w = await world();
    const id = idOf(await create(w, await sign(w)));
    const res = await call(w, 'DELETE', `delegations/${id}`, await sign(w, {}, 'other'));
    expect(res.statusCode).toBe(404);
    expect(await mayAct(w)).toEqual({ sub: 'assistant', iss: w.issuer });
    expect(
      await read(w, (tx) =>
        auditRepository(tx).list({ action: 'agent.delegation_revoked', limit: 10 }),
      ),
    ).toEqual([]);
  });

  it('answers 404 to a person of another tenant, and for a revoke made twice', async () => {
    const w = await world();
    const foreign = await world();
    const id = idOf(await create(w, await sign(w)));
    const across = await call(foreign, 'DELETE', `delegations/${id}`, await sign(foreign));
    expect(across.statusCode).toBe(404);
    expect((await call(w, 'DELETE', `delegations/${id}`, await sign(w))).statusCode).toBe(204);
    expect((await call(w, 'DELETE', `delegations/${id}`, await sign(w))).statusCode).toBe(404);
    const revoked = await read(w, (tx) =>
      auditRepository(tx).list({ action: 'agent.delegation_revoked', limit: 10 }),
    );
    expect(revoked).toHaveLength(1);
    expect(revoked[0]).toMatchObject({
      actorSubjectId: w.subjectId,
      resourceId: id,
      detail: { agent_client: 'assistant', owner: w.subjectId, delegation: id },
    });
  });

  it('does not list a delegation once it has expired', async () => {
    const w = await world();
    const id = idOf(await create(w, await sign(w)));
    await owner.db.execute(
      sql`update agent_delegations set expires_at = now() - interval '1 second' where id = ${id}`,
    );
    expect((await call(w, 'GET', 'delegations', await sign(w))).json()).toEqual({ items: [] });
    expect(await mayAct(w)).toBeUndefined();
  });
});
