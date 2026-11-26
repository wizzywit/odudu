import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { PANEL_WORDING } from '#/widgets/assistant-panel/services/wording';
import { Composer } from '#/widgets/assistant-panel/ui/Composer';

function Held({
  children,
}: {
  children: (draft: string, onDraft: (text: string) => void) => React.ReactNode;
}) {
  const [draft, setDraft] = useState('');
  return children(draft, setDraft);
}

function composer(
  running = false,
  blocked = false,
  onSend = vi.fn<(text: string) => void>(),
  onStop = vi.fn<() => void>(),
) {
  return (
    <Held>
      {(draft, onDraft) => (
        <Composer
          running={running}
          blocked={blocked}
          contextLabel="client c1"
          draft={draft}
          onDraft={onDraft}
          words={PANEL_WORDING}
          maxLength={50}
          onSend={onSend}
          onStop={onStop}
        />
      )}
    </Held>
  );
}

const FIELD = { name: 'Message to the assistant' };

it('sends on Enter and clears the field but keeps the focus in it', async () => {
  const user = userEvent.setup();
  const onSend = vi.fn<(text: string) => void>();
  render(composer(false, false, onSend));
  await user.type(screen.getByRole('textbox', FIELD), 'hello{Enter}');
  expect(onSend).toHaveBeenCalledWith('hello');
  expect(screen.getByRole('textbox', FIELD)).toHaveValue('');
  expect(screen.getByRole('textbox', FIELD)).toHaveFocus();
});

it('starts a new line on Shift and Enter and sends nothing', async () => {
  const user = userEvent.setup();
  const onSend = vi.fn<(text: string) => void>();
  render(composer(false, false, onSend));
  await user.type(screen.getByRole('textbox', FIELD), 'a{Shift>}{Enter}{/Shift}b');
  expect(onSend).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', FIELD)).toHaveValue('a\nb');
});

it('sends nothing for an empty message, and Send waits for words', async () => {
  const user = userEvent.setup();
  const onSend = vi.fn<(text: string) => void>();
  render(composer(false, false, onSend));
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  await user.type(screen.getByRole('textbox', FIELD), '   {Enter}');
  expect(onSend).not.toHaveBeenCalled();
});

it('shows Stop instead of Send while an answer runs, sends nothing, and gives the focus back after Stop', async () => {
  const user = userEvent.setup();
  const onSend = vi.fn<(text: string) => void>();
  const onStop = vi.fn<() => void>();
  render(composer(true, false, onSend, onStop));
  expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  await user.type(screen.getByRole('textbox', FIELD), 'next{Enter}');
  expect(onSend).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Stop' }));
  expect(onStop).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('textbox', FIELD)).toHaveFocus();
});

it('cannot be typed in or sent from while the conversation waits for a decision', () => {
  render(composer(false, true));
  expect(screen.getByRole('textbox', FIELD)).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
});

it('holds a message to the most the server takes', () => {
  render(composer());
  expect(screen.getByRole('textbox', FIELD)).toHaveAttribute('maxlength', '50');
});

it.each([
  ['idle', false],
  ['running', true],
])('passes axe in both themes, %s', async (_name, running) => {
  expect(await axeInBothThemes(() => composer(running))).toEqual({ light: [], dark: [] });
});
