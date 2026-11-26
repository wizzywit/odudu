import { budgetLevelOf } from '#/widgets/assistant-panel/services/budget';
import { GENERIC_FAILURE } from '#/widgets/assistant-panel/services/chatFailure';
import { stepText } from '#/widgets/assistant-panel/services/parts';
import type {
  ChatStatus,
  Failure,
  HistoryState,
  PanelPart,
  PanelState,
  TurnEnd,
} from '#/widgets/assistant-panel/types/chat';

export interface PanelInput {
  history: HistoryState;
  chat: ChatStatus;
  // The server has accepted the turn: a request with nothing of the answer yet is then thinking.
  connected: boolean;
  messageCount: number;
  // A turn was sent and has not yet said how it ended.
  expectsEnd: boolean;
  // The conversation is in Act mode.
  act: boolean;
  // The parts of the last message, which the live state reads.
  last: readonly PanelPart[];
  // How the latest turn ended, once it has.
  turn: TurnEnd | null;
  failure: Failure | null;
}

function liveState(last: readonly PanelPart[]): PanelState {
  const tools = last.flatMap((part) => (part.kind === 'tool' ? [part] : []));
  if (tools.some((tool) => tool.state === 'waiting')) return { kind: 'waiting', act: false };
  const end = last[last.length - 1];
  if (end?.kind === 'tool' && end.state === 'running') {
    return { kind: 'tool', step: stepText(end.name, end.state) };
  }
  return { kind: 'thinking' };
}

function endedState(turn: TurnEnd, failure: Failure | null): PanelState {
  const level = budgetLevelOf(turn.stopReason);
  if (level !== undefined) return { kind: 'budget', level };
  switch (turn.stopReason) {
    case 'done':
      return { kind: 'finished' };
    case 'step_cap':
      return { kind: 'step-limit' };
    case 'awaiting_approval':
      return { kind: 'waiting', act: false };
    case 'aborted':
      return { kind: 'stopped' };
    default:
      return { kind: 'failed', failure: failure ?? { cause: GENERIC_FAILURE, trace: null } };
  }
}

// What the panel is doing, in the one vocabulary its status line, its notices
// and its controls all read. A turn that ended on a named allowance is that
// even when the stream also carried an error, which says the same thing.
export function panelState(input: PanelInput): PanelState {
  const live = input.chat === 'submitted' || input.chat === 'streaming';
  if (input.history === 'loading' && !live) return { kind: 'loading' };
  const settled = input.chat === 'ready' || input.chat === 'error';
  if (settled && input.turn !== null) return endedState(input.turn, input.failure);
  if (input.failure !== null || input.chat === 'error') {
    return {
      kind: 'failed',
      failure: input.failure ?? { cause: GENERIC_FAILURE, trace: null },
    };
  }
  if (input.history === 'failed' && input.messageCount === 0) {
    return { kind: 'failed', failure: { cause: GENERIC_FAILURE, trace: null } };
  }
  if (input.chat === 'submitted') return { kind: input.connected ? 'thinking' : 'connecting' };
  if (input.chat === 'streaming') return liveState(input.last);
  if (input.last.some((part) => part.kind === 'tool' && part.state === 'waiting')) {
    return { kind: 'waiting', act: false };
  }
  if (input.act) return { kind: 'waiting', act: true };
  if (input.expectsEnd) return { kind: 'closed' };
  return input.messageCount === 0 ? { kind: 'empty' } : { kind: 'finished' };
}
