import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Skeleton } from '#/shared/view/Skeleton.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

it('says what is loading and hides its placeholder bars', () => {
  const { container } = render(<Skeleton label="Loading clients" lines={4} />);
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('Loading clients');
  expect(status).toHaveAttribute('aria-busy', 'true');
  expect(container.querySelectorAll('[aria-hidden="true"] > *')).toHaveLength(4);
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => <Skeleton label="Loading clients" />)).toEqual({
    light: [],
    dark: [],
  });
});
