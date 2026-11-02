import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { LiveMessage, Problem } from '#/shared/ui/Message';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

it('says a problem as an alert, and draws nothing while there is none', () => {
  const { rerender, container } = render(<Problem>{null}</Problem>);
  expect(container).toBeEmptyDOMElement();
  rerender(<Problem>The secret was not rotated.</Problem>);
  expect(screen.getByRole('alert')).toHaveTextContent('The secret was not rotated.');
});

it('keeps a live region in the page while it has nothing to say', () => {
  const { rerender } = render(<LiveMessage label="Last mint">{null}</LiveMessage>);
  const region = screen.getByRole('status', { name: 'Last mint' });
  expect(region).toBeEmptyDOMElement();
  rerender(<LiveMessage label="Last mint">Minted.</LiveMessage>);
  expect(screen.getByRole('status', { name: 'Last mint' })).toBe(region);
  expect(region).toHaveTextContent('Minted.');
});

it('has no accessibility violations in either theme', async () => {
  expect(
    await axeInBothThemes(() => (
      <>
        <Problem>The secret was not rotated.</Problem>
        <LiveMessage label="Last mint">Minted.</LiveMessage>
      </>
    )),
  ).toEqual({ light: [], dark: [] });
});
