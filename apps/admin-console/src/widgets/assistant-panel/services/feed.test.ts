import { expect, it } from 'vitest';
import { feedSummary, linesWithCards, visibleSteps } from '#/widgets/assistant-panel/services/feed';
import type { StepLine, StepState } from '#/widgets/assistant-panel/types/chat';

function step(id: string, state: StepState): StepLine {
  return {
    id,
    name: 'list_roles',
    text: 'Listed roles',
    label: 'Done',
    tone: 'active',
    state,
    duration: null,
    raw: '{}',
    outcome: null,
  };
}

const STEPS = [
  step('a', 'done'),
  step('b', 'failed'),
  step('c', 'done'),
  step('d', 'waiting'),
  step('e', 'denied'),
];

it('lists every step while the feed is open', () => {
  expect(visibleSteps(STEPS, true, new Set()).map((s) => s.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
});

it('keeps a failed step and a step with a card in view once the feed is put away', () => {
  expect(visibleSteps(STEPS, false, new Set()).map((s) => s.id)).toEqual(['b', 'e']);
  expect(visibleSteps(STEPS, false, new Set(['d'])).map((s) => s.id)).toEqual(['b', 'd', 'e']);
});

it('says how many steps there were and how many failed', () => {
  expect(feedSummary([step('a', 'done')])).toBe('1 step');
  expect(feedSummary(STEPS)).toBe('5 steps, 1 failed');
});

it('gives each line the card of the change it proposed', () => {
  const entry = {
    card: {
      approval_id: 'ap',
      tool_call_id: 'd',
      tool: 'create_group',
      title: 'Create a group',
      tier: 'A' as const,
      confirm_with: null,
      target: { type: 'group' },
      before: null,
      after: { name: 'ops' },
      expires_at: '2099-01-01T00:00:00.000Z',
    },
    offsetMs: 0,
    decision: undefined,
  };
  const lines = linesWithCards(STEPS, false, [entry]);
  expect(lines.map((line) => line.step.id)).toEqual(['b', 'd', 'e']);
  expect(lines.map((line) => line.entry)).toEqual([undefined, entry, undefined]);
});
