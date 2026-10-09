import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { BeyondNote, ReachFailed } from '#/features/subjects/view/BeyondNote/BeyondNote.tsx';
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

it('says what could not be read, and reads it again', async () => {
  const retry = vi.fn();
  render(<ReachFailed name="ada" retry={retry} />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Read it again' }));
  expect(retry).toHaveBeenCalledOnce();
});

it('passes axe in both themes, the read failed', async () => {
  expect(await axeInBothThemes(() => <ReachFailed name="ada" retry={vi.fn()} />)).toEqual({
    light: [],
    dark: [],
  });
});
