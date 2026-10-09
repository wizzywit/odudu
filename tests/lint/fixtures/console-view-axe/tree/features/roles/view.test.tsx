import { render } from '@testing-library/react';
import { it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

it('renders a label', () => {
  render(<span>hello</span>);
});
