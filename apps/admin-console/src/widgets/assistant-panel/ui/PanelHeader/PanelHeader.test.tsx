import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { expect, it, vi } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { actingInText, actNoteOf } from '#/widgets/assistant-panel/services/crossTenant';
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
    actingIn?: string | null;
    meter?: Meter | null;
    models?: { slot: string; model: string }[] | null;
    onClose?: () => void;
    canStartNew?: boolean;
    onStartNew?: () => void;
    onShowConversations?: () => void;
    onModeChange?: (value: string) => void;
    modeDisabled?: boolean;
    modeProblem?: string | null;
    mode?: 'ask' | 'act';
  } = {},
) {
  return (
    <PanelHeader
      title="Assistant"
      headingRef={createRef<HTMLHeadingElement>()}
      closeLabel="Close"
      onClose={options.onClose ?? vi.fn<() => void>()}
      canStartNew={options.canStartNew ?? false}
      onStartNew={options.onStartNew ?? vi.fn<() => void>()}
      onShowConversations={options.onShowConversations ?? vi.fn<() => void>()}
      conversationsRef={createRef<HTMLButtonElement>()}
      mode={options.mode ?? 'ask'}
      modes={options.modes ?? ['ask', 'act']}
      onModeChange={options.onModeChange ?? vi.fn<(value: string) => void>()}
      modeDisabled={options.modeDisabled ?? false}
      modeProblem={options.modeProblem ?? null}
      acting={actingInText(options.actingIn ?? null)}
      actNote={actNoteOf(options.actingIn ?? null, options.mode ?? 'ask')}
      meter={options.meter ?? null}
      models={options.models ?? null}
      words={PANEL_WORDING}
    />
  );
}

it('offers both modes, says what the chosen one does, and what Act leaves to the person', () => {
  render(header());
  expect(screen.getByRole('radio', { name: 'Ask' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Act' })).toBeEnabled();
  expect(screen.getByText('Ask reads and explains. It changes nothing.')).toBeInTheDocument();
});

it('reports the mode the person picks, and says why a switch did not go through', async () => {
  const user = userEvent.setup();
  const onModeChange = vi.fn<(value: string) => void>();
  const view = render(header({ onModeChange }));
  await user.click(screen.getByRole('radio', { name: 'Act' }));
  expect(onModeChange).toHaveBeenCalledWith('act');
  view.unmount();
  render(header({ modeProblem: 'The mode could not be changed. Try again.' }));
  expect(screen.getByRole('alert')).toHaveTextContent('could not be changed');
});

it('keeps the switch still while an answer runs', () => {
  render(header({ modeDisabled: true }));
  expect(screen.getByRole('radio', { name: 'Act' })).toBeDisabled();
  expect(screen.getByRole('radio', { name: 'Ask' })).toBeDisabled();
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

it('offers a new conversation when it can be started, and only then', async () => {
  const user = userEvent.setup();
  const onStartNew = vi.fn<() => void>();
  const idle = render(header({ onStartNew }));
  expect(screen.getByRole('button', { name: 'New conversation' })).toBeDisabled();
  idle.unmount();
  render(header({ canStartNew: true, onStartNew }));
  await user.click(screen.getByRole('button', { name: 'New conversation' }));
  expect(onStartNew).toHaveBeenCalledTimes(1);
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

it('names the tenant it acts in and offers Act there, in a tag no screen reader misses', () => {
  render(header({ actingIn: 'demo' }));
  expect(screen.getByText('Acting in demo')).toBeVisible();
  expect(screen.getByRole('radio', { name: 'Ask' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Act' })).toBeEnabled();
  expect(screen.queryByText(/not in your own tenant/u)).toBeNull();
});

it('says where Act makes its changes once the conversation is in it in another tenant', () => {
  render(header({ actingIn: 'demo', mode: 'act' }));
  expect(
    screen.getByText(
      'Act makes changes in demo, not in your own tenant. Each one waits for your approval.',
    ),
  ).toBeVisible();
});

it('names no tenant in the administrator’s own', () => {
  render(header());
  expect(screen.queryByText(/Acting in/u)).toBeNull();
});

it('passes axe in both themes, acting in another tenant', async () => {
  expect(await axeInBothThemes(() => header({ actingIn: 'demo' }))).toEqual({
    light: [],
    dark: [],
  });
});
