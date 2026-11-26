import { createDatabase, MIGRATIONS_DIR, runMigrations, withTenant } from '@odudu/db';
import type { DatabaseHandle } from '@odudu/db';
import {
  ADMIN_API_AUDIENCE,
  ADMIN_CLIENT_ID,
  ASSISTANT_CLIENT_ID,
  SYSTEM_TENANT_ID,
  SYSTEM_TENANT_NAME,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import {
  AgentTokenRefused,
  grantAssistantAccess,
  mintAgentToken,
  standardClaimMappers,
  tenantLookupRepository,
  tokenGrantRepository,
} from '@odudu/protocol-oidc';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedAdmin } from '#/cli/seed';
import { CONSOLE_CLIENT_KEY } from '#/testing/console-key';
import { Jar, KEK, signIn, startConsoleApp, type ConsoleStack } from '#/testing/console-harness';

// An administrator signs in through the console exactly as a person does; the
// conversation's grant is derived from that sign-in, and ending the sign-in
// ends the conversation: the grant, the instance and the token it signed.

let containerHandle: TestDatabase | undefined;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;

const BASE = 'http://console.example.test';
const ISSUER = `${BASE}/tenants/${SYSTEM_TENANT_NAME}`;
const WRITE = { origin: BASE, 'x-odudu-console': '1' };

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  owner = createDatabase(containerHandle.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(containerHandle.adminUrl);
  appDb = createDatabase(appUrl, { max: 5 });
  process.env.ODUDU_DATABASE_URL = containerHandle.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
  process.env.ODUDU_CONSOLE_CLIENT_KEY = CONSOLE_CLIENT_KEY;
  process.env.ODUDU_PUBLIC_BASE_URL = BASE;
  await seedAdmin({ username: `setup-${newId()}` });
}, 120_000);

afterAll(async () => {
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  delete process.env.ODUDU_CONSOLE_CLIENT_KEY;
  delete process.env.ODUDU_PUBLIC_BASE_URL;
  await appDb.close();
  await owner.close();
  await containerHandle?.stop();
});

interface Conversation {
  readonly consoleGrantId: string;
  readonly sessionId: string;
  readonly grantId: string;
  readonly subjectId: string;
}

async function consoleGrantOf(subjectId: string): Promise<{ id: string; sessionId: string }> {
  const rows = (await owner.db.execute(
    sql`select g.id, g.session_id from token_grants g join clients c on c.id = g.client_id
         where g.subject_id = ${subjectId} and c.client_id = ${ADMIN_CLIENT_ID}
           and g.exchanged_from_grant_id is null and g.revoked_at is null
         order by g.created_at desc limit 1`,
  )) as unknown as { id: string; session_id: string }[];
  const row = rows[0];
  if (row === undefined) throw new Error('the sign-in made no grant');
  return { id: row.id, sessionId: row.session_id };
}

async function lifespans() {
  const tenant = await tenantLookupRepository(owner.db).byName(SYSTEM_TENANT_NAME);
  if (tenant === null) throw new Error('no system tenant');
  return {
    ssoSessionIdleSeconds: tenant.ssoSessionIdleSeconds,
    ssoSessionMaxSeconds: tenant.ssoSessionMaxSeconds,
    rememberMeIdleSeconds: tenant.rememberMeIdleSeconds,
    rememberMeMaxSeconds: tenant.rememberMeMaxSeconds,
  };
}

async function openConversation(subjectId: string): Promise<Conversation> {
  const console = await consoleGrantOf(subjectId);
  const grantId = newId();
  await withTenant(appDb.db, SYSTEM_TENANT_ID, async (tx) =>
    grantAssistantAccess(
      tx,
      { tenantId: SYSTEM_TENANT_ID, lifespans: await lifespans() },
      {
        newGrantId: grantId,
        consoleGrantId: console.id,
        expectedSubjectId: subjectId,
        mode: 'ask',
        now: new Date(),
      },
    ),
  );
  return { consoleGrantId: console.id, sessionId: console.sessionId, grantId, subjectId };
}

async function mint(c: Conversation, key = 'turn') {
  const now = new Date();
  return withTenant(appDb.db, SYSTEM_TENANT_ID, async (tx) =>
    mintAgentToken(
      tx,
      {
        tenantId: SYSTEM_TENANT_ID,
        issuer: ISSUER,
        kek: KEK,
        claimMappers: standardClaimMappers(),
        lifespans: await lifespans(),
      },
      {
        subjectGrantId: c.grantId,
        expectedSubjectId: c.subjectId,
        agentClientId: ASSISTANT_CLIENT_ID,
        audience: ADMIN_API_AUDIENCE,
        scope: ['mcp:read'],
        notAfter: new Date(now.getTime() + 300_000),
        now,
        run: { key },
      },
    ),
  );
}

async function rowsOf(c: Conversation) {
  const grants = (await owner.db.execute(
    sql`select id, revoked_at from token_grants where id in (${c.consoleGrantId}, ${c.grantId})`,
  )) as unknown as { id: string; revoked_at: Date | null }[];
  const instances = (await owner.db.execute(
    sql`select revoked_at from agent_instances where root_grant_id = ${c.grantId}`,
  )) as unknown as { revoked_at: Date | null }[];
  return {
    consoleRevoked: grants.find((g) => g.id === c.consoleGrantId)?.revoked_at !== null,
    derivedRevoked: grants.find((g) => g.id === c.grantId)?.revoked_at !== null,
    instances: instances.map((i) => i.revoked_at !== null),
  };
}

async function admin(stack: ConsoleStack, token: string) {
  return stack.app.inject({
    method: 'GET',
    url: `/admin/tenants/${SYSTEM_TENANT_NAME}/subjects`,
    headers: { host: stack.base.host, authorization: `Bearer ${token}` },
  });
}

async function withStack(run: (stack: ConsoleStack) => Promise<void>): Promise<void> {
  const stack = await startConsoleApp({ database: appDb, ownerDatabase: owner }, BASE);
  try {
    await run(stack);
  } finally {
    await stack.app.close();
  }
}

describe('assumption 3: ending the console sign-in ends the conversation under it', () => {
  it('a console sign-out revokes the derived grant and its instance, and the token stops working', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      const { subjectId } = await signIn(stack, jar);
      const conversation = await openConversation(subjectId);
      const { accessToken } = await mint(conversation);
      expect((await admin(stack, accessToken)).statusCode).toBe(200);
      expect(await rowsOf(conversation)).toEqual({
        consoleRevoked: false,
        derivedRevoked: false,
        instances: [false],
      });

      const res = await stack.app.inject({
        method: 'POST',
        url: '/console/auth/logout',
        headers: { host: stack.base.host, ...WRITE, ...jar.header() },
      });
      expect(res.statusCode).toBe(200);

      expect(await rowsOf(conversation)).toEqual({
        consoleRevoked: true,
        derivedRevoked: true,
        instances: [true],
      });
      expect((await admin(stack, accessToken)).statusCode).toBe(401);
      await expect(mint(conversation)).rejects.toBeInstanceOf(AgentTokenRefused);
    });
  });

  it('ending the session itself, as the server’s logout does, ends it the same way', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      const { subjectId } = await signIn(stack, jar);
      const conversation = await openConversation(subjectId);
      const { accessToken } = await mint(conversation);

      await withTenant(appDb.db, SYSTEM_TENANT_ID, (tx) =>
        tokenGrantRepository(tx).revokeForSessions([conversation.sessionId], new Date()),
      );

      expect(await rowsOf(conversation)).toEqual({
        consoleRevoked: true,
        derivedRevoked: true,
        instances: [true],
      });
      expect((await admin(stack, accessToken)).statusCode).toBe(401);
    });
  });

  it('revoking the console grant alone ends the derived grant by lineage, with no session involved', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      const { subjectId } = await signIn(stack, jar);
      const conversation = await openConversation(subjectId);
      const { accessToken } = await mint(conversation);

      await withTenant(appDb.db, SYSTEM_TENANT_ID, (tx) =>
        tokenGrantRepository(tx).revoke(conversation.consoleGrantId, new Date()),
      );

      expect(await rowsOf(conversation)).toEqual({
        consoleRevoked: true,
        derivedRevoked: true,
        instances: [true],
      });
      expect((await admin(stack, accessToken)).statusCode).toBe(401);
    });
  });
});
