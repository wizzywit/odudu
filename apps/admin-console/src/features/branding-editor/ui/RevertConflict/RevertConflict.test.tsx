import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { Revert } from '#/features/branding-editor/use-cases/useRevert';
import { revertWords } from '#/features/branding-editor/services/revertDraft';
import { RevertConflict } from '#/features/branding-editor/ui/RevertConflict';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

function revert(changes: Partial<Revert> = {}): Revert {
  return {
    busy: false,
    hold: undefined,
    problem: null,
    conflicts: [
      {
        field: 'templates',
        label: 'Page templates',
        theirs: 2,
        yours: 1,
        secret: false,
        describe: (value) => `${String(value)} page templates`,
      },
    ],
    section: 'the Pages tab',
    words: revertWords({ kind: 'tenant' }, 'pages', false),
    revert: () => undefined,
    takeTheirs: () => undefined,
    ...changes,
  };
}

it('shows nothing while there is no conflict', () => {
  const { container } = render(<RevertConflict revert={revert({ conflicts: [] })} />);
  expect(container).toBeEmptyDOMElement();
});

it('compares the draft with the revert, and hands each choice to the revert', async () => {
  const user = userEvent.setup();
  const again = vi.fn<() => void>();
  const theirs = vi.fn<() => void>();
  render(<RevertConflict revert={revert({ revert: again, takeTheirs: theirs })} />);
  expect(screen.getByText('2 page templates')).toBeVisible();
  expect(screen.getByText('1 page templates')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Keep mine in the Pages tab' }));
  await user.click(screen.getByRole('button', { name: 'Take theirs in the Pages tab' }));
  expect(again).toHaveBeenCalledOnce();
  expect(theirs).toHaveBeenCalledOnce();
});

it('has nothing axe can find in either theme', async () => {
  const found = await axeInBothThemes(() => <RevertConflict revert={revert()} />);
  expect(found).toEqual({ light: [], dark: [] });
});
