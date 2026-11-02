import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { PageNotFound } from '#/shared/ui/PageNotFound';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

it('says no page has the address and what to do instead', () => {
  render(<PageNotFound />);
  expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  expect(screen.getByText('Check the address, or choose an area from the menu.')).toBeVisible();
});

it('draws the lost route as decoration the heading already covers', () => {
  const { container } = render(<PageNotFound />);
  const art = container.querySelector('svg');
  expect(art?.getAttribute('aria-hidden')).toBe('true');
  expect(art?.querySelector('title, text')).toBeNull();
  expect(screen.queryByRole('img')).toBeNull();
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => <PageNotFound />)).toEqual({ light: [], dark: [] });
});
