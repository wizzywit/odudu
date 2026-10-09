import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { Note, NoteCode } from '#/shared/view/Note/Note.tsx';

const note = (
  <main>
    <Note>
      Changing this needs <NoteCode>manage-tenant</NoteCode>.
    </Note>
  </main>
);

it('is a note, with the capability set in code', () => {
  render(note);
  expect(screen.getByRole('note')).toHaveTextContent('Changing this needs manage-tenant.');
  expect(screen.getByText('manage-tenant').tagName).toBe('CODE');
});

it('has no accessibility violations in either theme', async () => {
  expect(await axeInBothThemes(() => note)).toEqual({ light: [], dark: [] });
});
