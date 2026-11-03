import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { LostArt } from '#/shared/ui/LostArt';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

it('is decoration only: hidden from assistive technology, with no name, title or text', () => {
  const { container } = render(<LostArt />);
  const art = container.querySelector('svg');
  expect(art?.getAttribute('aria-hidden')).toBe('true');
  expect(art?.getAttribute('focusable')).toBe('false');
  expect(art?.querySelector('title, desc, text')).toBeNull();
  expect(screen.queryByRole('img')).toBeNull();
});

it('draws in the colour of the text around it, with no inline style', () => {
  const { container } = render(<LostArt />);
  expect(container.querySelector('svg')?.getAttribute('stroke')).toBe('currentColor');
  expect(container.querySelector('[style]')).toBeNull();
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => <LostArt />)).toEqual({ light: [], dark: [] });
});
