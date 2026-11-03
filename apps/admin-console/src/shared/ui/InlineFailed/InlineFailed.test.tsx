import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { InlineFailed } from '#/shared/ui/InlineFailed';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

it('is an alert saying what could not be loaded, with a small way to ask again', async () => {
  const user = userEvent.setup();
  const retry = vi.fn();
  render(<InlineFailed message="The groups under /eng could not be loaded." retry={retry} />);
  expect(screen.getByRole('alert')).toHaveTextContent('The groups under /eng could not be loaded.');
  const again = screen.getByRole('button', { name: 'Try again' });
  expect(again).toHaveAttribute('data-size', 'small');
  await user.click(again);
  expect(retry).toHaveBeenCalledOnce();
});

it('takes the class its caller lays it out with', () => {
  render(<InlineFailed message="Nope." retry={vi.fn()} className="laid-out" />);
  expect(screen.getByRole('alert')).toHaveClass('laid-out');
});

it('has no accessibility violations in either theme', async () => {
  expect(await axeInBothThemes(() => <InlineFailed message="Nope." retry={vi.fn()} />)).toEqual({
    light: [],
    dark: [],
  });
});
