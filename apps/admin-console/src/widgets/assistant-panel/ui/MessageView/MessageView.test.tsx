import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { drawMessage } from '#/widgets/assistant-panel/services/parts';
import { PANEL_WORDING } from '#/widgets/assistant-panel/services/wording';
import { MessageView } from '#/widgets/assistant-panel/ui/MessageView';

const ANSWER = drawMessage('a', 'assistant', [
  { kind: 'tool', id: 't1', name: 'list_clients', state: 'done' },
  { kind: 'text', text: 'There are **three**.' },
  { kind: 'tool', id: 't2', name: 'create_client', state: 'waiting' },
]);

it('draws a person’s words as typed and labels the message by who wrote it', () => {
  render(
    <MessageView
      message={drawMessage('u', 'user', [{ kind: 'text', text: '**plain** <b>text</b>' }])}
      busy={false}
      words={PANEL_WORDING}
    />,
  );
  expect(screen.getByRole('article', { name: 'You' })).toHaveTextContent('**plain** <b>text</b>');
});

it('draws an answer’s steps and text in order, each step with what became of it', () => {
  render(<MessageView message={ANSWER} busy={false} words={PANEL_WORDING} />);
  const article = screen.getByRole('article', { name: 'Assistant' });
  const [first, second] = within(article).getAllByRole('list', { name: 'Steps' });
  if (first === undefined || second === undefined) throw new Error('two lists of steps');
  expect(within(first).getByText('Listed clients')).toBeInTheDocument();
  expect(within(first).getByText('Done')).toBeInTheDocument();
  expect(within(second).getByText('Waiting for you')).toBeInTheDocument();
  expect(within(article).getByText('three').tagName).toBe('STRONG');
});

it('says an answer is still being written by its state, not its words', () => {
  render(<MessageView message={ANSWER} busy words={PANEL_WORDING} />);
  expect(screen.getByRole('article', { name: 'Assistant' })).toHaveAttribute('aria-busy', 'true');
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => (
      <MessageView message={ANSWER} busy={false} words={PANEL_WORDING} />
    )),
  ).toEqual({ light: [], dark: [] });
});
