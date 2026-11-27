import type { UIMessage, UIMessageChunk } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import type { Gateway, StreamOptions, StreamResult } from '#/shared/api/transport/gateway';
import { chatTransport } from '#/widgets/assistant-panel/adapter/chat';
import { ChatCallError } from '#/widgets/assistant-panel/services/chatCallError';

interface Call {
  method: string;
  path: string;
  options: StreamOptions;
}

function sse(...parts: unknown[]): Response {
  const body = `${parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join('')}data: [DONE]\n\n`;
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

function harness(answer: StreamResult | (() => StreamResult)) {
  const connected = vi.fn<() => void>();
  const calls: Call[] = [];
  const gateway: Pick<Gateway, 'stream'> = {
    stream: (method, path, options) => {
      calls.push({ method, path, options });
      return Promise.resolve(typeof answer === 'function' ? answer() : answer);
    },
  };
  const conversation = vi.fn<() => Promise<string>>(() => Promise.resolve('c1'));
  const transport = chatTransport({
    gateway: gateway as Gateway,
    tenant: 'acme',
    conversation,
    onConnected: connected,
  });
  return { calls, conversation, transport, connected };
}

const USER: UIMessage = {
  id: 'm1',
  role: 'user',
  parts: [{ type: 'text', text: 'How many clients?' }],
};
const ASSISTANT: UIMessage = {
  id: 'm2',
  role: 'assistant',
  parts: [{ type: 'text', text: 'Checking.' }],
};

async function chunksOf(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
  const reader = stream.getReader();
  const chunks: UIMessageChunk[] = [];
  for (;;) {
    const next = await reader.read();
    if (next.done) return chunks;
    chunks.push(next.value);
  }
}

describe('the chat transport', () => {
  it('sends only the last thing the person typed, as text, to the conversation’s messages', async () => {
    const { calls, transport, conversation } = harness({
      ok: true,
      response: sse({ type: 'start' }, { type: 'finish' }),
    });
    const controller = new AbortController();

    await transport.sendMessages({
      chatId: 'local',
      messages: [USER],
      abortSignal: controller.signal,
      trigger: 'submit-message',
      messageId: undefined,
    });

    expect(conversation).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.path).toBe('admin/tenants/acme/assistant/conversations/c1/messages');
    expect(JSON.parse(calls[0]?.options.body ?? '')).toEqual({
      message: { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'How many clients?' }] },
    });
    expect(calls[0]?.options.signal).toBeDefined();
  });

  it('says so once the server has taken the turn, and not when it refused it', async () => {
    const taken = harness({ ok: true, response: sse({ type: 'finish' }) });
    await taken.transport.sendMessages({
      chatId: 'x',
      messages: [USER],
      abortSignal: undefined,
      trigger: 'submit-message',
      messageId: undefined,
    });
    expect(taken.connected).toHaveBeenCalledTimes(1);
    const refused = harness({ ok: false, kind: 'network' });
    await refused.transport
      .sendMessages({
        chatId: 'x',
        messages: [USER],
        abortSignal: undefined,
        trigger: 'submit-message',
        messageId: undefined,
      })
      .catch(() => undefined);
    expect(refused.connected).not.toHaveBeenCalled();
  });

  it('carries a turn on, with no message, when the last message is the assistant’s', async () => {
    const { calls, transport } = harness({ ok: true, response: sse({ type: 'finish' }) });

    await transport.sendMessages({
      chatId: 'local',
      messages: [USER, ASSISTANT],
      abortSignal: undefined,
      trigger: 'submit-message',
      messageId: undefined,
    });

    expect(calls[0]?.path).toBe('admin/tenants/acme/assistant/conversations/c1/resume');
    expect(calls[0]?.options.body).toBeUndefined();
  });

  it('encodes a conversation id that is not a plain segment', async () => {
    const { calls, transport, conversation } = harness({ ok: true, response: sse({}) });
    conversation.mockResolvedValue('a/b c');
    await transport.sendMessages({
      chatId: 'x',
      messages: [USER],
      abortSignal: undefined,
      trigger: 'submit-message',
      messageId: undefined,
    });
    expect(calls[0]?.path).toBe('admin/tenants/acme/assistant/conversations/a%2Fb%20c/messages');
  });

  it('throws what the gateway refused with, for the panel to word', async () => {
    const refusal: StreamResult = {
      ok: false,
      kind: 'problem',
      problem: { type: 'about:blank', title: 'Conflict', status: 409 },
    };
    const { transport } = harness(refusal);
    const sent = transport.sendMessages({
      chatId: 'x',
      messages: [USER],
      abortSignal: undefined,
      trigger: 'submit-message',
      messageId: undefined,
    });
    await expect(sent).rejects.toBeInstanceOf(ChatCallError);
    await expect(sent).rejects.toMatchObject({ failure: refusal });
  });

  it('does not send when the conversation could not be started', async () => {
    const { calls, transport, conversation } = harness({ ok: true, response: sse({}) });
    conversation.mockRejectedValue(new ChatCallError({ ok: false, kind: 'network' }));
    await expect(
      transport.sendMessages({
        chatId: 'x',
        messages: [USER],
        abortSignal: undefined,
        trigger: 'submit-message',
        messageId: undefined,
      }),
    ).rejects.toBeInstanceOf(ChatCallError);
    expect(calls).toHaveLength(0);
  });

  it('delivers the turn’s end before the error that explains it', async () => {
    const { transport } = harness({
      ok: true,
      response: sse(
        { type: 'start' },
        { type: 'error', errorText: 'The allowance is used.' },
        { type: 'data-turn_end', data: { stopReason: 'budget_turn' }, transient: true },
      ),
    });
    const stream = await transport.sendMessages({
      chatId: 'x',
      messages: [USER],
      abortSignal: undefined,
      trigger: 'submit-message',
      messageId: undefined,
    });
    expect((await chunksOf(stream)).map((chunk) => chunk.type)).toEqual([
      'start',
      'data-turn_end',
      'error',
    ]);
  });
});
