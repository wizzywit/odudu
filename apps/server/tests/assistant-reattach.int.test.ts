import { resolveSlots } from '@odudu/assistant';
import { signingKeyRepository, signJwt } from '@odudu/crypto';
import { withTenant } from '@odudu/db';
import { roleRepository } from '@odudu/domain-authz';
import { subjectRepository } from '@odudu/domain-identity';
import { ADMIN_API_AUDIENCE, ADMIN_CLIENT_ID, ASSISTANT_CLIENT_ID } from '@odudu/domain-tenant';
import { loadConfig, newId } from '@odudu/kernel';
import { runInstanceId, tokenGrantRepository } from '@odudu/protocol-oidc';
import { sql } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { createLogger } from '#/logger';
import { BASE, startMcpStack, type McpStack } from '#/testing/mcp-stack';
import { consoleWorld, type World } from '#/testing/mcp-world';

// A conversation the administrator carries on after signing in again: a new
// grant of the new sign-in, the old one ended, the history kept, and every
// refusal the rule makes still made.

const KEK = Buffer.alloc(32, 7);
const HOST = 'id.example.com';
const ENV = {
  ODUDU_ASSISTANT_MODELS: 'standard=anthropic:claude-standard',
  ANTHROPIC_API_KEY: 'sk-ant-test-0123456789',
};
const CONTEXT = { route: '/subjects' };

let stack: McpStack | undefined;
let assisted: FastifyInstance | undefined;
// What the model was sent last, so a test can read its instructions.
let lastPrompt: unknown;

function s(): McpStack {
  if (stack === undefined) throw new Error('stack not started');
  return stack;
}
function on(): FastifyInstance {
  if (assisted === undefined) throw new Error('app not built');
  return assisted;
}

const USAGE = {
  inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
};

// Asks for one read on its first call of a turn and answers on its second.
function scriptedModel() {
  let call = 0;
  return {
    specificationVersion: 'v3',
    provider: 'stub',
    modelId: 'stub',
    supportedUrls: {},
    doGenerate: () => Promise.reject(new Error('streaming only')),
    doStream: (options: { prompt?: unknown }) => {
      lastPrompt = options.prompt;
      call += 1;
      const parts =
        call % 2 === 1
          ? [
              { type: 'stream-start', warnings: [] },
              {
                type: 'tool-call',
                toolCallId: `c${String(call)}`,
                toolName: 'count_subjects',
                input: '{}',
              },
              {
                type: 'finish',
                finishReason: { unified: 'tool-calls', raw: undefined },
                usage: USAGE,
              },
            ]
          : [
              { type: 'stream-start', warnings: [] },
              { type: 'text-start', id: 'a' },
              { type: 'text-delta', id: 'a', delta: 'Done.' },
              { type: 'text-end', id: 'a' },
              { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: USAGE },
            ];
      return Promise.resolve({
        stream: new ReadableStream({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      });
    },
  };
}

beforeAll(async () => {
  stack = await startMcpStack();
  assisted = buildApp({
    database: s().appDb,
    ownerDatabase: s().owner,
    kek: KEK,
    logger: createLogger(loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' })),
    tls: true,
    publicBaseUrl: BASE,
    throttle: { limit: 100_000, windowSeconds: 60 },
    assistant: { slots: resolveSlots(ENV), env: ENV },
    assistantModels: () => scriptedModel() as never,
  });
  await assisted.ready();
}, 180_000);
afterAll(async () => {
  await assisted?.close();
  await stack?.close();
});

interface SignIn {
  readonly grantId: string;
  readonly token: string;
}

async function tokenFor(w: World, grantId: string, subjectId: string): Promise<string> {
  const key = await withTenant(s().appDb.db, w.tenantId, (tx) => signingKeyRepository(tx).active());
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

// The sign-in the world began with, as the console holds it.
async function firstSignIn(w: World): Promise<SignIn> {
  return { grantId: w.grantId, token: await tokenFor(w, w.grantId, w.subjectId) };
}

// A further console sign-in of the same person on the same session.
async function signInAgain(w: World, subjectId = w.subjectId): Promise<SignIn> {
  const grantId = newId();
  await withTenant(s().appDb.db, w.tenantId, (tx) =>
    tokenGrantRepository(tx).create({
      id: grantId,
      tenantId: w.tenantId,
      clientId: w.adminDbId,
      subjectId,
      scope: 'openid',
      audience: [ADMIN_API_AUDIENCE],
      sessionId: w.sessionId,
    }),
  );
  return { grantId, token: await tokenFor(w, grantId, subjectId) };
}

// How the console's sign-out ends its grant: revoked as the person's own act,
// which is what the gateway's token revocation and a logout stamp.
async function signOut(w: World, grantId: string): Promise<void> {
  await withTenant(s().appDb.db, w.tenantId, (tx) =>
    tokenGrantRepository(tx).revoke(grantId, new Date(), 'sign_out'),
  );
}

// Any other end of a sign-in: a reused refresh token, an administrator.
async function revokeForCause(w: World, grantId: string): Promise<void> {
  await withTenant(s().appDb.db, w.tenantId, (tx) =>
    tokenGrantRepository(tx).revoke(grantId, new Date()),
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

function say(w: World, token: string, id: string, text: string) {
  return call(w, token, 'POST', `/conversations/${id}/messages`, {
    message: { id: `m-${newId()}`, role: 'user', parts: [{ type: 'text', text }] },
  });
}

async function conversationRow(id: string) {
  const rows = (await s().owner.db.execute(
    sql`select grant_id, run_generation, instance_id from assistant_conversations where id = ${id}`,
  )) as unknown as { grant_id: string | null; run_generation: number; instance_id: string }[];
  return rows[0];
}

async function grantRow(id: string) {
  const rows = (await s().owner.db.execute(
    sql`select g.id, g.revoked_at is not null as revoked, g.revoked_cause, g.exchanged_from_grant_id,
               g.session_id, g.scope, g.subject_id, c.client_id as client
          from token_grants g join clients c on c.id = g.client_id where g.id = ${id}`,
  )) as unknown as {
    id: string;
    revoked: boolean;
    revoked_cause: string | null;
    exchanged_from_grant_id: string | null;
    session_id: string | null;
    scope: string;
    subject_id: string;
    client: string;
  }[];
  return rows[0];
}

async function userMessages(id: string): Promise<number> {
  const rows = (await s().owner.db.execute(
    sql`select count(*)::int as n from assistant_messages where conversation_id = ${id} and role = 'user'`,
  )) as unknown as { n: number }[];
  return rows[0]?.n ?? -1;
}

async function liveInstances(grantId: string): Promise<number> {
  const rows = (await s().owner.db.execute(
    sql`select count(*)::int as n from agent_instances where root_grant_id = ${grantId} and revoked_at is null`,
  )) as unknown as { n: number }[];
  return rows[0]?.n ?? -1;
}

async function reattachedRows(w: World) {
  return s().auditRows(w, 'assistant.reattached');
}

async function refusals(w: World) {
  return (await s().auditRows(w, 'assistant.access_refused')).map(
    (row) => (row.detail as { refusal?: string }).refusal,
  );
}

const WORLD = ['use-assistant', 'view-users'];

describe('a conversation carried on after the person signs in again', () => {
  it('makes a new grant from the new sign-in, ends the old one and keeps the history', async () => {
    const w = await consoleWorld(s().appDb, BASE, WORLD);
    const first = await firstSignIn(w);
    const id = await started(w, first.token);
    const turn = await say(w, first.token, id, 'how many people?');
    expect(turn.body).toContain('tool-output-available');
    expect(await liveInstances(id)).toBe(1);

    await signOut(w, first.grantId);
    const second = await signInAgain(w);
    expect((await call(w, second.token, 'GET', '/last-conversation')).json()).toMatchObject({
      conversation: { id, continuable: true },
    });

    const again = await say(w, second.token, id, 'and now?');
    expect(again.statusCode, again.body).toBe(200);
    expect(again.body).toContain('tool-output-available');
    expect(again.body).not.toContain('Forbidden');

    const row = await conversationRow(id);
    expect(row?.grant_id).not.toBeNull();
    expect(row?.grant_id).not.toBe(id);
    expect(row?.run_generation).toBe(1);
    expect(row?.instance_id).toBe(runInstanceId(w.tenantId, id, `${id}.1`));

    const fresh = await grantRow(row?.grant_id ?? '');
    expect(fresh).toMatchObject({
      revoked: false,
      exchanged_from_grant_id: second.grantId,
      session_id: w.sessionId,
      scope: 'mcp:read',
      subject_id: w.subjectId,
      client: ASSISTANT_CLIENT_ID,
    });
    expect(await grantRow(id)).toMatchObject({ revoked: true });
    // Nothing of the old sign-in lives on: its instance ended, a new one runs.
    expect(await liveInstances(id)).toBe(0);
    expect(await liveInstances(row?.grant_id ?? '')).toBe(1);

    const audit = await reattachedRows(w);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      outcome: 'allowed',
      actorSubjectId: w.subjectId,
      resourceId: id,
      detail: {
        tenant: w.tenantId,
        subject: w.subjectId,
        conversation: id,
        previous_grant: id,
        new_grant: row?.grant_id,
      },
    });

    // The history is the person's: both turns are there, in order.
    const loaded = (await call(w, second.token, 'GET', `/conversations/${id}`)).json<{
      messages: { role: string }[];
    }>();
    expect(loaded.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  });

  it('says on a loaded conversation whether it takes a message, and whether it is hidden', async () => {
    const w = await consoleWorld(s().appDb, BASE, WORLD);
    const first = await firstSignIn(w);
    const id = await started(w, first.token);
    expect((await call(w, first.token, 'GET', `/conversations/${id}`)).json()).toMatchObject({
      archived: false,
      continuable: true,
    });
    await revokeForCause(w, first.grantId);
    const second = await signInAgain(w);
    expect((await call(w, second.token, 'GET', `/conversations/${id}`)).json()).toMatchObject({
      archived: false,
      continuable: false,
    });
    await call(w, second.token, 'PUT', `/conversations/${id}/archived`, { archived: true });
    expect((await call(w, second.token, 'GET', `/conversations/${id}`)).json()).toMatchObject({
      archived: true,
    });
  });

  it('ends both grants when a carried-on conversation is deleted', async () => {
    const w = await consoleWorld(s().appDb, BASE, WORLD);
    const first = await firstSignIn(w);
    const id = await started(w, first.token);
    await signOut(w, first.grantId);
    const second = await signInAgain(w);
    await say(w, second.token, id, 'carry on');
    const bound = (await conversationRow(id))?.grant_id ?? '';
    expect((await call(w, second.token, 'DELETE', `/conversations/${id}`)).statusCode).toBe(204);
    expect(await grantRow(bound)).toMatchObject({ revoked: true });
    expect(await grantRow(id)).toMatchObject({ revoked: true });
  });

  it('tells the model in its instructions that earlier tool data may be stale, and not before', async () => {
    const w = await consoleWorld(s().appDb, BASE, WORLD);
    const first = await firstSignIn(w);
    const id = await started(w, first.token);
    await say(w, first.token, id, 'first');
    expect(JSON.stringify(lastPrompt)).not.toContain('signed in again');
    await signOut(w, first.grantId);
    const second = await signInAgain(w);
    await say(w, second.token, id, 'second');
    const prompt = JSON.stringify(lastPrompt);
    expect(prompt).toContain('signed in again');
    expect(prompt).toContain('out of date');
    // The sentence is an instruction, not something the person typed.
    const roles = (lastPrompt as { role: string; content: unknown }[]).filter((m) =>
      JSON.stringify(m.content).includes('signed in again'),
    );
    expect(roles.map((m) => m.role)).toEqual(['system']);
  });

  it('also carries one on whose sign-in lapsed or is held by another sign-in', async () => {
    const w = await consoleWorld(s().appDb, BASE, WORLD);
    const first = await firstSignIn(w);
    const id = await started(w, first.token);
    const second = await signInAgain(w);
    const turn = await say(w, second.token, id, 'from the other tab');
    expect(turn.statusCode, turn.body).toBe(200);
    expect((await conversationRow(id))?.grant_id).not.toBeNull();
    expect(await grantRow(id)).toMatchObject({ revoked: true, revoked_cause: 'reattached' });
  });

  it('makes one grant when two messages arrive at once after the sign-in', async () => {
    const w = await consoleWorld(s().appDb, BASE, WORLD);
    const first = await firstSignIn(w);
    const id = await started(w, first.token);
    await signOut(w, first.grantId);
    const second = await signInAgain(w);
    const [a, b] = await Promise.all([
      say(w, second.token, id, 'one'),
      say(w, second.token, id, 'two'),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect(await reattachedRows(w)).toHaveLength(1);
    expect((await conversationRow(id))?.run_generation).toBe(1);
  });

  it('does not touch a conversation whose grant is live from this very sign-in', async () => {
    const w = await consoleWorld(s().appDb, BASE, WORLD);
    const first = await firstSignIn(w);
    const id = await started(w, first.token);
    await say(w, first.token, id, 'one');
    await say(w, first.token, id, 'two');
    expect((await conversationRow(id))?.grant_id).toBeNull();
    expect((await conversationRow(id))?.run_generation).toBe(0);
    expect(await reattachedRows(w)).toHaveLength(0);
  });
});

describe('what a new sign-in must not revive', () => {
  it('refuses a sign-in revoked for cause, as a reused refresh token or an administrator does, writing no grant and no message', async () => {
    const w = await consoleWorld(s().appDb, BASE, WORLD);
    const first = await firstSignIn(w);
    const id = await started(w, first.token);
    await say(w, first.token, id, 'before');
    await revokeForCause(w, first.grantId);
    const second = await signInAgain(w);
    const grantsBefore = await s().owner.db.execute(
      sql`select 1 from token_grants where tenant_id = ${w.tenantId}`,
    );
    const messagesBefore = await userMessages(id);

    expect((await call(w, second.token, 'GET', '/last-conversation')).json()).toMatchObject({
      conversation: { id, continuable: false },
    });
    const refused = await say(w, second.token, id, 'again');
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({ type: 'about:blank#conversation-ended' });

    expect(await userMessages(id)).toBe(messagesBefore);
    expect(
      await s().owner.db.execute(sql`select 1 from token_grants where tenant_id = ${w.tenantId}`),
    ).toHaveLength(grantsBefore.length);
    expect((await conversationRow(id))?.grant_id).toBeNull();
    expect(await reattachedRows(w)).toHaveLength(0);
    expect(await refusals(w)).toContain('revoked_for_cause');
  });

  it('refuses one whose conversation grant ended at another time than the sign-out', async () => {
    const w = await consoleWorld(s().appDb, BASE, WORLD);
    const first = await firstSignIn(w);
    const id = await started(w, first.token);
    await withTenant(s().appDb.db, w.tenantId, (tx) =>
      tokenGrantRepository(tx).revoke(id, new Date(Date.now() - 60_000)),
    );
    await signOut(w, first.grantId);
    const second = await signInAgain(w);
    const refused = await say(w, second.token, id, 'again');
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ type: 'about:blank#conversation-ended' });
  });

  it('refuses a hidden conversation, and carries it on once it is restored', async () => {
    const w = await consoleWorld(s().appDb, BASE, WORLD);
    const first = await firstSignIn(w);
    const id = await started(w, first.token);
    await signOut(w, first.grantId);
    const second = await signInAgain(w);
    expect(
      (await call(w, second.token, 'PUT', `/conversations/${id}/archived`, { archived: true }))
        .statusCode,
    ).toBe(200);
    const refused = await say(w, second.token, id, 'hidden');
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ type: 'about:blank#conversation-archived' });
    expect(await reattachedRows(w)).toHaveLength(0);

    await call(w, second.token, 'PUT', `/conversations/${id}/archived`, { archived: false });
    const carried = await say(w, second.token, id, 'restored');
    expect(carried.statusCode, carried.body).toBe(200);
    expect(await reattachedRows(w)).toHaveLength(1);
  });

  it('is not found for another administrator, a deleted conversation and a stranger’s id', async () => {
    const w = await consoleWorld(s().appDb, BASE, WORLD);
    const first = await firstSignIn(w);
    const id = await started(w, first.token);
    await signOut(w, first.grantId);

    const other = await withTenant(s().appDb.db, w.tenantId, async (tx) => {
      const subject = await subjectRepository(tx).create({ tenantId: w.tenantId, type: 'user' });
      const role = await roleRepository(tx).byName('use-assistant', w.adminDbId);
      if (role === null) throw new Error('no use-assistant role');
      await roleRepository(tx).assignToSubject(subject.id, role.id);
      return subject.id;
    });
    const stranger = await signInAgain(w, other);
    const refused = await say(w, stranger.token, id, 'not mine');
    expect(refused.statusCode).toBe(404);
    expect(await reattachedRows(w)).toHaveLength(0);
    expect((await conversationRow(id))?.grant_id).toBeNull();

    const second = await signInAgain(w);
    expect((await call(w, second.token, 'DELETE', `/conversations/${id}`)).statusCode).toBe(204);
    expect((await say(w, second.token, id, 'gone')).statusCode).toBe(404);
    expect(await reattachedRows(w)).toHaveLength(0);
  });

  it('refuses when the new sign-in no longer holds use-assistant, and says it is the sign-in', async () => {
    const w = await consoleWorld(s().appDb, BASE, WORLD);
    const first = await firstSignIn(w);
    const id = await started(w, first.token);
    await signOut(w, first.grantId);
    const second = await signInAgain(w);
    await s().owner.db.execute(sql`delete from subject_roles where subject_id = ${w.subjectId}`);
    const refused = await say(w, second.token, id, 'no right');
    // The door refuses a caller without the capability before the conversation is read.
    expect([403, 404]).toContain(refused.statusCode);
    expect(await reattachedRows(w)).toHaveLength(0);
  });

  it('refuses when the assistant is switched off for the tenant, and carries on when it is back', async () => {
    const w = await consoleWorld(s().appDb, BASE, [...WORLD, 'manage-assistant']);
    const first = await firstSignIn(w);
    const id = await started(w, first.token);
    await signOut(w, first.grantId);
    const second = await signInAgain(w);
    await s().owner.db.execute(
      sql`insert into assistant_settings (tenant_id, assistant_enabled) values (${w.tenantId}, false)
         on conflict (tenant_id) do update set assistant_enabled = excluded.assistant_enabled`,
    );
    const off = await say(w, second.token, id, 'off');
    expect(off.statusCode).toBe(404);
    expect(await reattachedRows(w)).toHaveLength(0);
    await s().owner.db.execute(
      sql`insert into assistant_settings (tenant_id, assistant_enabled) values (${w.tenantId}, true)
         on conflict (tenant_id) do update set assistant_enabled = excluded.assistant_enabled`,
    );
    expect((await say(w, second.token, id, 'on')).statusCode).toBe(200);
  });

  it('refuses a console grant that is not the caller’s', async () => {
    const w = await consoleWorld(s().appDb, BASE, WORLD);
    const first = await firstSignIn(w);
    const id = await started(w, first.token);
    await signOut(w, first.grantId);
    const second = await signInAgain(w);
    // A token naming the second sign-in's grant for another subject is not a
    // sign-in of this conversation's owner: the door refuses it on its own.
    const forged = await tokenFor(w, second.grantId, newId());
    const refused = await say(w, forged, id, 'forged');
    expect(refused.statusCode).not.toBe(200);
    expect(await reattachedRows(w)).toHaveLength(0);
  });
});
