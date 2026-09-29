import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { SaveBar } from '#/shared/view/SaveBar.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

it('names the section on both actions and says the changes are unsaved', async () => {
  const onDiscard = vi.fn();
  render(<SaveBar section="General" saving={false} onDiscard={onDiscard} />);
  expect(screen.getByText('Unsaved changes')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Save General' })).toHaveAccessibleDescription(
    'or press Enter',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Discard changes to General' }));
  expect(onDiscard).toHaveBeenCalledOnce();
});

it('reads Saving… and takes no second press while a save is in flight', () => {
  render(<SaveBar section="General" saving onDiscard={() => undefined} />);
  expect(screen.getByRole('button', { name: 'Saving… General' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Discard changes to General' })).toBeDisabled();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => (
      <form>
        <SaveBar section="General" saving={false} onDiscard={() => undefined} />
      </form>
    )),
  ).toEqual({ light: [], dark: [] });
});

it('offers no key while the save cannot run', () => {
  const { rerender } = render(<SaveBar section="General" saving onDiscard={vi.fn()} />);
  expect(screen.queryByText(/or press/u)).toBeNull();
  rerender(
    <SaveBar section="General" saving={false} blocked="Load it first." onDiscard={vi.fn()} />,
  );
  expect(screen.queryByText(/or press/u)).toBeNull();
  expect(screen.getByRole('button', { name: 'Save General' })).toHaveAccessibleDescription(
    'Load it first.',
  );
});
