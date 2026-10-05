import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { SectionSave } from '#/features/subjects/usecase/useSubjectProfile.ts';
import { SectionNoticeOf } from '#/features/subjects/view/SectionNoticeOf.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

function refused(message: string): SectionSave<{ ids: readonly string[] }> {
  return {
    status: 'refused',
    fieldErrors: {},
    conflicts: [],
    conflictSource: 'changed',
    blocked: undefined,
    reread: vi.fn(),
    keepMine: vi.fn(),
    takeTheirs: vi.fn(),
    values: { ids: [] },
    changed: [],
    dirty: false,
    saving: false,
    restored: false,
    message,
    edit: vi.fn(),
    discard: vi.fn(),
    submit: vi.fn(() => true),
  };
}

it("says a section's refusal where the section is", () => {
  render(<SectionNoticeOf title="Groups" save={refused('Refused: not yours to give.')} />);
  expect(screen.getByRole('status')).toHaveTextContent('Refused: not yours to give.');
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => <SectionNoticeOf title="Groups" save={refused('Refused.')} />),
  ).toEqual({ light: [], dark: [] });
});
