import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { LostFrame } from '#/shared/ui/LostFrame';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

it('holds the screen in the main landmark under the product name and mark', () => {
  const { container } = render(
    <LostFrame brand="odudu">
      <p>Nothing here.</p>
    </LostFrame>,
  );
  const main = screen.getByRole('main');
  expect(main).toHaveAttribute('id', 'main');
  expect(main).toContainElement(screen.getByText('odudu'));
  expect(main.querySelector('svg')).not.toBeNull();
  expect(container.querySelector('p:last-of-type')?.textContent).toBe('Nothing here.');
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => (
      <LostFrame brand="odudu">
        <p>Nothing here.</p>
      </LostFrame>
    )),
  ).toEqual({ light: [], dark: [] });
});
