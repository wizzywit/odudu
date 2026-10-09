import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ReplaceUnfinished } from '#/features/tenants/view/ReplaceUnfinished/ReplaceUnfinished.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { render } from '@testing-library/react';

function confirming(unfinished: { tenant: string; username: string; granted: boolean } | null) {
  const onReplace = vi.fn();
  const onKeep = vi.fn();
  return {
    onReplace,
    onKeep,
    element: <ReplaceUnfinished unfinished={unfinished} onReplace={onReplace} onKeep={onKeep} />,
  };
}

it('names the tenant and subject it would leave unfinished, and keeps them on cancel', async () => {
  const user = userEvent.setup();
  const state = confirming({ tenant: 'globex', username: 'ada', granted: false });
  render(state.element);
  expect(screen.getByRole('alertdialog')).toHaveTextContent('ada was created in globex');
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(state.onKeep).toHaveBeenCalledOnce();
  expect(state.onReplace).not.toHaveBeenCalled();
});

it('says only the password is left once the grant has landed', () => {
  render(confirming({ tenant: 'globex', username: 'ada', granted: true }).element);
  const dialog = screen.getByRole('alertdialog');
  expect(dialog).toHaveTextContent('has not yet been given a one-time password');
  expect(dialog).not.toHaveTextContent('tenant-admin');
});

it('shows nothing when nothing is unfinished', () => {
  render(confirming(null).element);
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () => confirming({ tenant: 'globex', username: 'ada', granted: false }).element,
    ),
  ).toEqual({ light: [], dark: [] });
});

it('says starting over leaves the subject as they are', () => {
  render(confirming({ tenant: 'globex', username: 'ada', granted: false }).element);
  expect(screen.getByRole('alertdialog')).toHaveTextContent('Starting over leaves ada as they are');
});
