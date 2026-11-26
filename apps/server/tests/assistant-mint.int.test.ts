import type { ChatCaller } from '@odudu/assistant';
import { createDatabase, MIGRATIONS_DIR, runMigrations, withTenant } from '@odudu/db';
import type { DatabaseHandle } from '@odudu/db';
import { loadConfig } from '@odudu/kernel';
import {
  clientOidcConfigRepository,
  runInstanceId,
  standardClaimMappers,
} from '@odudu/protocol-oidc';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { assistantTokenMint } from '#/assistant-chat';
import { createLogger } from '#/logger';
import { mcpWorld, type World } from '#/testing/mcp-world';

// What a turn's tool calls act as: one agent instance for the conversation, the
// same one for every call, including calls made at once.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let app: FastifyInstance;
let mint: ReturnType<typeof assistantTokenMint>;

const KEK = Buffer.alloc(32, 7);
const BASE = 'https://id.example.com';

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  appDb = createDatabase(appUrl, { max: 10 });
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
  mint = assistantTokenMint({
    app,
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    claimMappers: standardClaimMappers(),
    logger,
    publicBaseUrl: BASE,
    models: () => {
      throw new Error('no model is called here');
    },
  });
}, 120_000);

afterAll(async () => {
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  await app.close();
  await appDb.close();
  await owner.close();
  await container.stop();
});

async function agentWorld(): Promise<World> {
  const w = await mcpWorld(appDb, BASE, ['manage-clients']);
  await withTenant(appDb.db, w.tenantId, (tx) =>
    clientOidcConfigRepository(tx).update(w.agentDbId, { agentType: true }),
  );
  return w;
}

function callerOf(w: World): ChatCaller {
  return {
    tenantId: w.tenantId,
    tenantName: w.name,
    issuer: w.issuer,
    ownerSubjectId: w.subjectId,
    grantId: w.grantId,
    requestId: 'req-1',
    ip: '127.0.0.1',
  };
}

function actOf(accessToken: string): string | undefined {
  const [, payload = ''] = accessToken.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    act?: { sub?: string };
  };
  return claims.act?.sub;
}

async function instanceCount(w: World): Promise<number> {
  const rows = (await owner.db.execute(
    sql`select count(*)::int as n from agent_instances where tenant_id = ${w.tenantId}`,
  )) as unknown as { n: number }[];
  return rows[0]?.n ?? -1;
}

describe('the assistant mint', () => {
  it('gives every call of one run, made at once, the same instance as act.sub', async () => {
    const w = await agentWorld();
    const conversation = '0192a0a0-0000-7000-8000-0000000000c1';
    const tokens = await Promise.all(
      Array.from({ length: 6 }, () => mint(callerOf(w), { key: conversation })),
    );
    const subjects = new Set(tokens.map((token) => actOf(token.accessToken)));
    expect(subjects).toEqual(new Set([runInstanceId(w.tenantId, w.grantId, conversation)]));
    expect(await instanceCount(w)).toBe(1);
  });

  it('gives another conversation its own instance', async () => {
    const w = await agentWorld();
    const first = await mint(callerOf(w), { key: 'conversation-a' });
    const second = await mint(callerOf(w), { key: 'conversation-b' });
    expect(actOf(first.accessToken)).not.toBe(actOf(second.accessToken));
    expect(await instanceCount(w)).toBe(2);
  });

  it('makes no instance for a grant whose client is not an agent type', async () => {
    const w = await mcpWorld(appDb, BASE, ['manage-clients']);
    // The client is not an agent type: the run has no instance, and the call
    // is made as the client itself, which is what an ordinary MCP call is.
    const minted = await mint(callerOf(w), { key: 'conversation-c' });
    expect(actOf(minted.accessToken)).toBe('odudu-mcp');
    expect(await instanceCount(w)).toBe(0);
  });
});
