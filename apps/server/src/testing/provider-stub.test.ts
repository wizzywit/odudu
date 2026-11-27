import { createLanguageModel } from '@odudu/assistant';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { replyFor, startProviderStub } from '#/testing/provider-stub';
import type { Server } from 'node:http';

let server: Server;
let base = '';

beforeAll(async () => {
  server = await startProviderStub(0);
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(() => {
  server.close();
});

async function ask(messages: unknown[]): Promise<string> {
  const response = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'stub-model', stream: true, messages }),
  });
  expect(response.headers.get('content-type')).toBe('text/event-stream');
  return response.text();
}

it('asks for a tool on the first round of a fixture and answers once its result is back', () => {
  const user = { role: 'user', content: 'How many clients?' };
  expect(replyFor([user])).toEqual({ tool: { name: 'count_clients', arguments: {} } });
  expect(
    replyFor([
      user,
      { role: 'assistant', tool_calls: [{ id: 'x' }] },
      { role: 'tool', content: '{}' },
    ]).text,
  ).toContain('counted the clients');
});

it('does not ask again for a call that was refused and left no tool message', () => {
  expect(
    replyFor([
      { role: 'user', content: 'refuse me' },
      { role: 'assistant', tool_calls: [{ id: 'x' }] },
    ]).text,
  ).toContain('did not create');
});

it('picks the fixture from the last thing the person said, not an earlier one', () => {
  expect(
    replyFor([
      { role: 'user', content: 'How many clients?' },
      { role: 'tool', content: '{}' },
      { role: 'user', content: 'refuse me' },
    ]).tool?.arguments,
  ).toMatchObject({ name: 'e2e-refused' });
});

it('streams a tool call with the usage a budget counts, then [DONE]', async () => {
  const text = await ask([{ role: 'user', content: 'approve me' }]);
  expect(text).toContain('"name":"create_group"');
  expect(text).toContain('"finish_reason":"tool_calls"');
  expect(text).toContain('"total_tokens":50');
  expect(text.trimEnd().endsWith('data: [DONE]')).toBe(true);
});

it('says plainly what it is for a message no fixture knows', async () => {
  expect(await ask([{ role: 'user', content: 'something else' }])).toContain('only the fixtures');
});

interface Streaming {
  doStream: (options: {
    prompt: unknown[];
  }) => Promise<{ stream: ReadableStream<{ type: string }> }>;
}

it('is read by the provider the server uses for an OpenAI-compatible slot', async () => {
  const model = createLanguageModel(
    { provider: 'openai-compatible', model: 'stub-model' },
    { ODUDU_ASSISTANT_OPENAI_COMPATIBLE_BASE_URL: `${base}/v1` },
  ) as unknown as Streaming;
  const { stream } = await model.doStream({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'approve me' }] }],
  });
  const parts: { type: string; toolName?: string }[] = [];
  for await (const part of stream as unknown as AsyncIterable<{
    type: string;
    toolName?: string;
  }>) {
    parts.push(part);
  }
  expect(parts.find((part) => part.type === 'tool-call')?.toolName).toBe('create_group');
  expect(parts.some((part) => part.type === 'finish')).toBe(true);
});
