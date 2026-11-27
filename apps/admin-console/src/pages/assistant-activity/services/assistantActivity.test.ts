import { describe, expect, it } from 'vitest';
import {
  commitFilter,
  settledDrafts,
  typedValue,
  withProblem,
} from '#/pages/assistant-activity/services/filters';
import {
  OUTCOME_CHOICES,
  KIND_CHOICES,
  stopTone,
  stopWord,
} from '#/pages/assistant-activity/services/outcome';
import {
  IDLE,
  reportHeld,
  reportLabel,
  reportLine,
  reportStateOf,
} from '#/pages/assistant-activity/services/report';
import {
  BODY_MAX,
  EVENTS_PAGE,
  eventView,
  tookText,
  turnView,
} from '#/pages/assistant-activity/services/replayView';
import {
  answersText,
  tokenBreakdown,
  tokenTotal,
  toolsText,
} from '#/pages/assistant-activity/services/rows';
import { isOpen, limitOf, moreShown } from '#/pages/assistant-activity/services/turnState';
import type { ReplayEvent, ReplayTurn } from '#/pages/assistant-activity/types/activity';

const event = (
  kind: string,
  payload: Record<string, unknown>,
  stepId: string | null = null,
  seq = 0,
): ReplayEvent => ({
  seq,
  stepId,
  kind,
  at: '2026-11-25T08:00:00.000Z',
  payload,
});

describe('a typed filter', () => {
  it('is applied once whole, cleared when empty and explained when malformed', () => {
    expect(commitFilter('tool', ' list_clients ')).toEqual({
      value: 'list_clients',
      problem: undefined,
    });
    expect(commitFilter('tool', '')).toEqual({ value: null, problem: undefined });
    expect(commitFilter('tool', 'List Clients').problem).toMatch(/lower-case words/u);
    expect(commitFilter('person', '5c1d9a3e-2b4f-4c6a-8d7e-1f0a9b8c7d6e').value).toBe(
      '5c1d9a3e-2b4f-4c6a-8d7e-1f0a9b8c7d6e',
    );
    expect(commitFilter('conversation', 'abc').problem).toMatch(/named by an id/u);
  });

  it('keeps a draft that was not applied and drops one that was', () => {
    const bad = commitFilter('tool', 'No');
    expect(settledDrafts({ tool: 'No' }, 'tool', bad)).toEqual({ tool: 'No' });
    expect(settledDrafts({ tool: 'ok_tool' }, 'tool', commitFilter('tool', 'ok_tool'))).toEqual({});
    expect(typedValue({ tool: 'x' }, { tool: 'y' }, 'tool')).toBe('x');
    expect(typedValue({}, { tool: 'y' }, 'tool')).toBe('y');
    expect(withProblem({ tool: 'p' }, 'tool', undefined)).toEqual({});
  });
});

describe('outcome words', () => {
  it('say what a missing outcome and each stop mean, and offer each as a filter', () => {
    expect(stopWord(null)).toBe('No answer yet');
    expect(stopWord('budget_tenant')).toBe('Monthly budget');
    expect(stopTone('error')).toBe('danger');
    expect(stopTone('done')).toBe('active');
    expect(OUTCOME_CHOICES.map((c) => c.id)).toContain('budget_admin');
    expect(KIND_CHOICES.map((c) => c.id)).toEqual([
      'any',
      'approval',
      'budget_refusal',
      'tool_error',
    ]);
  });
});

describe('report state', () => {
  it('holds after a report and after a refusal at the cap, with the reason beside the control', () => {
    const done = reportStateOf({
      ok: true,
      status: 200,
      etag: null,
      next: null,
      data: { reportedAt: 't', reportedCount: 90, nearLimit: true },
    });
    expect(reportHeld(done, null)).toBe(true);
    expect(reportLabel(done, null)).toBe('Reported');
    expect(reportLine(done)).toBe('This tenant now keeps 90 of 100 reported conversations.');
    const full = reportStateOf({
      ok: false,
      kind: 'problem',
      problem: { type: 'about:blank', title: 'Conflict', status: 409 },
    });
    expect(full.kind).toBe('full');
    expect(reportHeld(full, null)).toBe(true);
    expect(reportLabel(full, null)).toBe('Report this answer');
    expect(reportLine(full)).toMatch(/already keeps 100 reported conversations/u);
  });

  it('stays open after a failure, so asking again is possible', () => {
    const failed = reportStateOf({ ok: false, kind: 'network' });
    expect(failed.kind).toBe('failed');
    expect(reportHeld(failed, null)).toBe(false);
    expect(reportHeld(IDLE, '2026-01-01T00:00:00.000Z')).toBe(true);
  });
});

describe('a replay entry', () => {
  it('names the tool and shows its input and output, cut at what a page may hold', () => {
    const call = eventView(event('tool_call', { tool: 'get_client', input: { id: 'c1' } }));
    expect(call.label).toBe('Called get_client');
    expect(call.body).toContain('"id": "c1"');
    const long = eventView(
      event('tool_result', { tool: 'x', ms: 12, output: 'a'.repeat(BODY_MAX + 5) }),
    );
    expect(long.cut).toBe(true);
    expect(long.body).toHaveLength(BODY_MAX);
    expect(long.detail).toBe('12 ms');
  });

  it('states a budget refusal and an unknown kind in words', () => {
    expect(eventView(event('reservation', { outcome: 'refused', level: 'turn' })).label).toBe(
      'A budget refused the next call',
    );
    expect(eventView(event('something_new', { a: 1 })).label).toBe('something new');
  });

  it('times a step, or says nothing for one still running', () => {
    expect(tookText('2026-11-25T08:00:00.000Z', '2026-11-25T08:00:00.250Z')).toBe('250 ms');
    expect(tookText('2026-11-25T08:00:00.000Z', '2026-11-25T08:00:02.500Z')).toBe('2.5 s');
    expect(tookText('2026-11-25T08:00:00.000Z', null)).toBeNull();
  });
});

describe('a turn as drawn', () => {
  const turn: ReplayTurn = {
    id: 't1',
    startedAt: '2026-11-25T08:00:00.000Z',
    endedAt: null,
    stopReason: null,
    whyModel: [{ slot: 'fast', reason: null, model: null }],
    whyStopped: 'The turn has not ended.',
    steps: [
      {
        id: 's1',
        slot: 'fast',
        model: 'm',
        inputTokens: null,
        outputTokens: null,
        startedAt: '2026-11-25T08:00:00.000Z',
        endedAt: null,
      },
    ],
    events: [
      event('slot_chosen', { slot: 'fast' }, null, 0),
      event('text', { text: 'hi' }, 's1', 1),
      event('text', { text: 'orphan' }, 'unknown', 2),
    ],
  };

  it('puts decisions and entries of no known step apart from those of each step', () => {
    const view = turnView(turn, 1, true, 10);
    expect(view.decisions.map((e) => e.label)).toEqual(['Chose the fast model', 'Said']);
    expect(view.steps[0]?.events.map((e) => e.body)).toEqual(['hi']);
    expect(view.steps[0]?.tokens).toBe('— in · — out');
    expect(view.outcome).toBe('No answer yet');
    expect(view.whyModels).toEqual(['fast: a model']);
  });

  it('draws nothing of a closed turn and counts what an open one leaves out', () => {
    expect(turnView(turn, 1, false, 10).steps[0]?.events).toEqual([]);
    const open = turnView(turn, 1, true, 1);
    expect(open.notShown).toBe(2);
    expect(open.nextCount).toBe(2);
  });
});

describe('what is open and how much is drawn', () => {
  it('opens the latest answer unless told otherwise, and draws a page more at a time', () => {
    expect(isOpen({}, 'a', 'a')).toBe(true);
    expect(isOpen({}, 'b', 'a')).toBe(false);
    expect(isOpen({ a: false }, 'a', 'a')).toBe(false);
    expect(limitOf({}, 'a')).toBe(EVENTS_PAGE);
    expect(limitOf(moreShown({}, 'a'), 'a')).toBe(2 * EVENTS_PAGE);
  });
});

describe('a conversation’s row', () => {
  it('adds the slots and names the first tools with the count of the rest', () => {
    const tokens = { fast: 1, standard: 20, deep: 300 };
    expect(tokenTotal(tokens)).toBe(321);
    expect(tokenBreakdown(tokens)).toBe('Fast 1, standard 20, deep 300');
    expect(toolsText([])).toBe('No tool called');
    expect(toolsText(['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c and 2 more');
    expect(answersText({ turns: 1, steps: 2 } as Parameters<typeof answersText>[0])).toBe(
      '1 answer, 2 model calls',
    );
  });
});
