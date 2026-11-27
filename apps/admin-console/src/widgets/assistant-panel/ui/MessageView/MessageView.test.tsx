import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { drawMessage } from '#/widgets/assistant-panel/services/parts';
import { PANEL_WORDING } from '#/widgets/assistant-panel/services/wording';
import { MessageView } from '#/widgets/assistant-panel/ui/MessageView';

const ANSWER = drawMessage('a', 'assistant', [
  { kind: 'tool', id: 't1', name: 'list_clients', state: 'done', input: {}, error: null },
  { kind: 'text', text: 'There are **three**.' },
  { kind: 'tool', id: 't2', name: 'create_group', state: 'waiting', input: {}, error: null },
]);

it('draws a person’s words as typed and labels the message by who wrote it', () => {
  render(
    <MessageView
      message={drawMessage('u', 'user', [{ kind: 'text', text: '**plain** <b>text</b>' }])}
      busy={false}
      entries={[]}
      username="ada"
      words={PANEL_WORDING}
      onDecide={vi.fn<() => void>()}
    />,
  );
  expect(screen.getByRole('article', { name: 'You' })).toHaveTextContent('**plain** <b>text</b>');
});

it('draws an answer’s steps and text in order, put away once finished unless one waits', async () => {
  const user = userEvent.setup();
  render(
    <MessageView
      message={ANSWER}
      busy={false}
      entries={[]}
      username="ada"
      words={PANEL_WORDING}
      onDecide={vi.fn<() => void>()}
    />,
  );
  const article = screen.getByRole('article', { name: 'Assistant' });
  expect(within(article).queryByText('Listed clients')).toBeNull();
  expect(within(article).getByText('Waiting for you')).toBeInTheDocument();
  await user.click(within(article).getByRole('button', { name: /Show steps/u }));
  expect(within(article).getByText('Listed clients')).toBeInTheDocument();
  expect(within(article).getByText('three').tagName).toBe('STRONG');
});

it('says an answer is still being written by its state, not its words', () => {
  render(
    <MessageView
      message={ANSWER}
      busy
      entries={[]}
      username="ada"
      words={PANEL_WORDING}
      onDecide={vi.fn<() => void>()}
    />,
  );
  expect(screen.getByRole('article', { name: 'Assistant' })).toHaveAttribute('aria-busy', 'true');
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => (
      <MessageView
        message={ANSWER}
        busy={false}
        entries={[]}
        username="ada"
        words={PANEL_WORDING}
        onDecide={vi.fn<() => void>()}
      />
    )),
  ).toEqual({ light: [], dark: [] });
});
