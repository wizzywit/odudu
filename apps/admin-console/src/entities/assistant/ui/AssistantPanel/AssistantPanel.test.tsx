import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { expect, it, vi } from 'vitest';
import { AssistantPanel } from '#/entities/assistant/ui/AssistantPanel';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

function panel(onClose: () => void = () => undefined) {
  return (
    <AssistantPanel
      id="panel"
      label="Assistant panel"
      title="Assistant"
      ready="Ready."
      closeLabel="Close"
      headingRef={createRef<HTMLHeadingElement>()}
      onClose={onClose}
    />
  );
}

it('is a named region whose heading takes the focus when it opens', () => {
  render(panel());
  expect(screen.getByRole('complementary', { name: 'Assistant panel' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Assistant' })).toHaveFocus();
});

it('closes from its button and on Escape, and only once for one Escape', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn<() => void>();
  render(panel(onClose));
  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenCalledTimes(1);
  await user.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledTimes(2);
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => panel())).toEqual({ light: [], dark: [] });
});
