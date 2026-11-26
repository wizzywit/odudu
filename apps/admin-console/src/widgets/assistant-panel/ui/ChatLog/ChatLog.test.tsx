import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { expect, it, vi } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { drawMessage } from '#/widgets/assistant-panel/services/parts';
import { PANEL_WORDING } from '#/widgets/assistant-panel/services/wording';
import type { PanelMessage } from '#/widgets/assistant-panel/types/chat';
import { ChatLog } from '#/widgets/assistant-panel/ui/ChatLog';

const MESSAGES: PanelMessage[] = [
  drawMessage('u', 'user', [{ kind: 'text', text: 'Hi' }]),
  drawMessage('a', 'assistant', [{ kind: 'text', text: 'Hello.' }]),
];

function log(options: { messages?: PanelMessage[]; loading?: boolean; running?: boolean }) {
  return (
    <ChatLog
      messages={options.messages ?? []}
      running={options.running ?? false}
      loading={options.loading ?? false}
      mode="ask"
      words={PANEL_WORDING}
      logRef={createRef<HTMLDivElement>()}
      onScroll={vi.fn<() => void>()}
    />
  );
}

it('is a log that does not announce what is written into it, and can be scrolled by a keyboard', () => {
  render(log({ messages: MESSAGES }));
  const region = screen.getByRole('log', { name: 'Conversation' });
  expect(region).toHaveAttribute('aria-live', 'off');
  expect(region).toHaveAttribute('tabindex', '0');
});

it('says what the assistant can do, in the mode it is in, before anything is said', () => {
  render(log({}));
  expect(screen.getByRole('heading', { name: 'Ask about this tenant' })).toBeInTheDocument();
  expect(screen.getByText('In Ask mode it never changes anything.')).toBeInTheDocument();
});

it('draws a placeholder while a stored conversation is read, and not the empty state', () => {
  render(log({ loading: true }));
  expect(screen.queryByRole('heading', { name: 'Ask about this tenant' })).toBeNull();
  expect(screen.getByRole('log')).toHaveTextContent('Loading the conversation');
});

it('marks only the last answer busy while one is being written', () => {
  render(log({ messages: MESSAGES, running: true }));
  expect(screen.getByRole('article', { name: 'Assistant' })).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByRole('article', { name: 'You' })).not.toHaveAttribute('aria-busy');
});

it.each([
  ['empty', () => log({})],
  ['with a conversation', () => log({ messages: MESSAGES })],
  ['loading', () => log({ loading: true })],
])('passes axe in both themes, %s', async (_name, ui) => {
  expect(await axeInBothThemes(ui)).toEqual({ light: [], dark: [] });
});
