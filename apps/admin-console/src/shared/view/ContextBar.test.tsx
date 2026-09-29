import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ContextBar } from '#/shared/view/ContextBar.tsx';
import css from '#/shared/view/ContextBar.module.css?raw';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

const BACK = '/console/system/tenants/acme';

it('says in words which tenant is acted in with system authority', () => {
  render(<ContextBar tenant="acme" backHref={BACK} />);
  const bar = screen.getByRole('region', { name: 'System authority' });
  expect(bar).toHaveTextContent('Acting in acme with system authority');
  expect(screen.getByText('acme').tagName).toBe('STRONG');
});

it('leads back to the tenant’s record in the System area', () => {
  render(<ContextBar tenant="acme" backHref={BACK} />);
  const bar = screen.getByRole('region', { name: 'System authority' });
  expect(within(bar).getByRole('link', { name: 'Back to system' })).toHaveAttribute('href', BACK);
});

it('keeps the way back at every width, wrapping rather than hiding it', () => {
  const source = css.replace(/\/\*[\s\S]*?\*\//gu, '');
  expect(source).not.toMatch(/display:\s*none/u);
  expect(source).toMatch(/\.bar\s*\{[^}]*flex-wrap:\s*wrap/u);
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => <ContextBar tenant="acme" backHref={BACK} />)).toEqual({
    light: [],
    dark: [],
  });
});
