import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { NavGroup } from '#/pages/settings/services/sectionPlan';
import { SectionNav } from '#/pages/settings/ui/SectionNav';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

const GROUPS: readonly NavGroup[] = [
  {
    title: 'Tenant',
    items: [
      { id: 'general', headingId: 'settings-general', title: 'General', dirty: false },
      { id: 'terms', headingId: 'settings-terms', title: 'Terms', dirty: true },
    ],
  },
];

function nav(current: string | null) {
  return <SectionNav label="On this page" groups={GROUPS} current={current} />;
}

it('marks the section in view as the current one, and no other', () => {
  render(nav('terms'));
  expect(screen.getByRole('link', { name: /Terms/u })).toHaveAttribute('aria-current', 'location');
  expect(screen.getByRole('link', { name: 'General' })).not.toHaveAttribute('aria-current');
});

it('marks none while no section is in view', () => {
  render(nav(null));
  expect(screen.getByRole('link', { name: 'General' })).not.toHaveAttribute('aria-current');
});

it('says which sections hold unsaved edits, to a screen reader as well', () => {
  render(nav(null));
  expect(screen.getByRole('link', { name: /Terms.*unsaved changes/u })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'General' })).toBeInTheDocument();
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => nav('general'))).toEqual({ light: [], dark: [] });
});
