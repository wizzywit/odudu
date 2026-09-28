import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { DialogFrame } from '#/shared/view/DialogFrame.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

it('never closes on a press outside it', async () => {
  const user = userEvent.setup();
  const onEscape = vi.fn();
  render(
    <DialogFrame
      isOpen
      title="Retire key?"
      description="It stops verifying."
      onEscape={onEscape}
      actions={null}
    />,
  );
  await user.click(document.body);
  expect(onEscape).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog', { name: 'Retire key?' })).toBeInTheDocument();
});

it('ignores Escape when it has no safe answer', async () => {
  const user = userEvent.setup();
  render(<DialogFrame isOpen title="Stored?" description="Only once." actions={null} />);
  await user.keyboard('{Escape}');
  expect(screen.getByRole('dialog', { name: 'Stored?' })).toBeInTheDocument();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => (
      <DialogFrame
        isOpen
        title="Retire key?"
        description="It stops verifying."
        onEscape={vi.fn()}
        actions={<button type="button">Retire</button>}
      />
    )),
  ).toEqual({ light: [], dark: [] });
});
