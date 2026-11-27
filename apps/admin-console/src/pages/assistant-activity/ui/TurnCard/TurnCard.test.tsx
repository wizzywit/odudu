import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { stopTone } from '#/pages/assistant-activity/services/outcome';
import { turnView } from '#/pages/assistant-activity/services/replayView';
import type { ReplayTurn } from '#/pages/assistant-activity/types/activity';
import { TurnCard } from '#/pages/assistant-activity/ui/TurnCard';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

const TURN: ReplayTurn = {
  id: 't1',
  startedAt: '2026-11-25T08:00:00.000Z',
  endedAt: '2026-11-25T08:00:05.000Z',
  stopReason: 'done',
  whyModel: [{ slot: 'standard', reason: 'the profile asks for it', model: 'mock/standard-1' }],
  whyStopped: 'The model finished its answer.',
  steps: [
    {
      id: 's1',
      slot: 'standard',
      model: 'standard-1',
      inputTokens: 10,
      outputTokens: 5,
      startedAt: '2026-11-25T08:00:00.000Z',
      endedAt: '2026-11-25T08:00:01.000Z',
    },
  ],
  events: [
    { seq: 0, stepId: 's1', kind: 'text', at: '2026-11-25T08:00:01.000Z', payload: { text: 'a' } },
    { seq: 1, stepId: 's1', kind: 'text', at: '2026-11-25T08:00:02.000Z', payload: { text: 'b' } },
  ],
};

const words = {
  whyStopped: 'Why it stopped',
  whyModel: 'Why this model',
  decisions: 'Decisions',
  steps: 'Steps',
  show: 'Show the steps',
  hide: 'Hide the steps',
  inPart: 'Shown in part.',
  notShown: (count: number) => `${String(count)} not shown`,
  more: (count: number) => `Show ${String(count)} more`,
};

function page() {
  return {
    words: words as unknown as Parameters<typeof TurnCard>[0]['page']['words'],
    tone: stopTone,
    toggle: vi.fn(),
    showMore: vi.fn(),
  };
}

it('draws an open answer with its steps and a closed one without them', () => {
  const stub = page();
  const { rerender } = render(<TurnCard turn={turnView(TURN, 1, true, 100)} page={stub} />);
  const card = screen.getByRole('article', { name: 'Answer 1' });
  expect(within(card).getByText('Step 1')).toBeVisible();
  expect(within(card).getByText('standard · standard-1')).toBeVisible();
  rerender(<TurnCard turn={turnView(TURN, 1, false, 100)} page={stub} />);
  expect(screen.getByRole('button', { name: 'Show the steps, Answer 1' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  expect(screen.getByText('Step 1')).not.toBeVisible();
});

it('asks to close the answer, and for more entries where some are not drawn', async () => {
  const user = userEvent.setup();
  const stub = page();
  render(<TurnCard turn={turnView(TURN, 1, true, 1)} page={stub} />);
  await user.click(screen.getByRole('button', { name: 'Hide the steps, Answer 1' }));
  expect(stub.toggle).toHaveBeenCalledOnce();
  await user.click(screen.getByRole('button', { name: 'Show 1 more' }));
  expect(stub.showMore).toHaveBeenCalledOnce();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => <TurnCard turn={turnView(TURN, 1, true, 100)} page={page()} />),
  ).toEqual({ light: [], dark: [] });
});
