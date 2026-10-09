import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

it('renders a label', () => {
  render(<span>hello</span>);
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => <span>hello</span>)).toEqual({ light: [], dark: [] });
});
