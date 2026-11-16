import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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

type Callback = (entries: { target: Element; isIntersecting: boolean }[]) => void;
let callback: Callback = () => undefined;

class FakeObserver {
  constructor(notify: Callback) {
    callback = notify;
  }
  observe = vi.fn();
  disconnect = vi.fn();
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', FakeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function page() {
  return (
    <>
      <SectionNav label="On this page" groups={GROUPS} />
      <section aria-labelledby="settings-general">
        <h2 id="settings-general" tabIndex={-1}>
          General
        </h2>
      </section>
      <section aria-labelledby="settings-terms">
        <h2 id="settings-terms" tabIndex={-1}>
          Terms
        </h2>
      </section>
    </>
  );
}

it('marks the section in the reading band as the current one', () => {
  render(page());
  expect(screen.getByRole('link', { name: 'General' })).not.toHaveAttribute('aria-current');
  const target = document.getElementById('settings-terms')?.closest('section');
  act(() => {
    callback([{ target: target as Element, isIntersecting: true }]);
  });
  expect(screen.getByRole('link', { name: /Terms/u })).toHaveAttribute('aria-current', 'location');
  expect(screen.getByRole('link', { name: 'General' })).not.toHaveAttribute('aria-current');
});

it('says which sections hold unsaved edits, to a screen reader as well', () => {
  render(page());
  expect(screen.getByRole('link', { name: /Terms.*unsaved changes/u })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'General' })).toBeInTheDocument();
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => page())).toEqual({ light: [], dark: [] });
});
