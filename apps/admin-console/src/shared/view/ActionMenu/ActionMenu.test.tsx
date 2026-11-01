import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ActionMenu } from '#/shared/view/ActionMenu';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

function Menu({ onRevert = vi.fn(), onDiscard = vi.fn() }) {
  return (
    <ActionMenu
      label="More publishing actions"
      trigger="More"
      actions={[
        { id: 'revert', label: 'Revert this tab to published', onAction: onRevert },
        { id: 'discard', label: 'Discard draft', tone: 'danger', onAction: onDiscard },
      ]}
    />
  );
}

it('opens from the keyboard, moves by arrow and runs the action it is on', async () => {
  const user = userEvent.setup();
  const onDiscard = vi.fn();
  render(<Menu onDiscard={onDiscard} />);
  screen.getByRole('button', { name: 'More publishing actions' }).focus();
  await user.keyboard('{Enter}');
  const menu = await screen.findByRole('menu', { name: 'More publishing actions' });
  expect(menu).toBeVisible();
  await user.keyboard('{ArrowDown}');
  expect(screen.getByRole('menuitem', { name: 'Discard draft' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(onDiscard).toHaveBeenCalledOnce();
  expect(screen.queryByRole('menu')).toBeNull();
});

it('closes on Escape and gives focus back to its button', async () => {
  const user = userEvent.setup();
  render(<Menu />);
  const button = screen.getByRole('button', { name: 'More publishing actions' });
  await user.click(button);
  expect(await screen.findByRole('menu')).toBeVisible();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).toBeNull();
  await waitFor(() => {
    expect(button).toHaveFocus();
  });
});

it('passes axe in both themes', async () => {
  const results = await axeInBothThemes(() => <Menu />);
  expect(results).toEqual({ light: [], dark: [] });
});
