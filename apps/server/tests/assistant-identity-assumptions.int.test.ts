import { withTenant } from '@odudu/db';
import { ADMIN_API_AUDIENCE, ASSISTANT_CLIENT_ID, clientRepository } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import {
  AgentTokenRefused,
  clientOidcConfigRepository,
  mintAgentToken,
  standardClaimMappers,
  tenantLookupRepository,
  tokenGrantRepository,
} from '@odudu/protocol-oidc';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASE, startMcpStack, type McpStack } from '#/testing/mcp-stack';
import { consoleWorld, type World } from '#/testing/mcp-world';

// The three facts the assistant's identity rests on, proved with the grant
// written by hand and `mintAgentToken` as it is, before any code of the
// assistant's own depends on them.

const KEK = Buffer.alloc(32, 7);
const HOST = 'id.example.com';

let stack: McpStack | undefined;

function s(): McpStack {
  if (stack === undefined) throw new Error('stack not started');
  return stack;
}

beforeAll(async () => {
  stack = await startMcpStack();
}, 180_000);
afterAll(async () => {
  await stack?.close();
});

async function derive(w: World): Promise<string> {
  const id = newId();
  await withTenant(s().appDb.db, w.tenantId, async (tx) => {
    const assistant = await clientRepository(tx).byClientId(ASSISTANT_CLIENT_ID);
    if (assistant === null) throw new Error('the tenant has no assistant client');
    await tokenGrantRepository(tx).create({
      id,
      tenantId: w.tenantId,
      clientId: assistant.id,
      subjectId: w.subjectId,
      scope: 'mcp:read',
      audience: [ADMIN_API_AUDIENCE],
      sessionId: w.sessionId,
      exchangedFromGrantId: w.grantId,
    });
  });
  return id;
}

async function mint(w: World, grantId: string, scope: string[] = ['mcp:read']) {
  const tenant = await tenantLookupRepository(s().owner.db).byName(w.name);
  if (tenant === null) throw new Error('no tenant');
  const now = new Date();
  return withTenant(s().appDb.db, w.tenantId, (tx) =>
    mintAgentToken(
      tx,
      {
        tenantId: w.tenantId,
        issuer: w.issuer,
        kek: KEK,
        claimMappers: standardClaimMappers(),
        lifespans: {
          ssoSessionIdleSeconds: tenant.ssoSessionIdleSeconds,
          ssoSessionMaxSeconds: tenant.ssoSessionMaxSeconds,
          rememberMeIdleSeconds: tenant.rememberMeIdleSeconds,
          rememberMeMaxSeconds: tenant.rememberMeMaxSeconds,
        },
      },
      {
        subjectGrantId: grantId,
        expectedSubjectId: w.subjectId,
        agentClientId: ASSISTANT_CLIENT_ID,
        audience: ADMIN_API_AUDIENCE,
        scope,
        notAfter: new Date(now.getTime() + 300_000),
        now,
        run: { key: 'conversation' },
      },
    ),
  );
}

function admin(w: World, tail: string, token: string) {
  return s().app.inject({
    method: 'GET',
    url: `/admin/tenants/${w.name}${tail}`,
    headers: { host: HOST, authorization: `Bearer ${token}` },
  });
}

describe('assumption 1: the door reads the owner’s roles whatever the token’s client', () => {
  it('admits what the owner holds and refuses what they do not, for a token of odudu-assistant', async () => {
    const w = await consoleWorld(s().appDb, BASE, ['view-users']);
    const { accessToken } = await mint(w, await derive(w));
    const claims = JSON.parse(
      Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as { client_id: string; scope: string };
    expect(claims).toMatchObject({ client_id: ASSISTANT_CLIENT_ID, scope: 'mcp:read' });
    expect((await admin(w, '/subjects', accessToken)).statusCode).toBe(200);
    expect((await admin(w, '/clients', accessToken)).statusCode).toBe(403);
  });
});

describe('assumption 2: delegatedActors on odudu-admin makes the assistant fail closed', () => {
  it('refuses the run while the list names other clients, and admits it once the assistant is named', async () => {
    const w = await consoleWorld(s().appDb, BASE, ['view-users']);
    const derived = await derive(w);
    const setActors = (actors: string[]) =>
      withTenant(s().appDb.db, w.tenantId, (tx) =>
        clientOidcConfigRepository(tx).update(w.adminDbId, { delegatedActors: actors }),
      );
    await setActors(['some-other-client']);
    await expect(mint(w, derived)).rejects.toMatchObject({
      name: AgentTokenRefused.name,
      reason: 'run_refused',
    });
    await setActors(['some-other-client', ASSISTANT_CLIENT_ID]);
    expect((await mint(w, derived)).accessToken).toBeTruthy();
  });
});
