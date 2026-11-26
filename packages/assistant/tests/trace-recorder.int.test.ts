import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { jsonSchema, registerTelemetry, tool, ToolLoopAgent, type Telemetry } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { conversationRepository } from '#/repository/conversations';
import type { Masker } from '#/service/mask-secrets';
import { traceRecorder, type TraceRecorder } from '#/usecase/trace-recorder';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 8 });
}, 120_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container.stop();
});

const HASH = 'b'.repeat(64);

interface Fixture {
  tenantId: string;
  conversationId: string;
}

async function fixture(): Promise<Fixture> {
  const tenantId = newId();
  const conversationId = newId();
  await withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `rec-${tenantId.slice(-12)}` });
    const subjectId = newId();
    await tx.execute(
      sql`insert into subjects (id, tenant_id, type) values (${subjectId}, ${tenantId}, 'user')`,
    );
    await conversationRepository(tx).create({
      id: conversationId,
      tenantId,
      ownerSubjectId: subjectId,
      instanceId: newId(),
      profile: 'free-chat',
      mode: 'ask',
      now: new Date(),
    });
  });
  return { tenantId, conversationId };
}

function recorderFor(
  f: Fixture,
  over: Partial<Parameters<typeof traceRecorder>[0]> = {},
): { recorder: TraceRecorder; turnId: string; log: ReturnType<typeof vi.fn> } {
  const turnId = newId();
  const log = vi.fn();
  const recorder = traceRecorder({
    transact: (fn) => withTenant(app.db, f.tenantId, fn),
    now: () => new Date(),
    newId,
    tenantId: f.tenantId,
    turnId,
    conversationId: f.conversationId,
    profile: 'free-chat',
    slot: 'standard',
    maskEmails: false,
    log,
    ...over,
  });
  return { recorder, turnId, log };
}

const USAGE = {
  inputTokens: { total: 7, noCache: 7, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 3, text: 3, reasoning: 0 },
};

type Content = Record<string, unknown>[];

// One scripted reply per call.
function model(...replies: Content[]): MockLanguageModelV3 {
  let call = 0;
  return new MockLanguageModelV3({
    doGenerate: () => {
      const content = replies[Math.min(call, replies.length - 1)] ?? [];
      const calling = content.some((part) => part.type === 'tool-call');
      call += 1;
      return Promise.resolve({
        content,
        finishReason: { unified: calling ? 'tool-calls' : 'stop', raw: undefined },
        usage: USAGE,
        warnings: [],
        response: { id: `resp-${String(call)}`, modelId: 'mock-model', timestamp: new Date() },
      } as never);
    },
  });
}

const say = (text: string): Content => [{ type: 'text', text }];
const call = (id: string, name: string, input: unknown): Content => [
  { type: 'tool-call', toolCallId: id, toolName: name, input: JSON.stringify(input) },
];

type Row = Record<string, unknown>;

async function rows(table: string, turnId: string): Promise<Row[]> {
  const found = await owner.sql.unsafe<Row[]>(
    `select * from ${table} where ${table === 'assistant_turns' ? 'id' : 'turn_id'} = '${turnId}' order by ${
      table === 'assistant_events' ? 'seq' : 'started_at'
    }`,
  );
  return [...found];
}

describe('the recorder over a real agent', () => {
  it('stores nesting: a sub-agent’s steps sit under the step that called it (subagent_nests_under_parent)', async () => {
    const f = await fixture();
    const { recorder, turnId } = recorderFor(f);
    await recorder.begin(HASH);

    const child = new ToolLoopAgent({
      model: model(say('child answer')),
      telemetry: { integrations: [recorder] },
    });
    const parent = new ToolLoopAgent({
      model: model(call('c1', 'delegate', { task: 'x' }), say('done')),
      tools: {
        delegate: tool({
          description: 'runs another agent',
          inputSchema: jsonSchema<{ task: string }>({
            type: 'object',
            properties: { task: { type: 'string' } },
            required: ['task'],
          }),
          execute: async () => (await child.generate({ prompt: 'child' })).text,
        }),
      },
      telemetry: { integrations: [recorder] },
    });
    await parent.generate({ prompt: 'go' });
    await recorder.end('done');

    const steps = await rows('assistant_steps', turnId);
    expect(steps).toHaveLength(3);
    const [first, second, third] = steps;
    const nested = steps.filter((step) => step.parent_step_id !== null);
    expect(nested).toHaveLength(1);
    // The child's only step belongs to the parent's first step, the one that made the call.
    expect(nested[0]?.parent_step_id).toBe(first?.id);
    expect([second, third].map((s) => s?.parent_step_id ?? null)).toContain(null);
    expect(steps.every((step) => step.ended_at !== null)).toBe(true);
  });

  it('gives the recorder every event when it is passed per call, and the global one none (telemetry_per_call_replaces_global)', async () => {
    const f = await fixture();
    const { recorder, turnId } = recorderFor(f);
    await recorder.begin(HASH);
    const seen = { global: 0, forwarded: 0 };
    const count = (key: keyof typeof seen): Telemetry => ({
      onStepStart: () => {
        seen[key] += 1;
      },
    });
    registerTelemetry(count('global'));

    const agent = new ToolLoopAgent({
      model: model(say('hi')),
      telemetry: { integrations: [recorder, count('forwarded')] },
    });
    await agent.generate({ prompt: 'hello' });
    await recorder.end('done');

    expect(seen).toEqual({ global: 0, forwarded: 1 });
    expect(await rows('assistant_steps', turnId)).toHaveLength(1);

    const bare = new ToolLoopAgent({ model: model(say('hi')) });
    await bare.generate({ prompt: 'hello' });
    expect(seen.global).toBe(1);
    registerTelemetry();
  });

  it('records each step with its tokens and the provider’s request id, and each tool call in order', async () => {
    const f = await fixture();
    const { recorder, turnId } = recorderFor(f);
    await recorder.begin(HASH);
    const agent = new ToolLoopAgent({
      model: model(call('c1', 'lookup', { id: 7 }), say('found it')),
      instructions: 'SYSTEM-PROMPT-THAT-IS-NOT-STORED',
      tools: {
        lookup: tool({
          description: 'looks up',
          inputSchema: jsonSchema<{ id: number }>({
            type: 'object',
            properties: { id: { type: 'number' } },
            required: ['id'],
          }),
          execute: () => ({ name: 'seven' }),
        }),
      },
      telemetry: { integrations: [recorder] },
    });
    await agent.generate({ prompt: 'find seven' });
    await recorder.end('done');

    const steps = await rows('assistant_steps', turnId);
    expect(steps.map((s) => [s.input_tokens, s.output_tokens, s.provider_request_id])).toEqual([
      [7, 3, 'resp-1'],
      [7, 3, 'resp-2'],
    ]);
    expect(steps.every((s) => s.slot === 'standard' && typeof s.model === 'string')).toBe(true);
    const events = await rows('assistant_events', turnId);
    expect(events.map((e) => e.kind)).toEqual([
      'model_call',
      'tool_call',
      'tool_result',
      'model_call',
      'text',
    ]);
    expect(events[1]?.payload).toMatchObject({
      tool: 'lookup',
      tool_call_id: 'c1',
      input: { id: 7 },
    });
    expect(events[2]?.payload).toMatchObject({ output: { name: 'seven' } });
    expect(events[4]?.payload).toEqual({ text: 'found it' });
    const turn = (await rows('assistant_turns', turnId))[0];
    expect(turn).toMatchObject({ stop_reason: 'done', prompt_hash: HASH });
    expect(turn?.ended_at).not.toBeNull();

    const everything = JSON.stringify([await rows('assistant_turns', turnId), steps, events]);
    expect(everything).not.toContain('SYSTEM-PROMPT-THAT-IS-NOT-STORED');
  });

  it('records a model failure as an error event and still closes the turn and its step', async () => {
    const f = await fixture();
    const { recorder, turnId } = recorderFor(f);
    await recorder.begin(HASH);
    const failing = new MockLanguageModelV3({
      doGenerate: () => Promise.reject(new Error('the provider fell over')),
    });
    const agent = new ToolLoopAgent({
      model: failing,
      maxRetries: 0,
      telemetry: { integrations: [recorder] },
    });
    await expect(agent.generate({ prompt: 'hello' })).rejects.toThrow();
    await recorder.end('error');

    const events = await rows('assistant_events', turnId);
    expect(events.map((e) => e.kind)).toContain('error');
    expect(JSON.stringify(events)).toContain('the provider fell over');
    const [step] = await rows('assistant_steps', turnId);
    expect(step?.ended_at).not.toBeNull();
    expect((await rows('assistant_turns', turnId))[0]).toMatchObject({ stop_reason: 'error' });
  });

  it('does not kill the turn when a write fails: it logs once, stops writing and says it was lost', async () => {
    const f = await fixture();
    const { recorder, log } = recorderFor(f, {
      transact: () => Promise.reject(new Error('the database is gone')),
    });
    await recorder.begin(HASH);
    const agent = new ToolLoopAgent({
      model: model(say('still answered')),
      telemetry: { integrations: [recorder] },
    });
    const result = await agent.generate({ prompt: 'hello' });
    await recorder.end('done');

    expect(result.text).toBe('still answered');
    expect(recorder.lost()).toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      'assistant.trace_failed',
      expect.objectContaining({ error: 'Error' }),
    );
  });

  it('keeps the first 499 events, then one that says how many were left out', async () => {
    const f = await fixture();
    const { recorder, turnId } = recorderFor(f);
    await recorder.begin(HASH);
    for (let i = 0; i < 700; i += 1) recorder.decision(turnId, 'policy', { i });
    await recorder.end('done');

    const events = await rows('assistant_events', turnId);
    expect(events).toHaveLength(500);
    expect(events.at(-1)).toMatchObject({ seq: 499, kind: 'truncated', payload: { dropped: 201 } });
    expect(events[498]?.payload).toEqual({ i: 498 });
  });

  it('cuts an event at 8 KiB and a turn at 128 KiB of content, and says so', async () => {
    const f = await fixture();
    const { recorder, turnId } = recorderFor(f);
    await recorder.begin(HASH);
    for (let i = 0; i < 60; i += 1)
      recorder.decision(turnId, 'policy', { text: 'é'.repeat(20_000) });
    await recorder.end('done');

    const events = await rows('assistant_events', turnId);
    const sizes = events.map((e) => Buffer.byteLength(JSON.stringify(e.payload)));
    expect(Math.max(...sizes.slice(0, -1))).toBeLessThanOrEqual(8_192);
    expect(events[0]?.payload).toMatchObject({ truncated: true });
    expect(events.at(-1)?.kind).toBe('truncated');
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThan(131_072 + 1_024);
    expect(recorder.lost()).toBe(false);
  });

  it('stores a turn whose model text, tool input and tool output hold NUL and lone surrogates', async () => {
    const f = await fixture();
    const { recorder, turnId } = recorderFor(f);
    await recorder.begin(HASH);
    const agent = new ToolLoopAgent({
      model: model(
        call('c1', 'lookup', { id: 7, note: 'in\u0000put\uD800' }),
        say('an\u0000swer\uDC00'),
      ),
      tools: {
        lookup: tool({
          description: 'looks up',
          inputSchema: jsonSchema<{ id: number }>({
            type: 'object',
            properties: { id: { type: 'number' } },
            required: ['id'],
          }),
          execute: () => ({ name: 'out\u0000put\uD83D' }),
        }),
      },
      telemetry: { integrations: [recorder] },
    });
    await agent.generate({ prompt: 'go' });
    recorder.decision(turnId, 'policy', { after: 'still stored' });
    await recorder.end('done');

    expect(recorder.lost()).toBe(false);
    const events = await rows('assistant_events', turnId);
    expect(events.map((e) => e.kind)).toEqual([
      'model_call',
      'tool_call',
      'tool_result',
      'model_call',
      'text',
      'policy',
    ]);
    expect(JSON.stringify(events)).toContain('\uFFFD');
    expect((await rows('assistant_turns', turnId))[0]?.ended_at).not.toBeNull();
  });

  it('does not let a tool result rewrite the choices the server recorded', async () => {
    const f = await fixture();
    const { recorder, turnId } = recorderFor(f);
    await recorder.begin(HASH);
    const agent = new ToolLoopAgent({
      model: model(call('c1', 'lookup', { id: 7 }), say('done')),
      tools: {
        lookup: tool({
          description: 'looks up',
          inputSchema: jsonSchema<{ id: number }>({
            type: 'object',
            properties: { id: { type: 'number' } },
            required: ['id'],
          }),
          execute: () => ({
            name: 'a group named password: allowed and token: reserved',
            client_secret: 'standard-slot-name',
          }),
        }),
      },
      telemetry: { integrations: [recorder] },
    });
    await agent.generate({ prompt: 'go' });
    recorder.decision(turnId, 'policy', { outcome: 'allowed', slot: 'standard-slot-name' });
    recorder.decision(turnId, 'reservation', { outcome: 'reserved' });
    await recorder.end('done');

    const events = await rows('assistant_events', turnId);
    const decisions = events.filter((e) => e.kind === 'policy' || e.kind === 'reservation');
    expect(decisions.map((e) => e.payload)).toEqual([
      { outcome: 'allowed', slot: 'standard-slot-name' },
      { outcome: 'reserved' },
    ]);
    const result = events.find((e) => e.kind === 'tool_result');
    expect(JSON.stringify(result?.payload)).not.toContain('"standard-slot-name"');
  });

  it('gives a write that hangs up after its deadline, and the turn goes on', async () => {
    const f = await fixture();
    const { recorder } = recorderFor(f, {
      transact: () => new Promise(() => undefined),
      deadlineMs: 50,
    });
    const started = Date.now();
    await recorder.begin(HASH);
    const agent = new ToolLoopAgent({
      model: model(say('answered anyway')),
      telemetry: { integrations: [recorder] },
    });
    const out = await agent.generate({ prompt: 'hello' });
    await recorder.end('done');
    expect(out.text).toBe('answered anyway');
    expect(recorder.lost()).toBe(true);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('makes one attempt to close a turn whose trace stopped, so it is not left looking open', async () => {
    const f = await fixture();
    let calls = 0;
    const { recorder, turnId } = recorderFor(f, {
      transact: (fn) => {
        calls += 1;
        // The step's first write fails; the turn's own open and the closing attempt do not.
        return calls === 2
          ? Promise.reject(new Error('a blip'))
          : withTenant(app.db, f.tenantId, fn);
      },
    });
    await recorder.begin(HASH);
    const agent = new ToolLoopAgent({
      model: model(say('hi')),
      telemetry: { integrations: [recorder] },
    });
    await agent.generate({ prompt: 'hello' });
    await recorder.end('done');

    expect(recorder.lost()).toBe(true);
    const turn = (await rows('assistant_turns', turnId))[0];
    expect(turn).toMatchObject({ stop_reason: 'done' });
    expect(turn?.ended_at).not.toBeNull();
  });

  it('closes a step whose opening write committed after its deadline, with one retry', async () => {
    const f = await fixture();
    let calls = 0;
    const { recorder, turnId } = recorderFor(f, {
      deadlineMs: 30,
      retryMs: 400,
      transact: (fn) => {
        calls += 1;
        // The step's opening write is slow: past the deadline, then it commits.
        return calls === 2
          ? new Promise((resolve, reject) => {
              setTimeout(() => {
                withTenant(app.db, f.tenantId, fn).then(resolve, reject);
              }, 120);
            })
          : withTenant(app.db, f.tenantId, fn);
      },
    });
    await recorder.begin(HASH);
    const agent = new ToolLoopAgent({
      model: model(say('hi')),
      telemetry: { integrations: [recorder] },
    });
    await agent.generate({ prompt: 'hello' });
    await recorder.end('done');

    expect(recorder.lost()).toBe(true);
    // Long enough for the slow write to have landed, whichever way it was closed.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const [step] = await rows('assistant_steps', turnId);
    expect(step).toBeDefined();
    expect(step?.ended_at).not.toBeNull();
    expect((await rows('assistant_turns', turnId))[0]?.ended_at).not.toBeNull();
  });

  it('keeps recording after a tool result nested 10,000 levels deep', async () => {
    const f = await fixture();
    const { recorder, turnId } = recorderFor(f);
    await recorder.begin(HASH);
    const deep = `${'['.repeat(10_000)}${']'.repeat(10_000)}`;
    const agent = new ToolLoopAgent({
      model: model(call('c1', 'lookup', { id: 7 }), say('answered after the deep one')),
      tools: {
        lookup: tool({
          description: 'looks up',
          inputSchema: jsonSchema<{ id: number }>({
            type: 'object',
            properties: { id: { type: 'number' } },
            required: ['id'],
          }),
          execute: () => ({ name: 'x', blob: deep, client_secret: 'abcdef-secret-1' }),
        }),
      },
      telemetry: { integrations: [recorder] },
    });
    await agent.generate({ prompt: 'go' });
    await recorder.end('done');

    expect(recorder.lost()).toBe(false);
    const events = await rows('assistant_events', turnId);
    expect(events.map((e) => e.kind)).toContain('text');
    expect(JSON.stringify(events)).not.toContain('abcdef-secret-1');
    expect(JSON.stringify(events)).not.toContain('[[[[[[[[');
  });

  it('stores an event its masker could not read as unreadable, never raw, and goes on', async () => {
    const f = await fixture();
    const throwing: Masker = {
      mask: (value) => {
        if (JSON.stringify(value).includes('BOOM')) throw new RangeError('cannot be read');
        return value;
      },
      maskRecord: (value) => value,
      know: () => undefined,
    };
    const { recorder, turnId } = recorderFor(f, { masker: throwing });
    await recorder.begin(HASH);
    const agent = new ToolLoopAgent({
      model: model(
        call('c1', 'lookup', { id: 7, note: 'BOOM-raw-content' }),
        say('fine afterwards'),
      ),
      tools: {
        lookup: tool({
          description: 'looks up',
          inputSchema: jsonSchema<{ id: number }>({
            type: 'object',
            properties: { id: { type: 'number' }, note: { type: 'string' } },
            required: ['id'],
          }),
          execute: () => ({ ok: true }),
        }),
      },
      telemetry: { integrations: [recorder] },
    });
    await agent.generate({ prompt: 'go' });
    await recorder.end('done');

    expect(recorder.lost()).toBe(false);
    const events = await rows('assistant_events', turnId);
    expect(JSON.stringify(events)).not.toContain('BOOM-raw-content');
    expect(events.find((e) => e.kind === 'tool_call')?.payload).toEqual({
      unreadable: '[masked-unreadable]',
    });
    expect(events.map((e) => e.kind)).toContain('tool_result');
    expect(events.map((e) => e.kind)).toContain('text');
  });

  it('ignores a decision that names another turn', async () => {
    const f = await fixture();
    const { recorder, turnId } = recorderFor(f);
    await recorder.begin(HASH);
    recorder.decision(newId(), 'policy', { other: true });
    recorder.decision(turnId, 'slot_chosen', { slot: 'standard' });
    await recorder.end('done');
    const events = await rows('assistant_events', turnId);
    expect(events.map((e) => e.kind)).toEqual(['slot_chosen']);
  });

  it('writes nothing for a turn it never began', async () => {
    const f = await fixture();
    const { recorder, turnId } = recorderFor(f);
    recorder.decision(turnId, 'slot_chosen', { slot: 'standard' });
    await recorder.end('error');
    expect(await rows('assistant_turns', turnId)).toHaveLength(0);
    expect(recorder.lost()).toBe(false);
  });

  it('exposes no model-call hook that would carry the prompt, and no span of its own', () => {
    const f = { tenantId: newId(), conversationId: newId() };
    const { recorder } = recorderFor(f);
    expect(recorder.executeLanguageModelCall).toBeUndefined();
    expect(recorder.onLanguageModelCallStart).toBeUndefined();
  });
});
