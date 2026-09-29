import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Count } from '#/shared/view/Count.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

const SUBJECTS = { one: 'subject', other: 'subjects' };

it('shows an exact count with its noun', () => {
  render(<Count count={1204} capped={false} noun={SUBJECTS} />);
  expect(screen.getByText('1,204 subjects')).toBeInTheDocument();
});

it('uses the singular for one', () => {
  render(<Count count={1} capped={false} noun={SUBJECTS} />);
  expect(screen.getByText('1 subject')).toBeInTheDocument();
});

it('shows a capped count as the cap and more', () => {
  const { rerender } = render(<Count count={1000} capped noun={SUBJECTS} />);
  expect(screen.getByText('1,000+ subjects')).toBeInTheDocument();
  rerender(<Count count={10000} capped noun={SUBJECTS} />);
  expect(screen.getByText('10,000+ subjects')).toBeInTheDocument();
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => <Count count={10000} capped noun={SUBJECTS} />)).toEqual({
    light: [],
    dark: [],
  });
});
