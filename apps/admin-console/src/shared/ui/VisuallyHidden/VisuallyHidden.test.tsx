import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { VisuallyHidden } from '#/shared/ui/VisuallyHidden/VisuallyHidden';

it('keeps its text in the accessibility tree, as a live region when asked', () => {
  render(<VisuallyHidden role="status">Reading your session</VisuallyHidden>);
  expect(screen.getByRole('status')).toHaveTextContent('Reading your session');
});

it('has no accessibility violations in either theme', async () => {
  expect(
    await axeInBothThemes(() => (
      <main>
        <VisuallyHidden role="status">Reading your session</VisuallyHidden>
      </main>
    )),
  ).toEqual({ light: [], dark: [] });
});
