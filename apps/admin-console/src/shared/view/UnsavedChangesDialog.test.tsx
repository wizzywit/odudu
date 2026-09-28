import { render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { Button } from '#/shared/view/Button.tsx';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { UnsavedChangesDialog } from '#/shared/view/UnsavedChangesDialog.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

it('names the sections that would be lost and offers to stay or to leave', async () => {
  const user = userEvent.setup();
  const onStay = vi.fn();
  const onLeave = vi.fn();
  render(
    <UnsavedChangesDialog
      isOpen
      sections={['General', 'Tokens']}
      onStay={onStay}
      onLeave={onLeave}
    />,
  );
  const dialog = screen.getByRole('alertdialog', { name: 'Leave without saving?' });
  expect(dialog).toHaveAccessibleDescription(
    'Your unsaved changes to General and Tokens will be lost.',
  );
  expect(screen.getByRole('button', { name: 'Stay' })).toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'Discard changes and leave' }));
  expect(onLeave).toHaveBeenCalledOnce();
  expect(onStay).not.toHaveBeenCalled();
});

it('stays on Escape', async () => {
  const user = userEvent.setup();
  const onStay = vi.fn();
  render(<UnsavedChangesDialog isOpen sections={['General']} onStay={onStay} onLeave={vi.fn()} />);
  expect(screen.getByRole('alertdialog')).toHaveAccessibleDescription(
    'Your unsaved changes to General will be lost.',
  );
  await user.keyboard('{Escape}');
  expect(onStay).toHaveBeenCalledOnce();
});

it('returns focus to what asked to leave', async () => {
  const user = userEvent.setup();
  function Harness() {
    const [open, setOpen] = useState(false);
    const close = () => {
      setOpen(false);
    };
    return (
      <>
        <Button
          onPress={() => {
            setOpen(true);
          }}
        >
          Sign out
        </Button>
        <UnsavedChangesDialog isOpen={open} sections={['General']} onStay={close} onLeave={close} />
      </>
    );
  }
  render(<Harness />);
  const trigger = screen.getByRole('button', { name: 'Sign out' });
  await user.click(trigger);
  await user.click(screen.getByRole('button', { name: 'Stay' }));
  await waitFor(() => {
    expect(trigger).toHaveFocus();
  });
});

it('renders nothing while closed', () => {
  render(<UnsavedChangesDialog isOpen={false} sections={[]} onStay={vi.fn()} onLeave={vi.fn()} />);
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => (
      <UnsavedChangesDialog
        isOpen
        sections={['General', 'Tokens', 'Logout']}
        onStay={vi.fn()}
        onLeave={vi.fn()}
      />
    )),
  ).toEqual({ light: [], dark: [] });
});
