import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { expect, it, vi } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { PANEL_WORDING } from '#/widgets/assistant-panel/services/wording';
import type { AssistantMode, Meter } from '#/widgets/assistant-panel/types/chat';
import { PanelHeader } from '#/widgets/assistant-panel/ui/PanelHeader';

const WITHIN: Meter = { level: 'within', text: 'Within your allowance', percent: null };
const MODELS = [
  { slot: 'standard', model: 's-1' },
  { slot: 'deep', model: 'd-1' },
];

function header(
  options: {
    modes?: AssistantMode[];
    switching?: boolean;
    modeFailed?: boolean;
    meter?: Meter;
    models?: { slot: string; model: string }[] | null;
    onMode?: (mode: AssistantMode) => void;
    onClose?: () => void;
  } = {},
) {
  return (
    <PanelHeader
      title="Assistant"
      headingRef={createRef<HTMLHeadingElement>()}
      closeLabel="Close"
      onClose={options.onClose ?? vi.fn<() => void>()}
      mode="ask"
      modes={options.modes ?? ['ask', 'act']}
      switching={options.switching ?? false}
      modeFailed={options.modeFailed ?? false}
      onMode={options.onMode ?? vi.fn<(mode: AssistantMode) => void>()}
      meter={options.meter ?? WITHIN}
      models={options.models ?? null}
      words={PANEL_WORDING}
    />
  );
}

it('offers both modes and says what the chosen one does', () => {
  render(header());
  expect(screen.getByRole('radio', { name: 'Ask' })).toBeChecked();
  expect(screen.getByText('Ask reads and explains. It changes nothing.')).toBeInTheDocument();
});

it('reports the mode a person picks', async () => {
  const user = userEvent.setup();
  const onMode = vi.fn<(mode: AssistantMode) => void>();
  render(header({ onMode }));
  await user.click(screen.getByRole('radio', { name: 'Act' }));
  expect(onMode).toHaveBeenCalledWith('act');
});

it('dims the switch while a turn runs or the switch is saved', () => {
  render(header({ switching: true }));
  expect(screen.getByRole('radio', { name: 'Act' })).toBeDisabled();
});

it('offers no switch where one mode is offered', () => {
  render(header({ modes: ['ask'] }));
  expect(screen.queryByRole('radio')).toBeNull();
});

it('says when the mode could not be changed', () => {
  render(header({ modeFailed: true }));
  expect(screen.getByRole('alert')).toHaveTextContent('The mode could not be changed');
});

it('names the models only when it is given them', () => {
  const none = render(header());
  expect(screen.queryByText('Models')).toBeNull();
  none.unmount();
  render(header({ models: MODELS }));
  expect(screen.getByText('Models')).toBeInTheDocument();
  expect(screen.getByText('d-1')).toBeInTheDocument();
});

it('closes from its button', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn<() => void>();
  render(header({ onClose }));
  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it.each([
  ['within', WITHIN],
  [
    'warning',
    { level: 'warning', text: '83% of your share of today’s allowance used', percent: 83 },
  ],
  ['refused', { level: 'refused', text: 'Allowance used: this answer’s allowance', percent: null }],
] as const)('passes axe in both themes, meter %s', async (_name, meter) => {
  expect(await axeInBothThemes(() => header({ meter, models: MODELS }))).toEqual({
    light: [],
    dark: [],
  });
});
