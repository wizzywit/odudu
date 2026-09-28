import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Rail, type RailGroup } from '#/shared/view/Rail.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

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
