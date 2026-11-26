import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { PANEL_WORDING } from '#/widgets/assistant-panel/services/wording';
import type { Meter, PanelState } from '#/widgets/assistant-panel/types/chat';
import { PanelNotices } from '#/widgets/assistant-panel/ui/PanelNotices';

const FAILED: PanelState = {
  kind: 'failed',
  failure: { cause: 'The assistant is busy right now.', trace: 'req-1' },
};

function notices(
  state: PanelState,
  statusText: string,
  note: string | null = null,
  meter: Meter | null = null,
) {
  return (
    <PanelNotices
      state={state}
      statusText={statusText}
      running={false}
      note={note}
      meter={meter}
      words={PANEL_WORDING}
    />
  );
}

const STATES: [string, PanelState, string, string | null][] = [
  ['empty', { kind: 'empty' }, '', null],
  ['thinking', { kind: 'thinking' }, 'Thinking', null],
  ['waiting', { kind: 'waiting', act: false }, 'Waiting for you', null],
  ['stopped', { kind: 'stopped' }, 'Stopped', null],
  ['act', { kind: 'waiting', act: true }, 'Waiting for you', null],
  ['closed', { kind: 'closed' }, 'Stopped', null],
  ['step limit', { kind: 'step-limit' }, 'Stopped at the step limit', null],
  [
    'budget',
    { kind: 'budget', level: 'turn' },
    'Stopped: this answer’s allowance is used',
    'This answer reached the most one answer may use.',
  ],
  ['failed', FAILED, '', null],
];

it('keeps one polite status line in the page, even when it is empty', () => {
  render(notices({ kind: 'empty' }, ''));
  const line = screen.getByRole('status', { name: 'Assistant status' });
  expect(line).toHaveAttribute('aria-live', 'polite');
  expect(line).toHaveTextContent('');
});

it('says a failure in plain words with the reference to copy, as an alert', () => {
  render(notices(FAILED, ''));
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('The assistant is busy right now.');
  expect(alert).toHaveTextContent('req-1');
});

it('names the allowance that stopped the turn in a notice that is not an alert', () => {
  render(notices({ kind: 'budget', level: 'turn' }, 'Stopped', 'Reached the most.'));
  expect(screen.getByRole('note')).toHaveTextContent('Stopped: allowance usedReached the most.');
  expect(screen.queryByRole('alert')).toBeNull();
});

it('warns at the share the server named, and says what happens at the limit', () => {
  render(
    notices({ kind: 'finished' }, 'Finished', null, {
      level: 'warning',
      text: '82% of this answer’s allowance used',
      percent: 82,
    }),
  );
  expect(screen.getByRole('note')).toHaveTextContent('does not switch to another model');
});

it.each(STATES)('passes axe in both themes, %s', async (_name, state, statusText, note) => {
  expect(await axeInBothThemes(() => notices(state, statusText, note))).toEqual({
    light: [],
    dark: [],
  });
});
