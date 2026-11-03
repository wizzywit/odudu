import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { Note, NoteCode } from '#/shared/ui/Note/Note';

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

const warned = (
  <main>
    <Note tone="warning">Raise it.</Note>
  </main>
);

it('is still a note when it is a warning', () => {
  render(warned);
  expect(screen.getByRole('note')).toHaveTextContent('Raise it.');
});

it('has no accessibility violations as a warning, in either theme', async () => {
  expect(await axeInBothThemes(() => warned)).toEqual({ light: [], dark: [] });
});
