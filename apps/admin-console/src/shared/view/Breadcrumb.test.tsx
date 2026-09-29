import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Breadcrumb } from '#/shared/view/Breadcrumb.tsx';
import css from '#/shared/view/Breadcrumb.module.css?raw';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

const TRAIL = [
  { label: 'System' },
  { label: 'Tenants', href: '/console/system/tenants' },
  { label: 'acme' },
] as const;

it('is a navigation landmark holding an ordered trail', () => {
  render(<Breadcrumb items={TRAIL} />);
  const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
  const list = within(nav).getByRole('list');
  expect(list.tagName).toBe('OL');
  expect(
    within(list)
      .getAllByRole('listitem')
      .map((item) => item.textContent),
  ).toEqual(['System›', 'Tenants›', 'acme']);
});

it('links every step that has an address and marks the last one current, unlinked', () => {
  render(<Breadcrumb items={TRAIL} />);
  const list = within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('list');
  expect(within(list).getByRole('link', { name: 'Tenants' })).toHaveAttribute(
    'href',
    '/console/system/tenants',
  );
  expect(within(list).queryByRole('link', { name: 'System' })).toBeNull();
  const current = within(list).getByText('acme');
  expect(current).toHaveAttribute('aria-current', 'page');
  expect(current.closest('a')).toBeNull();
});

it('hides its separators from assistive technology', () => {
  const { container } = render(<Breadcrumb items={TRAIL} />);
  const separators = [...container.querySelectorAll('li > [aria-hidden="true"]')];
  expect(separators.map((node) => node.textContent)).toEqual(['›', '›']);
});

it('offers the nearest step with an address as a single way up', () => {
  const { container } = render(<Breadcrumb items={TRAIL} />);
  const up = container.querySelector('[data-up]');
  expect(up).not.toBeNull();
  expect(up).toHaveAttribute('href', '/console/system/tenants');
  expect(up).toHaveTextContent('‹ Tenants');
  expect(screen.getByRole('link', { name: 'Back to Tenants' })).toBe(up);
  expect(up?.closest('ol')).toBeNull();
});

it('draws no way up when nothing before the current page has an address', () => {
  const { container } = render(<Breadcrumb items={[{ label: 'System' }, { label: 'acme' }]} />);
  expect(container.querySelector('[data-up]')).toBeNull();
});

it('collapses to the way up in a narrow shell, and never scrolls sideways', () => {
  const source = css.replace(/\/\*[\s\S]*?\*\//gu, '');
  const narrow = /@container shell \(width < 640px\)\s*\{([\s\S]*)\}\s*$/u.exec(source)?.[1] ?? '';
  expect(narrow).toMatch(/\.trail\s*\{[^}]*display:\s*none/u);
  expect(narrow).toMatch(/\.up\s*\{[^}]*display:\s*inline-flex/u);
  expect(source).toMatch(/\.up\s*\{[^}]*display:\s*none/u);
  expect(source).toMatch(/\.trail\s*\{[^}]*flex-wrap:\s*wrap/u);
  expect(source).not.toMatch(/overflow-x:\s*(auto|scroll)/u);
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => <Breadcrumb items={TRAIL} />)).toEqual({
    light: [],
    dark: [],
  });
});
