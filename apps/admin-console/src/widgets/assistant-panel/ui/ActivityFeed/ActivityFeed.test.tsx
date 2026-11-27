import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { drawMessage } from '#/widgets/assistant-panel/services/parts';
import { PANEL_WORDING } from '#/widgets/assistant-panel/services/wording';
import type { PanelPart, StepLine } from '#/widgets/assistant-panel/types/chat';
import { ActivityFeed } from '#/widgets/assistant-panel/ui/ActivityFeed';

function stepsOf(parts: PanelPart[], times = {}): StepLine[] {
  const block = drawMessage('m', 'assistant', parts, times).blocks[0];
  return block?.kind === 'steps' ? block.steps : [];
}

const tool = (
  id: string,
  name: string,
  state: 'running' | 'waiting' | 'done' | 'failed' | 'denied',
  input: unknown = {},
  error: string | null = null,
): PanelPart => ({ kind: 'tool', id, name, state, input, error });

function feed(steps: StepLine[], live: boolean) {
  return (
    <ActivityFeed
      steps={steps}
      live={live}
      entries={[]}
      username="ada"
      actingIn={null}
      words={PANEL_WORDING}
      onDecide={vi.fn<() => void>()}
    />
  );
}

const FINISHED = stepsOf(
  [
    tool('a', 'get_subject_lockout', 'done'),
    tool('b', 'list_roles', 'failed', {}, 'upstream error'),
    tool('c', 'list_clients', 'done'),
  ],
  { a: { start: 0, ms: 1_800 } },
);

it('is open while the answer is written, with each step’s phrase, state and time', () => {
  render(feed(FINISHED, true));
  expect(screen.getByRole('button', { name: /Hide steps/u })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  const list = screen.getByRole('list', { name: 'Steps' });
  expect(within(list).getByText('Checked lockout state')).toBeInTheDocument();
  expect(within(list).getByText('1.8 s')).toBeInTheDocument();
  expect(within(list).getByText('Listing roles failed')).toBeInTheDocument();
});

it('is put away once the answer is finished, and a failed step stays in view', async () => {
  const user = userEvent.setup();
  render(feed(FINISHED, false));
  const toggle = screen.getByRole('button', { name: /Show steps/u });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(toggle).toHaveTextContent('3 steps, 1 failed');
  expect(screen.queryByText('Checked lockout state')).toBeNull();
  expect(screen.getByText('Listing roles failed')).toBeInTheDocument();
  await user.click(toggle);
  expect(screen.getByRole('button', { name: /Hide steps/u })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(screen.getByText('Checked lockout state')).toBeInTheDocument();
});

it('shows the call as it was sent from a step’s own button, and puts it away again', async () => {
  const user = userEvent.setup();
  render(feed(stepsOf([tool('a', 'get_client', 'failed', { id: 'c1' }, 'boom')]), true));
  const expander = screen.getByRole('button', { name: 'Show the call' });
  expect(expander).toHaveAttribute('aria-expanded', 'false');
  await user.click(expander);
  const raw = screen.getByLabelText('The call as sent');
  expect(raw).toHaveTextContent('"tool": "get_client"');
  expect(raw).toHaveTextContent('"id": "c1"');
  expect(raw).toHaveTextContent('It failed with: boom');
  await user.click(screen.getByRole('button', { name: 'Hide the call' }));
  expect(screen.queryByLabelText('The call as sent')).toBeNull();
});

it('says what became of a finished write when no card is held for it', () => {
  render(feed(stepsOf([tool('a', 'create_group', 'done')]), true));
  expect(screen.getByText('Approved by you. The change was made.')).toBeInTheDocument();
});

it('passes axe in both themes, open and put away', async () => {
  expect(await axeInBothThemes(() => feed(FINISHED, true))).toEqual({ light: [], dark: [] });
  expect(await axeInBothThemes(() => feed(FINISHED, false))).toEqual({ light: [], dark: [] });
});
