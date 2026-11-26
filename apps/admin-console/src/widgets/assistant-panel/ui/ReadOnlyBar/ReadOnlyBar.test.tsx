import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { PANEL_WORDING } from '#/widgets/assistant-panel/services/wording';
import { ReadOnlyBar } from '#/widgets/assistant-panel/ui/ReadOnlyBar';

function bar(reason: 'archived' | 'ended', onRestore = vi.fn(), onStartNew = vi.fn()) {
  return (
    <ReadOnlyBar
      reason={reason}
      words={PANEL_WORDING}
      onRestore={onRestore}
      onStartNew={onStartNew}
    />
  );
}

it('says a hidden conversation is hidden, and restores it', async () => {
  const user = userEvent.setup();
  const onRestore = vi.fn();
  const onStartNew = vi.fn();
  render(bar('archived', onRestore, onStartNew));
  expect(screen.getByRole('note')).toHaveTextContent('This conversation is archived');
  await user.click(screen.getByRole('button', { name: 'Restore' }));
  expect(onRestore).toHaveBeenCalledTimes(1);
  expect(onStartNew).not.toHaveBeenCalled();
});

it('says a conversation whose sign-in ended can only be read, and offers a new one', async () => {
  const user = userEvent.setup();
  const onRestore = vi.fn();
  const onStartNew = vi.fn();
  render(bar('ended', onRestore, onStartNew));
  expect(screen.getByRole('note')).toHaveTextContent('ended when your sign-in did');
  await user.click(screen.getByRole('button', { name: 'Start a new conversation' }));
  expect(onStartNew).toHaveBeenCalledTimes(1);
  expect(onRestore).not.toHaveBeenCalled();
});

it('has no accessibility violations in either theme', async () => {
  expect(await axeInBothThemes(() => bar('archived'))).toEqual({ light: [], dark: [] });
  expect(await axeInBothThemes(() => bar('ended'))).toEqual({ light: [], dark: [] });
});
