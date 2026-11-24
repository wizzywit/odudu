import { sessionRepository } from '@odudu/authn-flows';
import { createDatabase, MIGRATIONS_DIR, runMigrations, withTenant } from '@odudu/db';
import type { DatabaseHandle } from '@odudu/db';
import { ADMIN_API_AUDIENCE, MCP_CLIENT_ID } from '@odudu/domain-tenant';
import { loadConfig } from '@odudu/kernel';
import { validatedMcpToken, type McpDeps, type ValidatedMcpToken } from '@odudu/mcp';
import {
  AgentTokenRefused,
  clientOidcConfigRepository,
  standardClaimMappers,
  type MintAgentTokenInput,
} from '@odudu/protocol-oidc';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { createLogger } from '#/logger';
import { mcpWorld, type World } from '#/testing/mcp-world';
import { mcpDepsFor } from '#/mcp-deps';

// A run whose owner ended is refused through the server's own mint, and the
// revocation it made is kept.

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appDbHandle: DatabaseHandle | undefined;
let appHandle: FastifyInstance | undefined;
let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let app: FastifyInstance;
let deps: McpDeps;

const KEK = Buffer.alloc(32, 7);
const BASE = 'https://id.example.com';

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;
  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  appDbHandle = createDatabase(appUrl, { max: 5 });
  appDb = appDbHandle;
  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
  const config = loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' });
  const logger = createLogger(config);
  appHandle = buildApp({
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger,
    tls: true,
    publicBaseUrl: BASE,
    throttle: { limit: 100_000, windowSeconds: 60 },
  });
  app = appHandle;
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
  deps = real;
}, 120_000);

afterAll(async () => {
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  try {
    await appHandle?.close();
  } finally {
    try {
      await appDbHandle?.close();
    } finally {
      try {
        await ownerHandle?.close();
      } finally {
        await containerHandle?.stop();
      }
    }
  }
});

const world = () => mcpWorld(appDb, BASE, ['manage-clients']);

function tokenOf(w: World): ValidatedMcpToken {
  return validatedMcpToken({
    tenant: { id: w.tenantId, name: w.name },
    issuer: w.issuer,
    subjectId: w.subjectId,
    clientId: MCP_CLIENT_ID,
    grantId: w.grantId,
    scope: ['mcp:read', 'mcp:write'],
    expSeconds: Math.floor(Date.now() / 1000) + 3600,
  });
}

function mintInput(w: World, run?: { key: string }): MintAgentTokenInput {
  return {
    subjectGrantId: w.grantId,
    expectedSubjectId: w.subjectId,
    agentClientId: MCP_CLIENT_ID,
    audience: ADMIN_API_AUDIENCE,
    scope: ['mcp:read'],
    notAfter: new Date(Date.now() + 3600_000),
    now: new Date(),
    ...(run === undefined ? {} : { run }),
  };
}

async function reasonOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AgentTokenRefused);
  return error instanceof AgentTokenRefused ? error.reason : 'not refused';
}

async function count(w: World, table: 'agent_instances' | 'audit_events'): Promise<number> {
  const rows = await owner.db.execute(
    sql`select count(*)::int as n from ${sql.identifier(table)} where tenant_id = ${w.tenantId}`,
  );
  return (rows as unknown as { n: number }[])[0]?.n ?? -1;
}

async function endSession(w: World): Promise<void> {
  await withTenant(appDb.db, w.tenantId, async (tx) => {
    await sessionRepository(tx).end(w.sessionId, new Date());
  });
}

async function agentWorld(): Promise<World> {
  const w = await world();
  await withTenant(appDb.db, w.tenantId, (tx) =>
    clientOidcConfigRepository(tx).update(w.agentDbId, { agentType: true }),
  );
  return w;
}

describe('the server mint of an agent run', () => {
  it('keeps the revocation of a run whose session ended, and the refusal reaches the caller', async () => {
    const w = await agentWorld();
    const token = tokenOf(w);
    const minted = await deps.mintAgentToken(token, mintInput(w, { key: 'conv-1' }));
    expect(minted.accessToken).not.toBe('');
    const [before] = (await owner.db.execute(
      sql`select id, revoked_at from agent_instances where tenant_id = ${w.tenantId}`,
    )) as unknown as { id: string; revoked_at: Date | null }[];
    expect(before).toBeDefined();
    expect(before?.revoked_at).toBeNull();

    await endSession(w);
    expect(await reasonOf(deps.mintAgentToken(token, mintInput(w, { key: 'conv-1' })))).toBe(
      'owner_ended',
    );

    const after = await withTenant(appDb.db, w.tenantId, async (tx) => {
      const rows = await tx.execute(
        sql`select revoked_at from agent_instances where id = ${before?.id ?? ''}`,
      );
      return (rows as unknown as { revoked_at: Date | null }[])[0];
    });
    expect(after).toBeDefined();
    expect(Number.isNaN(Date.parse(String(after?.revoked_at)))).toBe(false);
  });

  it('writes nothing for a refusal of a call with no run', async () => {
    const w = await agentWorld();
    const token = tokenOf(w);
    await deps.mintAgentToken(token, mintInput(w, { key: 'conv-1' }));
    await endSession(w);
    const instances = await count(w, 'agent_instances');
    const audits = await count(w, 'audit_events');
    expect(await reasonOf(deps.mintAgentToken(token, mintInput(w)))).toBe('session_ended');
    expect(await count(w, 'agent_instances')).toBe(instances);
    expect(await count(w, 'audit_events')).toBe(audits);
    const rows = (await owner.db.execute(
      sql`select revoked_at from agent_instances where tenant_id = ${w.tenantId}`,
    )) as unknown as { revoked_at: Date | null }[];
    expect(rows.every((row) => row.revoked_at === null)).toBe(true);
  });
});
