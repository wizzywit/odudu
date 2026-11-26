import { describe, expect, it } from 'vitest';
import { NO_METER } from '#/widgets/assistant-panel/services/budget';
import { chatView, type ChatViewInput } from '#/widgets/assistant-panel/services/chatView';
import { ChatCallError } from '#/widgets/assistant-panel/services/chatCallError';

const BASE: ChatViewInput = {
  history: 'none',
  chat: 'ready',
  messages: [],
  error: undefined,
  connected: false,
  turn: null,
  meter: NO_METER,
  expectsEnd: false,
  act: false,
};

function view(input: Partial<ChatViewInput>) {
  return chatView({ ...BASE, ...input });
}

describe('the conversation as the panel draws it', () => {
  it('draws the messages as parts the log knows, and marks nothing running while idle', () => {
    const result = view({
      messages: [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] },
        {
          id: '2',
          role: 'assistant',
          parts: [
            { type: 'reasoning', text: 'x' },
            { type: 'text', text: 'Hello.' },
          ],
        },
      ],
    });
    expect(result.messages.map((message) => [message.id, message.role, message.parts])).toEqual([
      ['1', 'user', [{ kind: 'text', text: 'Hi' }]],
      ['2', 'assistant', [{ kind: 'text', text: 'Hello.' }]],
    ]);
    expect(result.running).toBe(false);
    expect(result.state).toEqual({ kind: 'finished' });
  });

  it('is running while a request is out or streaming, which is when Stop is shown', () => {
    expect(view({ chat: 'submitted' }).running).toBe(true);
    expect(view({ chat: 'streaming' }).running).toBe(true);
    expect(view({ chat: 'error' }).running).toBe(false);
  });

  it('draws no answer until it has something to draw', () => {
    const result = view({
      chat: 'streaming',
      messages: [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] },
        { id: '2', role: 'assistant', parts: [{ type: 'step-start' }] },
      ],
    });
    expect(result.messages.map((message) => message.id)).toEqual(['1']);
    expect(result.state).toEqual({ kind: 'thinking' });
  });

  it('drops a system message, which is not the person’s or the assistant’s to read', () => {
    const result = view({ messages: [{ id: 's', role: 'system', parts: [] }] });
    expect(result.messages).toEqual([]);
    expect(result.state).toEqual({ kind: 'empty' });
  });

  it('words a failed call with its reference', () => {
    const error = new ChatCallError({
      ok: false,
      kind: 'problem',
      problem: { type: 'about:blank', title: 'x', status: 429, instance: 'req-9' },
    });
    expect(view({ chat: 'error', error }).state).toEqual({
      kind: 'failed',
      failure: { cause: 'The assistant is busy right now. Try again in a moment.', trace: 'req-9' },
    });
  });

  it('names the allowance that stopped a turn, with the server’s own sentence as the note', () => {
    const result = view({
      chat: 'error',
      error: new Error('This conversation has reached the most it may use in a month.'),
      turn: { stopReason: 'budget_conversation' },
      meter: { ...NO_METER, refused: 'conversation' },
    });
    expect(result.state).toEqual({ kind: 'budget', level: 'conversation' });
    expect(result.note).toBe('This conversation has reached the most it may use in a month.');
    expect(result.meter?.level).toBe('refused');
  });

  it('gives no note for a turn that did not stop on an allowance', () => {
    expect(view({ turn: { stopReason: 'done' } }).note).toBeNull();
  });

  it('carries the warning into the meter', () => {
    expect(
      view({
        meter: { ...NO_METER, warning: { level: 'turn', percent: 81, slot: 'standard' } },
      }).meter,
    ).toMatchObject({ level: 'warning', percent: 81 });
  });

  it('reads the live step from the last message while a turn streams', () => {
    const result = view({
      chat: 'streaming',
      messages: [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] },
        {
          id: '2',
          role: 'assistant',
          parts: [{ type: 'tool-list_clients', toolCallId: 'c', state: 'input-available' }],
        },
      ],
    });
    expect(result.state).toEqual({ kind: 'tool', step: 'Listing clients' });
  });

  it('is loading while a stored conversation is read, and failed when it cannot be', () => {
    expect(view({ history: 'loading' }).state).toEqual({ kind: 'loading' });
    expect(view({ history: 'failed' }).state).toMatchObject({ kind: 'failed' });
  });
});
