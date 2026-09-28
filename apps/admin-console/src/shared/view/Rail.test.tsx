import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Rail, type RailGroup } from '#/shared/view/Rail.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import shellCss from '#/shared/view/AppShell.module.css?raw';
import railCss from '#/shared/view/Rail.module.css?raw';

const GROUPS: readonly RailGroup[] = [
  { items: [{ href: '/console/acme', label: 'Overview' }] },
  {
    heading: 'Identity',
    items: [
      { href: '/console/acme/subjects', label: 'Subjects' },
      { href: '/console/acme/groups', label: 'Groups' },
    ],
  },
];

it('is a named navigation of grouped links, marking the current one', () => {
  render(<Rail label="acme" groups={GROUPS} currentHref="/console/acme/subjects" />);
  const nav = screen.getByRole('navigation', { name: 'acme' });
  expect(within(nav).getByRole('list', { name: 'Identity' })).toBeInTheDocument();
  const current = within(nav).getByRole('link', { name: 'Subjects' });
  expect(current).toHaveAttribute('href', '/console/acme/subjects');
  expect(current).toHaveAttribute('aria-current', 'page');
  expect(within(nav).getByRole('link', { name: 'Groups' })).not.toHaveAttribute('aria-current');
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => (
      <Rail label="acme" groups={GROUPS} currentHref="/console/acme" header={<span>Odudu</span>} />
    )),
  ).toEqual({ light: [], dark: [] });
});

// jsdom evaluates no container query, so the stylesheets are read instead.
it('collapses by its own width, at the column the shell gives it when collapsed', () => {
  expect(railCss).toMatch(/\.rail\s*\{[^}]*container:\s*rail\s*\/\s*inline-size;/u);
  expect(railCss).not.toMatch(/@container\s+shell/u);
  const threshold = Number(/@container rail \(width < (\d+)px\)/u.exec(railCss)?.[1]);
  const columns = [...shellCss.matchAll(/grid-template-columns:\s*(\d+)px/gu)].map(([, px]) =>
    Number(px),
  );
  expect(columns).toEqual([240, 192]);
  const [full = 0, collapsed = 0] = columns;
  expect(collapsed).toBeLessThan(threshold);
  expect(full).toBeGreaterThanOrEqual(threshold);
});
