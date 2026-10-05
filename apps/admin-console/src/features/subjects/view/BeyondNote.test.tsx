import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { BeyondNote } from '#/features/subjects/view/BeyondNote.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

it('names what the subject holds beyond the caller', () => {
  render(<BeyondNote name="ada" beyond={['manage-keys', 'view-audit']} />);
  expect(screen.getByRole('note')).toHaveTextContent(
    'ada holds manage-keys and view-audit, which you do not, so you can view ada but change nothing here.',
  );
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => <BeyondNote name="ada" beyond={['manage-keys']} />)).toEqual({
    light: [],
    dark: [],
  });
});
