import { generateSigningKey, signingKeyRepository, verifyJwt } from '@odudu/crypto';
import { createDatabase, MIGRATIONS_DIR, runMigrations, tenants, withTenant } from '@odudu/db';
import type { DatabaseHandle, TenantScopedDatabase } from '@odudu/db';
import { provisionTenant, SessionEntry, sessionRepository } from '@odudu/authn-flows';
import { subjectRepository } from '@odudu/domain-identity';
import {
  ADMIN_API_AUDIENCE,
  clientRepository,
  provisionClientDefaults,
  type ClientRecord,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { standardClaimMappers } from '#/service/claims';
import { tokenGrantRepository } from '#/repository/grants';
import { tenantEnabledRepository } from '#/repository/tenant-enabled';
import { refreshTokenRepository } from '#/repository/refresh';
import { tokenGrants } from '#/schema/token-grants';
import { AGENT_TOKEN_MAX_TTL_SECONDS } from '#/service/mcp-scopes';
import {
  AgentTokenRefused,
  mintAgentToken,
  type MintAgentTokenDeps,
  type MintAgentTokenInput,
} from '#/usecase/mint-agent-token';

const KEK = Buffer.alloc(32, 31);
const AGENT = 'agent-client';
const MCP_AUDIENCE = 'https://odudu.test/tenants/acme/mcp';
const LIFESPANS = {
  ssoSessionIdleSeconds: 30 * 24 * 3600,
  ssoSessionMaxSeconds: 30 * 24 * 3600,
  rememberMeIdleSeconds: 30 * 24 * 3600,
  rememberMeMaxSeconds: 30 * 24 * 3600,
};

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

interface World {
  tenantId: string;
  issuer: string;
  agent: ClientRecord;
  subjectId: string;
  sessionId: string;
  grantId: string;
  deps: MintAgentTokenDeps;
}

const NOW = new Date(Math.floor(Date.now() / 1000) * 1000);

async function newClient(tx: TenantScopedDatabase, tenantId: string, clientId: string) {
  const client = await clientRepository(tx).create({
    tenantId,
    clientId,
    name: clientId,
    type: 'public',
    secretHash: null,
  });
  await provisionClientDefaults(tx, client.id);
  return client;
}

async function grantFor(
  tx: TenantScopedDatabase,
  w: Pick<World, 'tenantId' | 'subjectId' | 'sessionId'>,
  clientDbId: string,
  scope: string,
): Promise<string> {
  const id = newId();
  await tokenGrantRepository(tx).create({
    id,
    tenantId: w.tenantId,
    clientId: clientDbId,
    subjectId: w.subjectId,
    scope,
    audience: [MCP_AUDIENCE],
    sessionId: w.sessionId,
  });
  return id;
}

async function newWorld(grantScope = 'mcp:read mcp:write'): Promise<World> {
  const tenantId = newId();
  const name = `mint-${newId()}`;
  const issuer = `https://odudu.test/tenants/${name}`;
  return withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name });
    await provisionTenant(tx, tenantId);
    const generated = await generateSigningKey('ES256', KEK);
    await signingKeyRepository(tx).create({
      id: newId(),
      tenantId,
      kid: generated.kid,
      alg: generated.alg,
      status: 'active',
      publicJwk: generated.publicJwk,
      privateJwkEncrypted: generated.privateJwkEncrypted,
    });
    const agent = await newClient(tx, tenantId, AGENT);
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    const sessionId = newId();
    await sessionRepository(tx).create({
      id: sessionId,
      tenantId,
      subjectId: subject.id,
      expiresAt: new Date(NOW.getTime() + 24 * 3600 * 1000),
      authenticators: ['pwd'],
      secretHash: SessionEntry.issue(sessionId).secretHash(),
    });
    const base = { tenantId, subjectId: subject.id, sessionId };
    const grantId = await grantFor(tx, base, agent.id, grantScope);
    return {
      ...base,
      issuer,
      agent,
      grantId,
      deps: {
        tenantId,
        issuer,
        kek: KEK,
        claimMappers: standardClaimMappers(),
        lifespans: LIFESPANS,
      },
    };
  });
}

function input(w: World, over: Partial<MintAgentTokenInput> = {}): MintAgentTokenInput {
  return {
    subjectGrantId: w.grantId,
    expectedSubjectId: w.subjectId,
    agentClientId: AGENT,
    audience: ADMIN_API_AUDIENCE,
    scope: ['mcp:read'],
    notAfter: new Date(NOW.getTime() + 3600_000),
    now: NOW,
    ...over,
  };
}

function mint(w: World, over: Partial<MintAgentTokenInput> = {}) {
  return withTenant(app.db, w.tenantId, (tx) => mintAgentToken(tx, w.deps, input(w, over)));
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AgentTokenRefused);
  return error instanceof AgentTokenRefused ? error.reason : 'not refused';
}

function claimsOf(token: string): Record<string, unknown> {
  const segment = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;
  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
  appHandle = createDatabase(await createAppRole(container.adminUrl), { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('mintAgentToken: what it mints', () => {
  it('names the owner as sub, the agent as act, and narrows the scope', async () => {
    const w = await newWorld();
    const { accessToken, expiresAt } = await mint(w);
    const claims = claimsOf(accessToken);

    expect(claims).toMatchObject({
      iss: w.issuer,
      sub: w.subjectId,
      act: { sub: AGENT },
      client_id: AGENT,
      scope: 'mcp:read',
      grant_id: w.grantId,
      sid: w.sessionId,
      via: 'mcp',
    });
    expect(claims.aud).toEqual([ADMIN_API_AUDIENCE, w.issuer]);
    expect(expiresAt.getTime()).toBe((claims.exp as number) * 1000);
  });

  it('is a token the issuer verifies, typed at+jwt', async () => {
    const w = await newWorld();
    const { accessToken } = await mint(w);
    const keys = await withTenant(app.db, w.tenantId, (tx) =>
      signingKeyRepository(tx).listPublishable(),
    );
    const payload = await verifyJwt(accessToken, {
      keys,
      issuer: w.issuer,
      audience: ADMIN_API_AUDIENCE,
      typ: 'at+jwt',
    });
    expect(payload.sub).toBe(w.subjectId);
  });

  it('keeps mcp:write when both the grant and the input hold it', async () => {
    const w = await newWorld();
    const { accessToken } = await mint(w, { scope: ['mcp:read', 'mcp:write'] });
    expect(claimsOf(accessToken).scope).toBe('mcp:read mcp:write');
  });

  it('writes no grant and no refresh token, and needs no /token request', async () => {
    const w = await newWorld();
    const before = await owner.db
      .select()
      .from(tokenGrants)
      .where(eq(tokenGrants.tenantId, w.tenantId));
    await mint(w);
    await mint(w);
    const after = await owner.db
      .select()
      .from(tokenGrants)
      .where(eq(tokenGrants.tenantId, w.tenantId));
    expect(after).toHaveLength(before.length);
    const refresh = await withTenant(app.db, w.tenantId, (tx) =>
      refreshTokenRepository(tx).byHash('anything'),
    );
    expect(refresh).toBeNull();
  });
});

describe('mintAgentToken: the scope it will sign', () => {
  it('refuses a scope the grant does not hold', async () => {
    const w = await newWorld('mcp:read');
    expect(await refusal(mint(w, { scope: ['mcp:write'] }))).toBe('scope_widened');
    expect(await refusal(mint(w, { scope: ['mcp:read', 'mcp:write'] }))).toBe('scope_widened');
  });

  it.each([
    ['openid beside an MCP scope', ['mcp:read', 'openid']],
    ['offline_access', ['mcp:read', 'offline_access']],
    ['an admin-wide scope', ['mcp:read', 'admin']],
    ['no MCP scope at all', ['openid']],
    ['nothing', []],
  ])('refuses %s even when the grant holds it', async (_, scope) => {
    const w = await newWorld('mcp:read mcp:write openid offline_access admin');
    expect(await refusal(mint(w, { scope }))).toBe('scope_not_mcp');
  });

  it('refuses mcp:write when the grant holds only mcp:read', async () => {
    const w = await newWorld('mcp:read openid');
    expect(await refusal(mint(w, { scope: ['mcp:write'] }))).toBe('scope_widened');
  });

  it('refuses an audience that is not the admin API', async () => {
    const w = await newWorld();
    expect(await refusal(mint(w, { audience: MCP_AUDIENCE }))).toBe('audience_not_admin');
    expect(await refusal(mint(w, { audience: 'https://other.example' }))).toBe(
      'audience_not_admin',
    );
  });
});

describe('mintAgentToken: what must still be alive', () => {
  it('refuses a revoked grant', async () => {
    const w = await newWorld();
    await withTenant(app.db, w.tenantId, (tx) => tokenGrantRepository(tx).revoke(w.grantId, NOW));
    expect(await refusal(mint(w))).toBe('grant_revoked');
  });

  it('refuses an unknown grant', async () => {
    const w = await newWorld();
    expect(await refusal(mint(w, { subjectGrantId: newId() }))).toBe('grant_not_found');
  });

  it('refuses a grant whose session ended', async () => {
    const w = await newWorld();
    await withTenant(app.db, w.tenantId, (tx) => sessionRepository(tx).end(w.sessionId, NOW));
    expect(await refusal(mint(w, { now: new Date(NOW.getTime() + 1000) }))).toBe('session_ended');
  });

  it('refuses a grant whose session lapsed', async () => {
    const w = await newWorld();
    const later = new Date(NOW.getTime() + 25 * 3600 * 1000);
    expect(
      await refusal(mint(w, { now: later, notAfter: new Date(later.getTime() + 600_000) })),
    ).toBe('session_ended');
  });

  it('refuses a disabled agent client', async () => {
    const w = await newWorld();
    await withTenant(app.db, w.tenantId, (tx) =>
      clientRepository(tx).update(w.agent.id, { enabled: false }),
    );
    expect(await refusal(mint(w))).toBe('client_disabled');
  });

  it('refuses an unknown agent client', async () => {
    const w = await newWorld();
    expect(await refusal(mint(w, { agentClientId: 'nobody' }))).toBe('client_disabled');
  });

  it('refuses a disabled tenant', async () => {
    const w = await newWorld();
    await owner.db.update(tenants).set({ enabled: false }).where(eq(tenants.id, w.tenantId));
    expect(await refusal(mint(w))).toBe('tenant_disabled');
  });

  it('refuses a disabled subject', async () => {
    const w = await newWorld();
    await withTenant(app.db, w.tenantId, (tx) =>
      subjectRepository(tx).setEnabled(w.subjectId, false),
    );
    expect(await refusal(mint(w))).toBe('subject_disabled');
  });

  it('refuses a grant held by a different client of the tenant', async () => {
    const w = await newWorld();
    const other = await withTenant(app.db, w.tenantId, async (tx) => {
      const client = await newClient(tx, w.tenantId, 'other-client');
      return grantFor(tx, w, client.id, 'mcp:read');
    });
    expect(await refusal(mint(w, { subjectGrantId: other }))).toBe('grant_not_agent_client');
  });

  it('refuses a token whose subject is not the grant owner', async () => {
    const w = await newWorld();
    expect(await refusal(mint(w, { expectedSubjectId: newId() }))).toBe('subject_mismatch');
  });

  it('refuses a grant of another tenant, whoever names it', async () => {
    const mine = await newWorld();
    const theirs = await newWorld();
    expect(await refusal(mint(mine, { subjectGrantId: theirs.grantId }))).toBe('grant_not_found');
  });
});

describe('mintAgentToken: how long the token lives', () => {
  it('ends no later than the MCP token it was minted against', async () => {
    const w = await newWorld();
    const notAfter = new Date(NOW.getTime() + 60_000);
    const { accessToken, expiresAt } = await mint(w, { notAfter });
    expect(expiresAt).toEqual(notAfter);
    expect(claimsOf(accessToken).exp).toBe(notAfter.getTime() / 1000);
  });

  it('ends within the ceiling however long the MCP token has left', async () => {
    const w = await newWorld();
    const { expiresAt } = await mint(w, { notAfter: new Date(NOW.getTime() + 86_400_000) });
    expect(AGENT_TOKEN_MAX_TTL_SECONDS).toBe(300);
    expect(expiresAt.getTime()).toBe(NOW.getTime() + AGENT_TOKEN_MAX_TTL_SECONDS * 1000);
  });

  it('refuses an MCP token that has already ended', async () => {
    const w = await newWorld();
    expect(await refusal(mint(w, { notAfter: NOW }))).toBe('token_expired');
    expect(await refusal(mint(w, { notAfter: new Date(NOW.getTime() - 5000) }))).toBe(
      'token_expired',
    );
  });
});

describe('tenantEnabledRepository', () => {
  it('reads its own tenant and reports a foreign one as disabled', async () => {
    const mine = await newWorld();
    const theirs = await newWorld();
    const read = (id: string) =>
      withTenant(app.db, mine.tenantId, (tx) => tenantEnabledRepository(tx).enabled(id));
    expect(await read(mine.tenantId)).toBe(true);
    expect(await read(theirs.tenantId)).toBe(false);
  });
});
