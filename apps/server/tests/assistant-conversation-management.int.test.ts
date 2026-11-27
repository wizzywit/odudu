import { resolveSlots } from '@odudu/assistant';
import { signingKeyRepository, signJwt } from '@odudu/crypto';
import { withTenant } from '@odudu/db';
import { ADMIN_API_AUDIENCE, ADMIN_CLIENT_ID, hostState } from '@odudu/domain-tenant';
import { loadConfig, newId } from '@odudu/kernel';
import { tokenGrantRepository } from '@odudu/protocol-oidc';
import { sql } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { createLogger } from '#/logger';
import { BASE, startMcpStack, type McpStack } from '#/testing/mcp-stack';
import { type World } from '#/testing/mcp-world';

const KEK = Buffer.alloc(32, 7);
const HOST = 'id.example.com';
const ENV = {
  ODUDU_ASSISTANT_MODELS: 'standard=anthropic:claude-standard',
  ANTHROPIC_API_KEY: 'sk-ant-test-0123456789',
};
const CONTEXT = { route: '/clients' };

let stack: McpStack | undefined;
let assisted: FastifyInstance | undefined;

function s(): McpStack {
  if (stack === undefined) throw new Error('stack not started');
  return stack;
}
function on(): FastifyInstance {
  if (assisted === undefined) throw new Error('app not built');
  return assisted;
}

beforeAll(async () => {
  stack = await startMcpStack();
  assisted = buildApp({
    database: stack.appDb,
    ownerDatabase: stack.owner,
    kek: KEK,
    logger: createLogger(loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' })),
    tls: true,
    publicBaseUrl: BASE,
    throttle: { limit: 100_000, windowSeconds: 60 },
    hostState: (host) => hostState(s().owner.db, host, new Date()),
    assistant: { slots: resolveSlots(ENV), env: ENV },
    assistantModels: () => {
      throw new Error('no model is called here');
    },
  });
  await assisted.ready();
}, 180_000);
afterAll(async () => {
  await assisted?.close();
  await stack?.close();
});

// A console sign-in: a grant of the built-in admin client for the world's
// subject and session, and a token for it. Each call is a new sign-in.
async function signIn(w: World, subjectId = w.subjectId): Promise<string> {
  const grantId = newId();
  const key = await withTenant(s().appDb.db, w.tenantId, async (tx) => {
    await tokenGrantRepository(tx).create({
      id: grantId,
      tenantId: w.tenantId,
      clientId: w.adminDbId,
      subjectId,
      scope: '',
      audience: [ADMIN_API_AUDIENCE],
      sessionId: w.sessionId,
    });
    return signingKeyRepository(tx).active();
  });
  const iat = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      iss: w.issuer,
      sub: subjectId,
      aud: [ADMIN_API_AUDIENCE],
      client_id: ADMIN_CLIENT_ID,
      scope: '',
      iat,
      exp: iat + 600,
      jti: newId(),
      grant_id: grantId,
      sid: w.sessionId,
    },
    { key, kek: KEK, typ: 'at+jwt' },
  );
}

function call(
  w: World,
  token: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  tail: string,
  payload?: unknown,
) {
  return on().inject({
    method,
    url: `/admin/tenants/${w.name}/assistant${tail}`,
    headers: {
      host: HOST,
      authorization: `Bearer ${token}`,
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });
}

async function started(w: World, token: string): Promise<string> {
  const res = await call(w, token, 'POST', '/conversations', { page_context: CONTEXT });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ id: string }>().id;
}

async function secondAdmin(w: World): Promise<string> {
  return withTenant(s().appDb.db, w.tenantId, async (tx) => {
    const id = newId();
    await tx.execute(
      sql`insert into subjects (id, tenant_id, type) values (${id}, ${w.tenantId}, 'user')`,
    );
    return id;
  });
}

async function auditCount(w: World): Promise<number> {
  return (await s().auditRows(w)).length;
}

describe('a person’s own conversations through the admin API', () => {
  it('lists, reopens and hides the caller’s conversations, and no one else’s', async () => {
    const w = await s().world(['use-assistant'], 'openid');
    const token = await signIn(w);
    const mine = await started(w, token);
    const other = await secondAdmin(w);
    const theirs = newId();
    await withTenant(s().appDb.db, w.tenantId, async (tx) => {
      await tx.execute(
        sql`insert into assistant_conversations
              (tenant_id, id, owner_subject_id, instance_id, profile, mode)
            values (${w.tenantId}, ${theirs}, ${other}, ${newId()}, 'free-chat', 'ask')`,
      );
    });

    const list = await call(w, token, 'GET', '/conversations');
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json<{ items: { id: string }[] }>().items.map((item) => item.id)).toEqual([mine]);

    const last = await call(w, token, 'GET', '/last-conversation');
    expect(last.json()).toMatchObject({ conversation: { id: mine, continuable: true } });

    const hidden = await call(w, token, 'PUT', `/conversations/${mine}/archived`, {
      archived: true,
    });
    expect(hidden.statusCode, hidden.body).toBe(200);
    expect((await call(w, token, 'GET', '/conversations')).json()).toEqual({ items: [] });
    expect((await call(w, token, 'GET', '/last-conversation')).json()).toEqual({
      conversation: null,
    });
    const archived = await call(w, token, 'GET', '/conversations?archived=true');
    expect(archived.json<{ items: { id: string }[] }>().items.map((item) => item.id)).toEqual([
      mine,
    ]);

    // Another person's conversation in the same tenant is reached by none of the routes.
    for (const [method, tail, payload] of [
      ['PUT', `/conversations/${theirs}/archived`, { archived: true }],
      ['DELETE', `/conversations/${theirs}`, undefined],
      ['GET', `/conversations/${theirs}/export`, undefined],
      ['GET', `/conversations/${theirs}/export/markdown`, undefined],
    ] as const) {
      const res = await call(w, token, method, tail, payload);
      expect(res.statusCode, `${method} ${tail}`).toBe(404);
    }
    expect(
      await withTenant(s().appDb.db, w.tenantId, (tx) =>
        tx.execute(sql`select 1 from assistant_conversations where id = ${theirs}`),
      ),
    ).toHaveLength(1);
  });

  it('exports for the owner alone and records each export without the text', async () => {
    const w = await s().world(['use-assistant', 'read-assistant-activity'], 'openid');
    const token = await signIn(w);
    const id = await started(w, token);
    await withTenant(s().appDb.db, w.tenantId, async (tx) => {
      await tx.execute(
        sql`insert into assistant_messages (tenant_id, conversation_id, seq, role, parts)
            values (${w.tenantId}, ${id}, 2, 'user',
                    ${JSON.stringify([{ type: 'text', text: 'client_secret: s3cr3t-value-12345' }])}::jsonb)`,
      );
    });

    const json = await call(w, token, 'GET', `/conversations/${id}/export`);
    expect(json.statusCode, json.body).toBe(200);
    expect(json.headers['content-disposition']).toContain(`conversation-${id}.json`);
    expect(json.body).not.toContain('s3cr3t-value-12345');
    expect(json.json<{ messages: unknown[] }>().messages).toHaveLength(1);
    const markdown = await call(w, token, 'GET', `/conversations/${id}/export/markdown`);
    expect(markdown.statusCode, markdown.body).toBe(200);
    expect(markdown.headers['content-type']).toContain('text/markdown');
    expect(markdown.body).not.toContain('s3cr3t-value-12345');

    const rows = await s().auditRows(w, 'assistant.conversation_exported');
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.detail)).toEqual([
      expect.objectContaining({ conversation: id, format: 'json', messages: 1 }),
      expect.objectContaining({ conversation: id, format: 'markdown', messages: 1 }),
    ]);
    expect(JSON.stringify(rows)).not.toContain('s3cr3t');
  });

  it('deletes with a tombstone and an audit row, ends the grant and touches no other audit row', async () => {
    const w = await s().world(['use-assistant'], 'openid');
    const token = await signIn(w);
    const id = await started(w, token);
    await withTenant(s().appDb.db, w.tenantId, async (tx) => {
      await tx.execute(
        sql`insert into assistant_messages (tenant_id, conversation_id, seq, role, parts)
            values (${w.tenantId}, ${id}, 2, 'user', ${JSON.stringify([{ type: 'text', text: 'delete me' }])}::jsonb)`,
      );
    });
    const before = await auditCount(w);
    const earlier = (await s().auditRows(w)).map((row) => row.id);

    const gone = await call(w, token, 'DELETE', `/conversations/${id}`);
    expect(gone.statusCode, gone.body).toBe(204);

    const rows = await withTenant(s().appDb.db, w.tenantId, async (tx) => ({
      conversations: await tx.execute(sql`select 1 from assistant_conversations where id = ${id}`),
      messages: await tx.execute(
        sql`select 1 from assistant_messages where conversation_id = ${id}`,
      ),
      tombstones: await tx.execute<{
        owner_subject_id: string;
        deleted_by_subject_id: string;
        message_count: number;
        digest: string;
      }>(
        sql`select owner_subject_id, deleted_by_subject_id, message_count, digest
              from assistant_conversation_tombstones where conversation_id = ${id}`,
      ),
      grant: await tokenGrantRepository(tx).byId(id),
    }));
    expect(rows.conversations).toHaveLength(0);
    expect(rows.messages).toHaveLength(0);
    expect(rows.tombstones).toHaveLength(1);
    expect(rows.tombstones[0]).toMatchObject({
      owner_subject_id: w.subjectId,
      deleted_by_subject_id: w.subjectId,
      message_count: 2,
    });
    expect(rows.tombstones[0]?.digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(rows.grant?.revokedAt).not.toBeNull();

    const audit = await s().auditRows(w);
    expect(audit).toHaveLength(before + 1);
    expect(audit.map((row) => row.id).slice(0, earlier.length)).toEqual(earlier);
    const deleted = await s().auditRows(w, 'assistant.conversation_deleted');
    expect(deleted).toHaveLength(1);
    expect(deleted[0]?.detail).toMatchObject({
      conversation: id,
      messages: 2,
      digest: rows.tombstones[0]?.digest,
    });
    expect(JSON.stringify(deleted)).not.toContain('delete me');

    expect((await call(w, token, 'GET', `/conversations/${id}`)).statusCode).toBe(404);
    expect((await call(w, token, 'DELETE', `/conversations/${id}`)).statusCode).toBe(404);
  });

  it('refuses to delete a reported conversation and says why', async () => {
    const w = await s().world(['use-assistant'], 'openid');
    const token = await signIn(w);
    const id = await started(w, token);
    const reported = await call(w, token, 'POST', `/conversations/${id}/report`);
    expect(reported.statusCode, reported.body).toBe(200);
    const res = await call(w, token, 'DELETE', `/conversations/${id}`);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ type: 'about:blank#conversation-reported' });
    expect((await call(w, token, 'GET', `/conversations/${id}`)).statusCode).toBe(200);
  });

  it('reports a conversation as continuable after a new sign-in, and read-only when its sign-in was revoked for cause', async () => {
    const w = await s().world(['use-assistant'], 'openid');
    const first = await signIn(w);
    const id = await started(w, first);
    expect((await call(w, first, 'GET', '/last-conversation')).json()).toMatchObject({
      conversation: { id, continuable: true },
    });

    const second = await signIn(w);
    expect((await call(w, second, 'GET', '/last-conversation')).json()).toMatchObject({
      conversation: { id, continuable: true },
    });

    // The conversation's own grant ended without the person signing out.
    await withTenant(s().appDb.db, w.tenantId, (tx) =>
      tokenGrantRepository(tx).revoke(id, new Date()),
    );
    const reopened = await call(w, second, 'GET', '/last-conversation');
    expect(reopened.json()).toMatchObject({ conversation: { id, continuable: false } });

    const sent = await call(w, second, 'POST', `/conversations/${id}/messages`, {
      message: { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    });
    expect(sent.statusCode, sent.body).toBe(409);
    expect(sent.json()).toMatchObject({ type: 'about:blank#conversation-ended' });
    expect(
      await withTenant(s().appDb.db, w.tenantId, (tx) =>
        tx.execute(
          sql`select 1 from assistant_messages where conversation_id = ${id} and role = 'user'`,
        ),
      ),
    ).toHaveLength(0);
  });
});
