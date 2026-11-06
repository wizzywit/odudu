import { SessionEntry, sessionRepository } from '@odudu/authn-flows';
import { signingKeyRepository, signJwt } from '@odudu/crypto';
import { createDatabase, MIGRATIONS_DIR, runMigrations, tenants, withTenant } from '@odudu/db';
import type { DatabaseHandle } from '@odudu/db';
import { roleRepository, subjectRoles } from '@odudu/domain-authz';
import { subjectRepository } from '@odudu/domain-identity';
import {
  ADMIN_API_AUDIENCE,
  ADMIN_CLIENT_ID,
  clientRepository,
  MCP_CLIENT_ID,
} from '@odudu/domain-tenant';
import { loadConfig, mcpAudienceOfIssuer, newId } from '@odudu/kernel';
import {
  newRequestScope,
  ToolProblem,
  validatedMcpToken,
  type AdminRequestSpec,
  type McpCallDeps,
  type McpDeps,
  type ValidatedMcpToken,
  type VerifiedMcpClaims,
} from '@odudu/mcp';
import {
  clientOidcConfigRepository,
  standardClaimMappers,
  tokenGrantRepository,
} from '@odudu/protocol-oidc';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { and, eq } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { seed } from '#/cli/seed';
import { createLogger } from '#/logger';
import { adminCallerFor, mcpDepsFor } from '#/mcp-deps';

// An MCP token's owner reaches the admin API through the in-process caller,
// as the agent, on a token the server signs for the call.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let app: FastifyInstance;
let deps: McpDeps;
const minted: string[] = [];
const injected: { headers?: Record<string, unknown> }[] = [];

const KEK = Buffer.alloc(32, 7);
const BASE = 'https://id.example.com';

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  appDb = createDatabase(appUrl, { max: 5 });
  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
  const config = loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' });
  const logger = createLogger(config);
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
  const real = mcpDepsFor({
    app,
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    claimMappers: standardClaimMappers(),
    logger,
    publicBaseUrl: BASE,
  });
  deps = {
    ...real,
    mintAgentToken: async (token, input) => {
      const result = await real.mintAgentToken(token, input);
      minted.push(result.accessToken);
      return result;
    },
    inject: (options) => {
      injected.push(options);
      return real.inject(options);
    },
  };
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
  readonly subjectId: string;
  readonly sessionId: string;
  readonly grantId: string;
  readonly agentDbId: string;
  readonly adminDbId: string;
  readonly issuer: string;
}

async function world(capabilities: readonly string[], grantScope = 'mcp:read mcp:write') {
  const name = `mcp-${newId()}`;
  const seeded = await seed({
    tenant: name,
    clientId: 'portal',
    redirectUris: ['https://app.example/callback'],
  });
  const issuer = `${BASE}/tenants/${name}`;
  return withTenant(appDb.db, seeded.tenantId, async (tx): Promise<World> => {
    const admin = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
    const agent = await clientRepository(tx).byClientId(MCP_CLIENT_ID);
    if (admin === null || agent === null) throw new Error('the tenant has no built-in clients');
    const subject = await subjectRepository(tx).create({ tenantId: seeded.tenantId, type: 'user' });
    for (const capability of capabilities) {
      const role = await roleRepository(tx).byName(capability, admin.id);
      if (role === null) throw new Error(`no role ${capability}`);
      await roleRepository(tx).assignToSubject(subject.id, role.id);
    }
    const sessionId = newId();
    await sessionRepository(tx).create({
      id: sessionId,
      tenantId: seeded.tenantId,
      subjectId: subject.id,
      expiresAt: new Date(Date.now() + 24 * 3600_000),
      authenticators: ['pwd'],
      secretHash: SessionEntry.issue(sessionId).secretHash(),
    });
    const grantId = newId();
    await tokenGrantRepository(tx).create({
      id: grantId,
      tenantId: seeded.tenantId,
      clientId: agent.id,
      subjectId: subject.id,
      scope: grantScope,
      audience: [mcpAudienceOfIssuer(issuer)],
      sessionId,
    });
    return {
      tenantId: seeded.tenantId,
      name,
      subjectId: subject.id,
      sessionId,
      grantId,
      agentDbId: agent.id,
      adminDbId: admin.id,
      issuer,
    };
  });
}

// Built as the endpoint will build it from a verified payload: `exp` in seconds.
function tokenOf(w: World, overrides: Partial<VerifiedMcpClaims> = {}): ValidatedMcpToken {
  return validatedMcpToken({
    tenant: { id: w.tenantId, name: w.name },
    issuer: w.issuer,
    subjectId: w.subjectId,
    clientId: MCP_CLIENT_ID,
    grantId: w.grantId,
    scope: ['mcp:read', 'mcp:write'],
    expSeconds: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  });
}

function request(): McpCallDeps {
  return { ...deps, request: newRequestScope(newId(), '10.1.2.3') };
}

const WHOAMI: AdminRequestSpec = {
  method: 'GET',
  pattern: '/admin/tenants/:tenant/whoami',
  params: {},
  query: {},
};
const CLIENTS: AdminRequestSpec = {
  method: 'GET',
  pattern: '/admin/tenants/:tenant/clients',
  params: {},
  query: {},
};

function claimsOf(token: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(
    Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
  );
  return parsed as Record<string, unknown>;
}

const CAPS = ['manage-clients', 'view-users'];

describe('what the admin API sees of an in-process call', () => {
  it('is the owner, acting through the agent, narrowed to the one scope', async () => {
    const w = await world(CAPS);
    const before = minted.length;
    const result = await adminCallerFor(request(), tokenOf(w)).call(WHOAMI);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      subjectId: w.subjectId,
      issuerTenantId: w.tenantId,
      capabilities: ['manage-clients', 'view-users'],
    });
    const claims = claimsOf(minted[before] ?? '');
    expect(claims).toMatchObject({
      sub: w.subjectId,
      act: { sub: MCP_CLIENT_ID },
      client_id: MCP_CLIENT_ID,
      scope: 'mcp:read',
      grant_id: w.grantId,
      sid: w.sessionId,
      iss: w.issuer,
    });
    expect(claims.aud).toContain(ADMIN_API_AUDIENCE);
  });

  it('sets no cookie, takes no header from the tool, and carries a fixed set', async () => {
    const w = await world(CAPS);
    const before = injected.length;
    const spec = {
      ...WHOAMI,
      headers: {
        cookie: 'sid=stolen',
        authorization: 'Bearer forged',
        'x-forwarded-for': '1.1.1.1',
      },
    };
    const result = await adminCallerFor(request(), tokenOf(w)).call(spec);
    expect(result.status).toBe(200);
    expect(Object.keys(result.headers).sort()).toEqual(['content-type']);
    const sent = injected[before]?.headers ?? {};
    expect(Object.keys(sent).sort()).toEqual(['accept', 'authorization', 'host', 'x-request-id']);
    expect(sent.authorization).not.toBe('Bearer forged');
  });

  it("never reaches a tenant other than the token's", async () => {
    const mine = await world(CAPS);
    const theirs = await world(CAPS);
    await expect(
      adminCallerFor(request(), tokenOf(mine)).call({ ...WHOAMI, params: { tenant: theirs.name } }),
    ).rejects.toThrow('tenant');
  });
});

describe('every call is judged again', () => {
  it('fails the second call once the owner loses the role, even on the same bearer', async () => {
    const w = await world(CAPS);
    const scope = request();
    const caller = adminCallerFor(scope, tokenOf(w));
    expect((await caller.call(CLIENTS)).status).toBe(200);
    await withTenant(appDb.db, w.tenantId, async (tx) => {
      const role = await roleRepository(tx).byName('manage-clients', w.adminDbId);
      if (role === null) throw new Error('no role');
      await tx
        .delete(subjectRoles)
        .where(and(eq(subjectRoles.subjectId, w.subjectId), eq(subjectRoles.roleId, role.id)));
    });
    const before = minted.length;
    expect((await caller.call(CLIENTS)).status).toBe(403);
    expect(minted.length).toBe(before);
    expect((await adminCallerFor(request(), tokenOf(w)).call(CLIENTS)).status).toBe(403);
  });

  it.each([
    [
      'a revoked grant',
      (w: World) =>
        withTenant(appDb.db, w.tenantId, (tx) =>
          tokenGrantRepository(tx).revoke(w.grantId, new Date()),
        ),
    ],
    [
      'an ended session',
      (w: World) =>
        withTenant(appDb.db, w.tenantId, (tx) =>
          sessionRepository(tx).end(w.sessionId, new Date()),
        ),
    ],
    [
      'a disabled agent client',
      (w: World) =>
        withTenant(appDb.db, w.tenantId, (tx) =>
          clientRepository(tx).update(w.agentDbId, { enabled: false }),
        ),
    ],
    [
      'a disabled subject',
      (w: World) =>
        withTenant(appDb.db, w.tenantId, (tx) =>
          subjectRepository(tx).setEnabled(w.subjectId, false),
        ),
    ],
    [
      'a disabled tenant',
      async (w: World) => {
        await owner.db.update(tenants).set({ enabled: false }).where(eq(tenants.id, w.tenantId));
      },
    ],
  ])('fails the next call after %s', async (_label, end) => {
    const w = await world(CAPS);
    const scope = request();
    const caller = adminCallerFor(scope, tokenOf(w));
    expect((await caller.call(WHOAMI)).status).toBe(200);
    await end(w);
    // The bearer cached in this request is refused by the admin API itself.
    expect((await caller.call(WHOAMI)).status).toBe(401);
    // A request that has to mint again is refused before anything is sent.
    const fresh = await adminCallerFor(request(), tokenOf(w))
      .call(WHOAMI)
      .catch((e: unknown) => e);
    expect(fresh).toBeInstanceOf(ToolProblem);
    expect(fresh).toMatchObject({ problemType: 'mcp:access_ended', status: 401 });
  });
});

describe('scope and life', () => {
  it('cannot write with a read token: not by the caller, not by the admin API', async () => {
    const w = await world(CAPS, 'mcp:read');
    const token = tokenOf(w, { scope: ['mcp:read'] });
    const patch: AdminRequestSpec = {
      method: 'PATCH',
      pattern: '/admin/tenants/:tenant/clients/:id',
      params: { id: w.adminDbId },
      query: {},
    };
    const error = await adminCallerFor(request(), token)
      .call(patch)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ problemType: 'mcp:insufficient_scope', status: 403 });

    const before = minted.length;
    await adminCallerFor(request(), token).call(WHOAMI);
    const raw = await app.inject({
      method: 'PATCH',
      url: `/admin/tenants/${w.name}/clients/${w.adminDbId}`,
      headers: {
        host: 'id.example.com',
        authorization: `Bearer ${minted[before] ?? ''}`,
        'content-type': 'application/json',
      },
      payload: { description: 'no' },
    });
    expect(raw.statusCode).toBe(403);
  });

  it('reads with a token that holds only mcp:write, under that one scope', async () => {
    const w = await world(CAPS, 'mcp:write');
    const before = minted.length;
    const result = await adminCallerFor(request(), tokenOf(w, { scope: ['mcp:write'] })).call(
      WHOAMI,
    );
    expect(result.status).toBe(200);
    expect(claimsOf(minted[before] ?? '').scope).toBe('mcp:write');
  });

  it('refuses a token whose sub is not the owner of its grant', async () => {
    const w = await world(CAPS);
    const stranger = await world(CAPS);
    const error = await adminCallerFor(request(), tokenOf(w, { subjectId: stranger.subjectId }))
      .call(WHOAMI)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ problemType: 'mcp:access_ended', status: 401 });
  });

  it('lives no longer than five minutes, nor than the token it came from', async () => {
    const w = await world(CAPS);
    const start = Math.floor(Date.now() / 1000);
    const before = minted.length;
    await adminCallerFor(request(), tokenOf(w)).call(WHOAMI);
    const long = Number(claimsOf(minted[before] ?? '').exp) - start;
    expect(long).toBeGreaterThan(290);
    expect(long).toBeLessThanOrEqual(301);

    await adminCallerFor(
      request(),
      tokenOf(w, { expSeconds: Math.floor(Date.now() / 1000) + 60 }),
    ).call(WHOAMI);
    const short = Number(claimsOf(minted[before + 1] ?? '').exp) - start;
    expect(short).toBeLessThanOrEqual(61);
    expect(short).toBeGreaterThan(55);
  });

  it('is not minted for a token that has already ended', async () => {
    const w = await world(CAPS);
    const error = await adminCallerFor(
      request(),
      tokenOf(w, { expSeconds: Math.floor(Date.now() / 1000) - 1 }),
    )
      .call(WHOAMI)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ problemType: 'mcp:access_ended' });
  });
});

describe('two requests at once', () => {
  it('keep their bearers apart', async () => {
    const [a, b] = await Promise.all([world(CAPS), world(['view-users'])]);
    const one = request();
    const two = request();
    const [ra, rb] = await Promise.all([
      adminCallerFor(one, tokenOf(a)).call(WHOAMI),
      adminCallerFor(two, tokenOf(b)).call(WHOAMI),
    ]);
    expect(ra.body).toMatchObject({ subjectId: a.subjectId });
    expect(rb.body).toMatchObject({ subjectId: b.subjectId, capabilities: ['view-users'] });
    expect([...one.request.bearers.values()]).toHaveLength(1);
    expect([...one.request.bearers.values()][0]?.bearer).not.toBe(
      [...two.request.bearers.values()][0]?.bearer,
    );
  });
});

describe('an MCP token presented at /token', () => {
  async function exchange(w: World) {
    const key = await withTenant(appDb.db, w.tenantId, (tx) => signingKeyRepository(tx).active());
    const now = Math.floor(Date.now() / 1000);
    const subjectToken = await signJwt(
      {
        iss: w.issuer,
        aud: [w.issuer, mcpAudienceOfIssuer(w.issuer)],
        sub: w.subjectId,
        client_id: MCP_CLIENT_ID,
        scope: 'mcp:read',
        grant_id: w.grantId,
        sid: w.sessionId,
        iat: now,
        exp: now + 300,
        jti: newId(),
      },
      { key, kek: KEK, typ: 'at+jwt' },
    );
    return app.inject({
      method: 'POST',
      url: `/tenants/${w.name}/protocol/openid-connect/token`,
      headers: { host: 'id.example.com', 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        client_id: MCP_CLIENT_ID,
        subject_token: subjectToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        resource: ADMIN_API_AUDIENCE,
        scope: 'mcp:read',
      }).toString(),
    });
  }

  it('does not buy a public client an admin token', async () => {
    const w = await world(CAPS);
    const res = await exchange(w);
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.json<{ error: string }>().error).toBe('unauthorized_client');
    expect(res.body).not.toContain('access_token');
  });

  it('would, were the operator to switch the exchange on: the refusal is that setting', async () => {
    const w = await world(CAPS);
    await withTenant(appDb.db, w.tenantId, async (tx) => {
      const repo = clientOidcConfigRepository(tx);
      const config = await repo.byClientId(w.agentDbId);
      if (config === null) throw new Error('no config');
      await repo.update(w.agentDbId, {
        grantTypes: [...config.grantTypes, 'urn:ietf:params:oauth:grant-type:token-exchange'],
        audiences: [...config.audiences, ADMIN_API_AUDIENCE],
        tokenExchangeImpersonationAllowed: true,
        tokenExchangeAllowedForPublic: true,
      });
    });
    const res = await exchange(w);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ access_token: string }>().access_token).toBeTruthy();
  });
});
