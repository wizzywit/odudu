import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { expect, it, vi } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { PANEL_WORDING } from '#/widgets/assistant-panel/services/wording';
import type { AssistantMode, Meter } from '#/widgets/assistant-panel/types/chat';
import { PanelHeader } from '#/widgets/assistant-panel/ui/PanelHeader';

const MODELS = [
  { slot: 'standard', model: 's-1' },
  { slot: 'deep', model: 'd-1' },
];

function header(
  options: {
    modes?: AssistantMode[];
    meter?: Meter | null;
    models?: { slot: string; model: string }[] | null;
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
      meter={options.meter ?? null}
      models={options.models ?? null}
      words={PANEL_WORDING}
    />
  );
}

it('offers both modes, says what the chosen one does, and says why Act is not yet to be chosen', () => {
  render(header());
  expect(screen.getByRole('radio', { name: 'Ask' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Act' })).toBeDisabled();
  expect(screen.getByText('Ask reads and explains. It changes nothing.')).toBeInTheDocument();
  expect(screen.getByText('Act needs the approval card, which arrives next.')).toBeInTheDocument();
});

it('offers no switch where one mode is offered', () => {
  render(header({ modes: ['ask'] }));
  expect(screen.queryByRole('radio')).toBeNull();
});

it('says nothing about the allowance while it has nothing to say', () => {
  render(header());
  expect(screen.queryByText(/allowance/u)).toBeNull();
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
