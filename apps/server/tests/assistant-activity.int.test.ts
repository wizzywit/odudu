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
const HASH = 'c'.repeat(64);

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

async function adminToken(w: World): Promise<string> {
  const grantId = newId();
  const key = await withTenant(s().appDb.db, w.tenantId, async (tx) => {
    await tokenGrantRepository(tx).create({
      id: grantId,
      tenantId: w.tenantId,
      clientId: w.adminDbId,
      subjectId: w.subjectId,
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
      sub: w.subjectId,
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
  app: FastifyInstance,
  w: World,
  token: string,
  method: 'GET' | 'POST' | 'PUT',
  tail: string,
  payload?: unknown,
) {
  return app.inject({
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

interface Seeded {
  readonly conversation: string;
  readonly turn: string;
}

// A conversation of `owner` with one turn that called a tool, an answer, and a
// message the person sent that holds a secret.
async function seedConversation(w: World, owner: string, tool = 'list_clients'): Promise<Seeded> {
  const conversation = newId();
  const turn = newId();
  const step = newId();
  const at = new Date().toISOString();
  await withTenant(s().appDb.db, w.tenantId, async (tx) => {
    await tx.execute(
      sql`insert into assistant_conversations
            (tenant_id, id, owner_subject_id, instance_id, profile, mode, last_active_at, created_at)
          values (${w.tenantId}, ${conversation}, ${owner}, ${newId()}, 'free-chat', 'ask',
                  ${at}::timestamptz, ${at}::timestamptz)`,
    );
    await tx.execute(
      sql`insert into assistant_messages (tenant_id, conversation_id, seq, role, parts)
          values (${w.tenantId}, ${conversation}, 1, 'user',
                  ${JSON.stringify([{ type: 'text', text: 'how many clients? client_secret: s3cr3t-value-12345' }])}::jsonb)`,
    );
    await tx.execute(
      sql`insert into assistant_turns
            (tenant_id, id, conversation_id, profile, prompt_hash, started_at, ended_at, stop_reason)
          values (${w.tenantId}, ${turn}, ${conversation}, 'free-chat', ${HASH},
                  ${at}::timestamptz, ${at}::timestamptz, 'done')`,
    );
    await tx.execute(
      sql`insert into assistant_steps
            (tenant_id, turn_id, id, slot, model, input_tokens, output_tokens, started_at, ended_at)
          values (${w.tenantId}, ${turn}, ${step}, 'standard', 'anthropic/claude-standard', 40, 8,
                  ${at}::timestamptz, ${at}::timestamptz)`,
    );
    const events = [
      ['tool_call', { tool, tool_call_id: 'c1', input: { limit: 5 } }],
      ['tool_result', { tool, tool_call_id: 'c1', output: 'RESULT-MARKER' }],
      ['text', { text: 'You have one client.' }],
    ] as const;
    for (const [seq, [kind, payload]] of events.entries()) {
      await tx.execute(
        sql`insert into assistant_events (tenant_id, turn_id, seq, step_id, kind, payload, at)
            values (${w.tenantId}, ${turn}, ${seq}, ${step}, ${kind},
                    ${JSON.stringify(payload)}::jsonb, ${at}::timestamptz)`,
      );
    }
  });
  return { conversation, turn };
}

async function setAuditorsVisible(w: World, token: string, visible: boolean): Promise<void> {
  const current = await call(on(), w, token, 'GET', '/settings');
  expect(current.statusCode, current.body).toBe(200);
  const res = await call(on(), w, token, 'PUT', '/settings', {
    ...current.json<Record<string, unknown>>(),
    assistant_auditor_visible: visible,
  });
  expect(res.statusCode, res.body).toBe(200);
}

async function textReads(w: World) {
  return s().auditRows(w, 'assistant.text_read');
}

async function reportRows(w: World) {
  return s().auditRows(w, 'assistant.report');
}

describe('the activity routes', () => {
  it('refuse a caller without read-assistant-activity, and manage-assistant alone does not read conversations', async () => {
    const w = await s().world(['use-assistant', 'manage-assistant'], 'openid');
    const token = await adminToken(w);
    const made = await seedConversation(w, w.subjectId);
    for (const tail of [
      '/activity',
      `/activity/conversations/${made.conversation}`,
      `/activity/conversations/${made.conversation}/promptfoo`,
    ]) {
      expect((await call(on(), w, token, 'GET', tail)).statusCode, tail).toBe(403);
    }
  });

  it('answer as paths never served where the deployment has no assistant', async () => {
    const w = await s().world(['read-assistant-activity'], 'openid');
    const token = await adminToken(w);
    for (const tail of ['/activity', `/activity/conversations/${newId()}`]) {
      const res = await call(s().app, w, token, 'GET', tail);
      expect(res.statusCode, tail).toBe(404);
      expect(res.json()).toMatchObject({ detail: 'No resource at this path' });
    }
  });

  it('list a tenant’s conversations with the person’s name, and page them with a link', async () => {
    const w = await s().world(['read-assistant-activity'], 'openid');
    const token = await adminToken(w);
    await seedConversation(w, w.subjectId, 'list_clients');
    await seedConversation(w, w.subjectId, 'get_role');
    await seedConversation(w, w.subjectId, 'get_role');

    const all = await call(on(), w, token, 'GET', '/activity?limit=2');
    expect(all.statusCode, all.body).toBe(200);
    const first = all.json<{
      items: { id: string; tools: string[]; tokens: object }[];
      next?: string;
    }>();
    expect(first.items).toHaveLength(2);
    expect(first.next).toBeDefined();
    expect(all.headers.link).toContain('rel="next"');
    expect(first.items[0]).toMatchObject({
      person: w.subjectId,
      steps: 1,
      turns: 1,
      stop_reason: 'done',
      tokens: { fast: 0, standard: 48, deep: 0 },
    });

    const rest = await call(
      on(),
      w,
      token,
      'GET',
      `/activity?limit=2&cursor=${encodeURIComponent(first.next ?? '')}`,
    );
    expect(rest.json<{ items: unknown[] }>().items).toHaveLength(1);

    const byTool = await call(on(), w, token, 'GET', '/activity?tool=list_clients');
    expect(byTool.json<{ items: unknown[] }>().items).toHaveLength(1);
    const byOutcome = await call(on(), w, token, 'GET', '/activity?outcome=error');
    expect(byOutcome.json<{ items: unknown[] }>().items).toHaveLength(0);
  });

  it('refuse a cursor made for other filters, an unknown parameter and a limit of zero', async () => {
    const w = await s().world(['read-assistant-activity'], 'openid');
    const token = await adminToken(w);
    await seedConversation(w, w.subjectId);
    await seedConversation(w, w.subjectId);
    const page = await call(on(), w, token, 'GET', '/activity?limit=1');
    const next = page.json<{ next?: string }>().next ?? '';
    const wrong = await call(
      on(),
      w,
      token,
      'GET',
      `/activity?limit=1&tool=get_role&cursor=${encodeURIComponent(next)}`,
    );
    expect(wrong.statusCode, wrong.body).toBe(400);
    expect((await call(on(), w, token, 'GET', '/activity?bogus=1')).statusCode).toBe(400);
    expect((await call(on(), w, token, 'GET', '/activity?outcome=sideways')).statusCode).toBe(400);
  });

  it('replay a conversation with its steps, events, reasons and the masked message', async () => {
    const w = await s().world(['read-assistant-activity', 'manage-assistant'], 'openid');
    const token = await adminToken(w);
    await setAuditorsVisible(w, token, true);
    const made = await seedConversation(w, w.subjectId);
    const res = await call(on(), w, token, 'GET', `/activity/conversations/${made.conversation}`);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<{
      conversation: { id: string; person_username: string | null };
      asked: { text: string }[];
      turns: {
        id: string;
        steps: unknown[];
        events: { kind: string }[];
        why_stopped: string;
      }[];
    }>();
    expect(body.conversation.id).toBe(made.conversation);
    expect(body.turns).toHaveLength(1);
    expect(body.turns[0]?.events.map((e) => e.kind)).toEqual(['tool_call', 'tool_result', 'text']);
    expect(body.turns[0]?.why_stopped).toBe('The model finished its answer.');
    expect(body.asked[0]?.text).toContain('how many clients?');
    expect(res.body).not.toContain('s3cr3t-value-12345');
  });

  it('export a promptfoo case as a download that holds no tool result', async () => {
    const w = await s().world(['read-assistant-activity', 'manage-assistant'], 'openid');
    const token = await adminToken(w);
    await setAuditorsVisible(w, token, true);
    const made = await seedConversation(w, w.subjectId);
    const res = await call(
      on(),
      w,
      token,
      'GET',
      `/activity/conversations/${made.conversation}/promptfoo`,
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-disposition']).toContain(
      `assistant-${made.conversation}.promptfoo.json`,
    );
    expect(res.json()).toMatchObject({
      vars: { profile: 'free-chat', mode: 'ask' },
      assert: [],
      metadata: { source: 'odudu-assistant-trace', version: 1, conversation: made.conversation },
    });
    expect(res.body).not.toContain('RESULT-MARKER');
    expect(res.body).not.toContain('s3cr3t-value-12345');
  });

  it('do not reach a conversation of another tenant', async () => {
    const a = await s().world(['read-assistant-activity'], 'openid');
    const b = await s().world(['read-assistant-activity'], 'openid');
    const made = await seedConversation(a, a.subjectId);
    const token = await adminToken(b);
    for (const tail of [
      `/activity/conversations/${made.conversation}`,
      `/activity/conversations/${made.conversation}/promptfoo`,
    ]) {
      expect((await call(on(), b, token, 'GET', tail)).statusCode, tail).toBe(404);
    }
    // A malformed id is refused by the router before any handler sees it.
    expect(
      (await call(on(), b, token, 'GET', '/activity/conversations/not-an-id')).statusCode,
    ).toBe(400);
    const listed = await call(on(), b, token, 'GET', '/activity');
    expect(listed.json<{ items: unknown[] }>().items).toEqual([]);
    const reported = await call(
      on(),
      b,
      token,
      'POST',
      `/conversations/${made.conversation}/report`,
    );
    expect(reported.statusCode).toBe(404);
  });

  it('show an auditor the metadata always, and the text only when the tenant lets them, recording each read', async () => {
    const admin = await s().world(['read-assistant-activity', 'manage-assistant'], 'openid');
    const key = await adminToken(admin);
    const other = await withTenant(s().appDb.db, admin.tenantId, async (tx) => {
      const id = newId();
      await tx.execute(
        sql`insert into subjects (id, tenant_id, type) values (${id}, ${admin.tenantId}, 'user')`,
      );
      return id;
    });
    const made = await seedConversation(admin, other);
    const replayTail = `/activity/conversations/${made.conversation}`;

    // A new tenant has not let auditors read text: the default is off.
    const settings = await call(on(), admin, key, 'GET', '/settings');
    expect(settings.json()).toMatchObject({ assistant_auditor_visible: false });
    const listed = await call(on(), admin, key, 'GET', '/activity');
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ items: { id: string; tools: string[] }[] }>().items[0]).toMatchObject({
      id: made.conversation,
      tools: ['list_clients'],
    });
    for (const tail of [replayTail, `${replayTail}/promptfoo`]) {
      const res = await call(on(), admin, key, 'GET', tail);
      expect(res.statusCode, tail).toBe(200);
      for (const hidden of [
        'how many clients',
        'You have one client.',
        'RESULT-MARKER',
        '"limit":5',
      ]) {
        expect(res.body, `${tail} ${hidden}`).not.toContain(hidden);
      }
      expect(res.body).toContain('[text not visible to auditors in this tenant]');
    }
    const metadata = await call(on(), admin, key, 'GET', replayTail);
    expect(metadata.json()).toMatchObject({
      text_visible: false,
      turns: [{ steps: [{ slot: 'standard' }], stop_reason: 'done' }],
    });
    expect(await textReads(admin)).toHaveLength(0);

    await setAuditorsVisible(admin, key, true);
    const shown = await call(on(), admin, key, 'GET', replayTail);
    expect(shown.body).toContain('how many clients?');
    expect(shown.json()).toMatchObject({ text_visible: true });
    const exported = await call(on(), admin, key, 'GET', `${replayTail}/promptfoo`);
    expect(exported.body).toContain('how many clients?');
    const rows = await textReads(admin);
    expect(rows.map((row) => (row.detail as { part: string }).part).sort()).toEqual([
      'export',
      'replay',
    ]);
    expect(rows[0]).toMatchObject({
      action: 'assistant.text_read',
      resourceId: made.conversation,
      outcome: 'allowed',
      actorSubjectId: admin.subjectId,
    });
    expect(rows[0]?.detail).toMatchObject({ owner: other, conversation: made.conversation });
    expect(JSON.stringify(rows)).not.toContain('how many clients');
  });

  it('read nothing of the text of a conversation that is the reader’s own as a record of a read', async () => {
    const admin = await s().world(['read-assistant-activity', 'manage-assistant'], 'openid');
    const key = await adminToken(admin);
    await setAuditorsVisible(admin, key, true);
    const made = await seedConversation(admin, admin.subjectId);
    const res = await call(on(), admin, key, 'GET', `/activity/conversations/${made.conversation}`);
    expect(res.statusCode).toBe(200);
    expect(await textReads(admin)).toHaveLength(0);
  });
});

describe('the report route', () => {
  it('keeps a conversation once, audits it once and answers the same time again', async () => {
    const w = await s().world(['use-assistant', 'read-assistant-activity'], 'openid');
    const token = await adminToken(w);
    const made = await seedConversation(w, w.subjectId);
    const first = await call(on(), w, token, 'POST', `/conversations/${made.conversation}/report`);
    expect(first.statusCode, first.body).toBe(200);
    const again = await call(on(), w, token, 'POST', `/conversations/${made.conversation}/report`);
    expect(again.json()).toEqual(first.json());
    const rows = await reportRows(w);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'assistant.report',
      resourceId: made.conversation,
      outcome: 'allowed',
    });
    const listed = await call(on(), w, token, 'GET', '/activity');
    expect(listed.json<{ items: { reported_at: string | null }[] }>().items[0]?.reported_at).toBe(
      first.json<{ reported_at: string }>().reported_at,
    );
  });

  it('lets an owner report their own conversation, and a reader of activity any', async () => {
    const owner = await s().world(['use-assistant'], 'openid');
    const manager = await s().world(['read-assistant-activity', 'manage-assistant'], 'openid');
    const managerKey = await adminToken(manager);
    const mine = await seedConversation(manager, manager.subjectId);
    // A conversation of someone else in the manager's tenant.
    const other = await withTenant(s().appDb.db, manager.tenantId, async (tx) => {
      const id = newId();
      await tx.execute(
        sql`insert into subjects (id, tenant_id, type) values (${id}, ${manager.tenantId}, 'user')`,
      );
      return id;
    });
    const theirs = await seedConversation(manager, other);
    const own = await call(
      on(),
      manager,
      managerKey,
      'POST',
      `/conversations/${mine.conversation}/report`,
    );
    expect(own.statusCode, own.body).toBe(200);
    // Reporting shows no text, so a reader of activity may report whatever the tenant chose.
    const seen = await call(
      on(),
      manager,
      managerKey,
      'POST',
      `/conversations/${theirs.conversation}/report`,
    );
    expect(seen.statusCode, seen.body).toBe(200);
    expect(seen.json()).toMatchObject({ reported_count: 2, near_limit: false });
    // Someone with neither the capability nor the conversation is told it is not there.
    const stranger = await call(
      on(),
      owner,
      await adminToken(owner),
      'POST',
      `/conversations/${theirs.conversation}/report`,
    );
    expect(stranger.statusCode).toBe(404);
  });

  it('answers 409 beyond a hundred reported conversations and still answers the ones already kept', async () => {
    const w = await s().world(['use-assistant'], 'openid');
    const token = await adminToken(w);
    await withTenant(s().appDb.db, w.tenantId, (tx) =>
      tx.execute(
        sql`insert into assistant_conversations
              (tenant_id, id, owner_subject_id, instance_id, profile, mode, reported_at)
            select ${w.tenantId}, gen_random_uuid(), ${w.subjectId}, gen_random_uuid(),
                   'free-chat', 'ask', now()
              from generate_series(1, 99)`,
      ),
    );
    const one = await seedConversation(w, w.subjectId);
    const two = await seedConversation(w, w.subjectId);
    expect(
      (await call(on(), w, token, 'POST', `/conversations/${one.conversation}/report`)).statusCode,
    ).toBe(200);
    const refused = await call(on(), w, token, 'POST', `/conversations/${two.conversation}/report`);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(
      (await call(on(), w, token, 'POST', `/conversations/${one.conversation}/report`)).statusCode,
    ).toBe(200);
    expect(await reportRows(w)).toHaveLength(1);
  });
});
