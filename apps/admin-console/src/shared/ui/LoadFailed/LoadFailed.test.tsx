import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { LoadFailed } from '#/shared/ui/LoadFailed';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

it('says the gateway did not answer, and asks again on request', async () => {
  const user = userEvent.setup();
  const retry = vi.fn();
  render(<LoadFailed title="The groups could not be loaded" retry={retry} />);
  expect(screen.getByText('The groups could not be loaded')).toBeVisible();
  expect(screen.getByText('The gateway did not answer, or answered with an error.')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledOnce();
});

it('adds that nothing was changed where the page writes nothing on a failed read', () => {
  render(<LoadFailed title="Roles could not be loaded" retry={vi.fn()} unchanged />);
  expect(
    screen.getByText('The gateway did not answer, or answered with an error. Nothing was changed.'),
  ).toBeVisible();
});

it('has no accessibility violations in either theme', async () => {
  expect(
    await axeInBothThemes(() => <LoadFailed title="Roles could not be loaded" retry={vi.fn()} />),
  ).toEqual({ light: [], dark: [] });
});
