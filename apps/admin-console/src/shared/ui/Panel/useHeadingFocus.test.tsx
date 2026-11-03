import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { Panel, useHeadingFocus } from '#/shared/ui/Panel';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

function Removable({ removed }: { removed: boolean }) {
  const { heading, afterRemoval } = useHeadingFocus();
  return (
    <Panel title="Assigned scopes" headingRef={heading}>
      <button
        type="button"
        onClick={() => {
          afterRemoval(Promise.resolve(removed)).catch(() => undefined);
        }}
      >
        Remove it
      </button>
    </Panel>
  );
}

it('hands the focus to the heading once a removal went through', async () => {
  const user = userEvent.setup();
  render(<Removable removed />);
  await user.click(screen.getByRole('button', { name: 'Remove it' }));
  expect(screen.getByRole('heading', { name: 'Assigned scopes' })).toHaveFocus();
});

it('leaves the focus where it was when nothing was removed', async () => {
  const user = userEvent.setup();
  render(<Removable removed={false} />);
  await user.click(screen.getByRole('button', { name: 'Remove it' }));
  expect(screen.getByRole('heading', { name: 'Assigned scopes' })).not.toHaveFocus();
});

it('has no accessibility violations in either theme', async () => {
  expect(await axeInBothThemes(() => <Removable removed />)).toEqual({ light: [], dark: [] });
});
