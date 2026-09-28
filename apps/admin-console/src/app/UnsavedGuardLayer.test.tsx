import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { UnsavedGuardLayer } from '#/app/UnsavedGuardLayer.tsx';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';

afterEach(() => {
  useUnsavedGuard.getState().reset();
});

function holdDeparture(proceed: () => void): void {
  act(() => {
    useUnsavedGuard.getState().setDirty('client/general', 'General');
    useUnsavedGuard.getState().request(proceed);
  });
}

it('asks only when a departure is held', () => {
  render(<UnsavedGuardLayer />);
  expect(screen.queryByRole('alertdialog')).toBeNull();
  holdDeparture(vi.fn());
  expect(
    screen.getByRole('alertdialog', { name: 'Leave without saving?' }),
  ).toHaveAccessibleDescription('Your unsaved changes to General will be lost.');
});

it('lets the held departure go on leave', async () => {
  const user = userEvent.setup();
  const proceed = vi.fn();
  render(<UnsavedGuardLayer />);
  holdDeparture(proceed);
  await user.click(screen.getByRole('button', { name: 'Discard changes and leave' }));
  expect(proceed).toHaveBeenCalledOnce();
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('drops the held departure on stay and keeps the work', async () => {
  const user = userEvent.setup();
  const proceed = vi.fn();
  render(<UnsavedGuardLayer />);
  holdDeparture(proceed);
  await user.click(screen.getByRole('button', { name: 'Stay' }));
  expect(proceed).not.toHaveBeenCalled();
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(useUnsavedGuard.getState().unsaved()).toEqual(['General']);
});
