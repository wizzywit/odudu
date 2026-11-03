import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { NarrowedNote } from '#/shared/ui/NarrowedNote';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

it('names what the list is narrowed to, and shows every record again on request', async () => {
  const user = userEvent.setup();
  const clear = vi.fn();
  render(
    <NarrowedNote all="Show every role" onClear={clear}>
      Only the roles of client <code>portal</code>.
    </NarrowedNote>,
  );
  expect(screen.getByText('portal')).toBeVisible();
  const all = screen.getByRole('button', { name: 'Show every role' });
  expect(all).toHaveAttribute('data-size', 'small');
  await user.click(all);
  expect(clear).toHaveBeenCalledOnce();
});

it('has no accessibility violations in either theme', async () => {
  expect(
    await axeInBothThemes(() => (
      <NarrowedNote all="Show every role" onClear={vi.fn()}>
        Only the roles of client <code>portal</code>.
      </NarrowedNote>
    )),
  ).toEqual({ light: [], dark: [] });
});
