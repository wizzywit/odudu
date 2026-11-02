import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { BrandLine } from '#/shared/ui/BrandLine';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

it('puts the staff mark beside the name, as decoration the name already covers', () => {
  const { container } = render(<BrandLine>odudu · acme</BrandLine>);
  expect(screen.getByText('odudu · acme')).toBeVisible();
  const mark = container.querySelector('svg');
  expect(mark).not.toBeNull();
  expect(mark?.getAttribute('aria-hidden')).toBe('true');
  expect(mark?.getAttribute('focusable')).toBe('false');
  expect(mark?.querySelector('title')).toBeNull();
  expect(screen.queryByRole('img')).toBeNull();
});

it('draws the mark in the colour of the text around it', () => {
  const { container } = render(<BrandLine>odudu</BrandLine>);
  expect(container.querySelector('svg')?.getAttribute('stroke')).toBe('currentColor');
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => <BrandLine>odudu</BrandLine>)).toEqual({
    light: [],
    dark: [],
  });
});
