import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Duration } from '#/shared/view/Duration/Duration.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

it.each([
  [0, '0 s'],
  [45, '45 s'],
  [300, '300 s · 5 minutes'],
  [3599, '3599 s · 59 minutes 59 seconds'],
  [90.4, '90.4 s · 1 minute 30 seconds'],
  [Number.NaN, '—'],
  [Number.POSITIVE_INFINITY, '—'],
  [3600, '3600 s · 1 hour'],
  [86400, '86400 s · 1 day'],
  [1209600, '1209600 s · 14 days'],
  [2592000, '2592000 s · 30 days'],
  [5400, '5400 s · 1 hour 30 minutes'],
])('shows %s seconds as "%s"', (seconds, expected) => {
  const { container } = render(<Duration seconds={seconds} />);
  expect(container).toHaveTextContent(expected);
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => <Duration seconds={1209600} />)).toEqual({
    light: [],
    dark: [],
  });
});
