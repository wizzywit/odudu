import { expect, it } from 'vitest';
import { chatMessagesOf } from '#/widgets/assistant-panel/adapter/history';

it('carries a stored conversation’s text over, in order, and nothing the client has not seen', () => {
  const messages = chatMessagesOf({
    id: 'c1',
    profile: 'free-chat',
    mode: 'ask',
    title: null,
    created_at: '2026-11-26T08:00:00.000Z',
    last_active_at: '2026-11-26T08:00:00.000Z',
    messages: [
      { id: 'c1-1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] },
      {
        id: 'c1-2',
        role: 'assistant',
        parts: [
          { type: 'step-start' },
          { type: 'tool-list_clients', toolCallId: 'x', state: 'output-available' },
          { type: 'text', text: 'Hello.' },
          { type: 'text', text: 7 },
        ],
      },
    ],
  });
  expect(messages).toEqual([
    { id: 'c1-1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] },
    { id: 'c1-2', role: 'assistant', parts: [{ type: 'text', text: 'Hello.' }] },
  ]);
});
