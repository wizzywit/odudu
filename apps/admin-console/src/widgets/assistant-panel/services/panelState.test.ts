import { describe, expect, it } from 'vitest';
import { panelState, type PanelInput } from '#/widgets/assistant-panel/services/panelState';
import { statusLine } from '#/widgets/assistant-panel/services/statusLine';
import type {
  AssistantStopReason,
  PanelPart,
  PanelState,
} from '#/widgets/assistant-panel/types/chat';

const BASE: PanelInput = {
  history: 'none',
  chat: 'ready',
  connected: false,
  messageCount: 0,
  last: [],
  turn: null,
  failure: null,
};
const TEXT: PanelPart = { kind: 'text', text: 'Hello' };
const RUNNING: PanelPart = { kind: 'tool', id: 'c', name: 'list_subjects', state: 'running' };
const WAITING: PanelPart = { kind: 'tool', id: 'c', name: 'create_client', state: 'waiting' };

function state(input: Partial<PanelInput>): PanelState {
  return panelState({ ...BASE, ...input });
}

describe('the panel state', () => {
  it('is empty before anything is said, and loading while a conversation is read', () => {
    expect(state({})).toEqual({ kind: 'empty' });
    expect(state({ history: 'loading' })).toEqual({ kind: 'loading' });
  });

  it('is connecting until the server has taken the turn, and thinking from then until the first part', () => {
    expect(state({ chat: 'submitted', messageCount: 1 })).toEqual({ kind: 'connecting' });
    expect(state({ chat: 'submitted', connected: true, messageCount: 1 })).toEqual({
      kind: 'thinking',
    });
  });

  it('is thinking while text streams or nothing has been drawn yet', () => {
    expect(state({ chat: 'streaming', messageCount: 2, last: [] })).toEqual({ kind: 'thinking' });
    expect(state({ chat: 'streaming', messageCount: 2, last: [TEXT] })).toEqual({
      kind: 'thinking',
    });
  });

  it('names the step a running tool is on', () => {
    expect(state({ chat: 'streaming', messageCount: 2, last: [TEXT, RUNNING] })).toEqual({
      kind: 'tool',
      step: 'Listing subjects',
    });
  });

  it('waits for the person when a change needs a decision, streaming or not', () => {
    expect(state({ chat: 'streaming', messageCount: 2, last: [WAITING] })).toEqual({
      kind: 'waiting',
    });
    expect(state({ messageCount: 2, last: [WAITING] })).toEqual({ kind: 'waiting' });
    expect(state({ messageCount: 2, turn: { stopReason: 'awaiting_approval' } })).toEqual({
      kind: 'waiting',
    });
  });

  it('says how a turn ended', () => {
    const ended = (stopReason: AssistantStopReason) =>
      state({ messageCount: 2, turn: { stopReason } });
    expect(ended('done')).toEqual({ kind: 'finished' });
    expect(ended('step_cap')).toEqual({ kind: 'step-limit' });
    expect(ended('aborted')).toEqual({ kind: 'stopped' });
    expect(ended('budget_turn')).toEqual({ kind: 'budget', level: 'turn' });
    expect(ended('budget_conversation')).toEqual({ kind: 'budget', level: 'conversation' });
    expect(ended('budget_admin')).toEqual({ kind: 'budget', level: 'admin_day' });
    expect(ended('budget_tenant')).toEqual({ kind: 'budget', level: 'tenant_month' });
    expect(ended('error')).toMatchObject({ kind: 'failed' });
  });

  it('is finished for a conversation that was loaded and has said nothing since', () => {
    expect(state({ messageCount: 4, last: [TEXT] })).toEqual({ kind: 'finished' });
  });

  it('is failed with the cause and reference, whatever else the stream had done', () => {
    const failure = { cause: 'The assistant is busy.', trace: 'req-1' };
    expect(state({ chat: 'error', messageCount: 2, last: [TEXT], failure })).toEqual({
      kind: 'failed',
      failure,
    });
    expect(state({ failure, messageCount: 1 })).toMatchObject({ kind: 'failed' });
  });

  it('is failed when the conversation could not be loaded', () => {
    expect(state({ history: 'failed' })).toMatchObject({ kind: 'failed' });
  });
});

describe('the status line', () => {
  it.each([
    [{ kind: 'empty' }, ''],
    [{ kind: 'loading' }, 'Loading the conversation'],
    [{ kind: 'connecting' }, 'Connecting'],
    [{ kind: 'thinking' }, 'Thinking'],
    [{ kind: 'tool', step: 'Listing subjects' }, 'Listing subjects'],
    [{ kind: 'waiting' }, 'Waiting for you'],
    [{ kind: 'stopped' }, 'Stopped'],
    [{ kind: 'step-limit' }, 'Stopped at the step limit'],
    [{ kind: 'budget', level: 'conversation' }, 'Stopped: this conversation’s allowance is used'],
    [{ kind: 'failed', failure: { cause: 'x', trace: null } }, 'Failed'],
    [{ kind: 'finished' }, 'Finished'],
  ] as const)('says %j as "%s"', (given, line) => {
    expect(statusLine(given)).toBe(line);
  });
});
