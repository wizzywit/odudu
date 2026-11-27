import { TOOLS, type ToolResult } from '@odudu/mcp';
import type { UIMessage } from 'ai';
import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import { MAX_REQUEST_TOKENS } from '#/service/request-size';
import { FREE_CHAT, type TaskProfile } from '#/service/profiles';
import { refusalOf } from '#/service/limits';
import { BudgetRefused, type TurnBudgetPort } from '#/usecase/budget-hooks';
import { startTurn, type RunTurnDeps } from '#/usecase/run-turn';

const PROFILE: TaskProfile = { ...FREE_CHAT, maxSteps: 6 };
const USAGE = {
  inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
};

type Part = Record<string, unknown>;

const call = (id: string): Part[] => [
  { type: 'tool-call', toolCallId: id, toolName: 'list_clients', input: '{}' },
  { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: USAGE },
];

const answer = (text: string): Part[] => [
  { type: 'text-start', id: 'a' },
  { type: 'text-delta', id: 'a', delta: text },
  { type: 'text-end', id: 'a' },
  { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: USAGE },
];

function scripted(replies: Part[][], events: string[] = []): MockLanguageModelV3 {
  let n = 0;
  return new MockLanguageModelV3({
    doStream: () => {
      events.push('model');
      const reply = replies[Math.min(n, replies.length - 1)] ?? [];
      n += 1;
      return Promise.resolve({
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          ...reply,
        ] as never),
      });
    },
  });
}

const CLIENTS: ToolResult = {
  isError: false,
  content: [{ type: 'text', text: '{}' }],
  structuredContent: { data: [] },
};

const ask = (text: string): UIMessage => ({
  id: 'm1',
  role: 'user',
  parts: [{ type: 'text', text }],
});

function depsFor(model: MockLanguageModelV3, overrides: Partial<RunTurnDeps>): RunTurnDeps {
  return {
    model,
    profile: PROFILE,
    tenantText: '',
    tools: TOOLS,
    history: () => Promise.resolve([]),
    mintToken: () => Promise.resolve({ accessToken: 't' }),
    callTool: vi.fn(() => Promise.resolve(CLIENTS)),
    ...overrides,
  };
}

function recording(events: string[], refuse?: BudgetRefused): TurnBudgetPort {
  return {
    beforeCall: () => {
      events.push('before');
      return refuse === undefined ? Promise.resolve() : Promise.reject(refuse);
    },
    markSent: () => {
      events.push('sent');
      return Promise.resolve();
    },
    afterCall: (usage) => {
      events.push(`after:${String(usage.totalTokens)}`);
      return Promise.resolve();
    },
  };
}

async function run(deps: RunTurnDeps, text = 'hi') {
  const turn = await startTurn(deps, {
    conversationId: 'c',
    message: ask(text),
    signal: new AbortController().signal,
  });
  const parts: { type: string; error?: unknown }[] = [];
  for await (const part of turn.result.stream) parts.push(part);
  return { turn, parts };
}

describe('the loop with a budget', () => {
  it('reserves before each call, marks it sent, and settles with the provider’s count', async () => {
    const events: string[] = [];
    const model = scripted([call('1'), answer('done')], events);
    await run(depsFor(model, { budget: recording(events) }));
    expect(events).toEqual([
      'before',
      'sent',
      'model',
      'after:5',
      'before',
      'sent',
      'model',
      'after:5',
    ]);
  });

  it('ends the turn on a refusal without calling the model, and says who refused', async () => {
    const events: string[] = [];
    const refusal = new BudgetRefused(refusalOf('tenant_month'), 'standard');
    const model = scripted([answer('never')], events);
    const { parts, turn } = await run(depsFor(model, { budget: recording(events, refusal) }));
    expect(model.doStreamCalls).toHaveLength(0);
    expect(events).toEqual(['before']);
    expect(parts.some((part) => part.type === 'error')).toBe(true);
    expect(turn.progress().steps).toBe(0);
  });

  it('stops at the tenant’s step limit when it is lower than the profile’s', async () => {
    const model = scripted([call('1'), call('2'), call('3'), answer('late')]);
    const { turn } = await run(depsFor(model, { maxStepsPerTurn: 2 }));
    expect(turn.maxSteps).toBe(2);
    expect(turn.progress()).toEqual({ steps: 2, lastFinish: 'tool-calls' });
    expect(model.doStreamCalls).toHaveLength(2);
  });

  it('keeps the profile’s step limit when the tenant’s is higher', async () => {
    const model = scripted([call('1')]);
    const { turn } = await run(depsFor(model, { maxStepsPerTurn: 50 }));
    expect(turn.maxSteps).toBe(6);
  });

  it('sends the model no more than the request bound, whatever the history holds', async () => {
    const big: UIMessage[] = Array.from({ length: 30 }, (_, n) => ({
      id: `h${String(n)}`,
      role: n % 2 === 0 ? 'user' : 'assistant',
      parts: [{ type: 'text', text: 'x'.repeat(20_000) }],
    }));
    const model = scripted([answer('ok')]);
    await run(depsFor(model, { history: () => Promise.resolve(big) }), 'last question');
    const sent = JSON.stringify(model.doStreamCalls[0]?.prompt);
    expect(new TextEncoder().encode(sent).byteLength).toBeLessThan(MAX_REQUEST_TOKENS * 1.2);
    expect(sent).toContain('last question');
  });
});
