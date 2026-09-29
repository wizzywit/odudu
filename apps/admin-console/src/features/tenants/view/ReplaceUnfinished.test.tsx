import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ReplaceUnfinished } from '#/features/tenants/view/ReplaceUnfinished.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { render } from '@testing-library/react';

function begin(replacing: { tenant: string; username: string; granted: boolean } | null) {
  return { start: vi.fn(), replacing, replace: vi.fn(), keep: vi.fn() };
}

it('names the tenant and subject it would leave unfinished, and keeps them on cancel', async () => {
  const user = userEvent.setup();
  const state = begin({ tenant: 'globex', username: 'ada', granted: false });
  render(<ReplaceUnfinished begin={state} />);
  expect(screen.getByRole('alertdialog')).toHaveTextContent('ada was created in globex');
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(state.keep).toHaveBeenCalledOnce();
  expect(state.replace).not.toHaveBeenCalled();
});

it('says only the password is left once the grant has landed', () => {
  render(<ReplaceUnfinished begin={begin({ tenant: 'globex', username: 'ada', granted: true })} />);
  const dialog = screen.getByRole('alertdialog');
  expect(dialog).toHaveTextContent('has not yet been given a one-time password');
  expect(dialog).not.toHaveTextContent('tenant-admin');
});

it('shows nothing when nothing is unfinished', () => {
  render(<ReplaceUnfinished begin={begin(null)} />);
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => (
      <ReplaceUnfinished begin={begin({ tenant: 'globex', username: 'ada', granted: false })} />
    )),
  ).toEqual({ light: [], dark: [] });
});
