import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { SectionNoticeOf, type NoticeSave } from '#/shared/view/SectionNoticeOf';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

function save(over: Partial<NoticeSave>): NoticeSave {
  return {
    status: 'idle',
    conflicts: [],
    conflictSource: 'changed',
    message: null,
    saving: false,
    keepMine: vi.fn(),
    takeTheirs: vi.fn(),
    reread: vi.fn(),
    ...over,
  };
}

it("announces a refusal as the section's one line", () => {
  render(
    <SectionNoticeOf
      title="Availability"
      save={save({ status: 'refused', message: 'Refused: it needs manage-clients.' })}
    />,
  );
  expect(screen.getByRole('status')).toHaveTextContent('Refused: it needs manage-clients.');
});

it('offers keep mine and take theirs for a conflict, and says nothing for an idle save', async () => {
  const user = userEvent.setup();
  const conflicted = save({
    status: 'conflict',
    conflicts: [{ field: 'name', label: 'Name', yours: 'Mine', theirs: 'Theirs', secret: false }],
  });
  const { rerender } = render(<SectionNoticeOf title="Details" save={conflicted} />);
  await user.click(screen.getByRole('button', { name: 'Keep mine in Details' }));
  expect(conflicted.keepMine).toHaveBeenCalledOnce();
  rerender(<SectionNoticeOf title="Details" save={save({})} />);
  expect(screen.queryByRole('button')).toBeNull();
});

it('passes axe in both themes, refused and in conflict', async () => {
  const states = [
    save({ status: 'refused', message: 'Refused: nothing was changed.' }),
    save({
      status: 'conflict',
      conflicts: [{ field: 'name', label: 'Name', yours: 'Mine', theirs: 'Theirs', secret: false }],
    }),
  ];
  for (const state of states) {
    expect(await axeInBothThemes(() => <SectionNoticeOf title="Details" save={state} />)).toEqual({
      light: [],
      dark: [],
    });
  }
});
