import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ContextBar } from '#/shared/view/ContextBar.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

it('says in words which tenant is acted in with system authority', () => {
  render(<ContextBar tenant="acme" />);
  const bar = screen.getByRole('region', { name: 'System authority' });
  expect(bar).toHaveTextContent('Acting in acme with system authority');
  expect(screen.getByText('acme').tagName).toBe('STRONG');
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => <ContextBar tenant="acme" />)).toEqual({
    light: [],
    dark: [],
  });
});
