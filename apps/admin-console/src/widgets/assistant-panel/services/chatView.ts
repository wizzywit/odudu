import { budgetNote, meterOf } from '#/widgets/assistant-panel/services/budget';
import { failureOf } from '#/widgets/assistant-panel/services/chatFailure';
import { panelState } from '#/widgets/assistant-panel/services/panelState';
import { drawMessage, readParts } from '#/widgets/assistant-panel/services/parts';
import type {
  ChatStatus,
  HistoryState,
  Meter,
  MeterState,
  PanelMessage,
  PanelState,
  TurnEnd,
} from '#/widgets/assistant-panel/types/chat';

export interface ChatViewInput {
  history: HistoryState;
  chat: ChatStatus;
  messages: readonly { id: string; role: string; parts: readonly unknown[] }[];
  error: unknown;
  // The server has accepted the turn, which a request with no answer yet is waiting on.
  connected: boolean;
  turn: TurnEnd | null;
  meter: MeterState;
  expectsEnd: boolean;
  act: boolean;
}

export interface ChatView {
  messages: PanelMessage[];
  state: PanelState;
  meter: Meter | null;
  running: boolean;
  // The sentence under the log when an allowance stopped the turn.
  note: string | null;
}

// The messages the log draws. An answer that has no part to draw yet (the
// stream has begun and nothing has been written) is not drawn: the status line
// says it is coming.
function drawn(messages: ChatViewInput['messages']): PanelMessage[] {
  return messages.flatMap((message) => {
    if (message.role !== 'user' && message.role !== 'assistant') return [];
    const parts = readParts(message.parts);
    return message.role === 'assistant' && parts.length === 0
      ? []
      : [drawMessage(message.id, message.role, parts)];
  });
}

// What the panel draws, worked out in one place from what the chat client,
// the stream's closing parts and the stored conversation say.
export function chatView(input: ChatViewInput): ChatView {
  const messages = drawn(input.messages);
  const failure = input.error === undefined ? null : failureOf(input.error);
  const state = panelState({
    history: input.history,
    chat: input.chat,
    connected: input.connected,
    expectsEnd: input.expectsEnd,
    act: input.act,
    messageCount: messages.length,
    last: messages[messages.length - 1]?.parts ?? [],
    turn: input.turn,
    failure,
  });
  const fromServer = input.error instanceof Error ? input.error.message : null;
  return {
    messages,
    state,
    meter: meterOf(input.meter),
    running: input.chat === 'submitted' || input.chat === 'streaming',
    note: state.kind === 'budget' ? budgetNote(state.level, fromServer) : null,
  };
}
